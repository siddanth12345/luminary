// 1v1 matchmaking queue. Everyone searching broadcasts a heartbeat on one shared channel; players are paired
// first-come-first-served. The first of each pair opens a room and announces its code, the second joins it.
// (Table Wars pairs players the same way, using presence.)
import { openTransport } from './transport.js';
import { Online, hostRoom, joinRoom, leaveRoom } from './online.js';

export const Queue = { active: false, waiting: 0, onChange: () => {} };
let t = null, hbT = 0, id = '', t0 = 0, peers = new Map(), matched = false, announcing = 0;
const newCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');

function stop() {
    clearInterval(hbT); hbT = 0; clearInterval(announcing); announcing = 0;
    if (t) { try { t.send({ t: 'unq', id }); } catch (e) { /* ignore */ } t.close(); }
    t = null; peers.clear(); Queue.active = false; Queue.waiting = 0; Queue.onChange();
}
export function leaveQueue() { matched = true; stop(); }

export async function joinQueue() {
    leaveRoom(false);
    stop(); matched = false;
    id = Math.random().toString(36).slice(2, 9); t0 = Date.now();
    try { t = await openTransport('mm1v1'); } catch (e) { Online.note = e.message; Online.status = 'closed'; Online.onChange(); return false; }
    Queue.active = true; Queue.onChange();
    t.onmessage = (m) => {
        if (matched || !m) return;
        if (m.t === 'q') peers.set(m.id, { t0: m.t0, seen: Date.now() });
        else if (m.t === 'unq') peers.delete(m.id);
        else if (m.t === 'matched' && m.b === id) { matched = true; const code = m.code; stop(); joinRoom(code); Online.viaQueue = true; }
    };
    const tick = () => {
        if (matched || !t) return;
        t.send({ t: 'q', id, t0 });
        const now = Date.now();
        for (const [k, v] of peers) if (now - v.seen > 3500) peers.delete(k);
        Queue.waiting = peers.size; Queue.onChange();
        const list = [{ id, t0 }, ...[...peers].map(([k, v]) => ({ id: k, t0: v.t0 }))].sort((a, b) => a.t0 - b.t0 || a.id.localeCompare(b.id));
        const i = list.findIndex(x => x.id === id);
        if (i % 2 === 0 && list[i + 1]) host(list[i + 1].id);
    };
    hbT = setInterval(tick, 1000); tick();
    return true;
}

async function host(partner) {
    if (matched) return;
    matched = true;
    const code = newCode();
    const qt = t; t = null; clearInterval(hbT); hbT = 0;     // keep the queue channel just long enough to announce
    const ok = await hostRoom(code);
    if (!ok) { qt.close(); matched = false; Queue.active = false; Queue.onChange(); return; }
    Online.viaQueue = true;
    let n = 0;
    announcing = setInterval(() => {
        qt.send({ t: 'matched', a: id, b: partner, code });
        if (++n >= 8 || Online.status === 'connected') { clearInterval(announcing); announcing = 0; qt.send({ t: 'unq', id }); qt.close(); Queue.active = false; Queue.onChange(); }
    }, 500);
    setTimeout(() => {                                         // the partner never showed up (they matched someone else): search again
        if (Online.role === 'host' && Online.status !== 'connected') { leaveRoom(false); joinQueue(); }
    }, 9000);
}
