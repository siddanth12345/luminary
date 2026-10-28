// Party: a small group (leader + up to 4) that stays together and goes into matches together.
// Runs on its own channel; the leader launches a 1v1 (exactly 2 members) or a custom match lobby.
import { openTransport } from './transport.js';
import { displayName } from '../account.js';
import { Online, hostRoom, joinRoom } from './online.js';

export const PARTY_MAX = 5;
const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => Array.from({ length: 4 }, () => CH[Math.floor(Math.random() * CH.length)]).join('');

export const Party = {
    role: null,                   // 'leader' | 'member' | null
    code: '', myId: '', members: [],   // [{ id, name }] leader first
    note: '', t: null,
    onChange: () => {}, onGo: () => {},
};
let seen = {}, beat = 0, lastLeader = 0;
const set = (note) => { Party.note = note || ''; Party.onChange(); };
const roster = () => ({ t: 'roster', members: Party.members.map(m => ({ id: m.id, name: m.name })) });

export function leaveParty(notify = true) {
    if (Party.t) {
        if (notify) Party.t.send(Party.role === 'leader' ? { t: 'disband' } : { t: 'leave', id: Party.myId });
        Party.t.close();
    }
    clearInterval(beat); beat = 0;
    Party.t = null; Party.role = null; Party.code = ''; Party.members = []; seen = {};
    Party.onChange();
}

export async function createParty() {
    if (Party.role) return false;
    Party.code = newCode(); Party.myId = 'leader'; Party.role = 'leader';
    Party.members = [{ id: 'leader', name: displayName() }];
    try { Party.t = await openTransport('party-' + Party.code); } catch (e) { Party.role = null; Party.code = ''; set(e.message); return false; }
    Party.t.onmessage = (m) => {
        if (m.t === 'hello') {
            let mem = Party.members.find(x => x.id === m.id);
            if (!mem) {
                if (Party.members.length >= PARTY_MAX) { Party.t.send({ t: 'full', to: m.id }); return; }
                mem = { id: m.id, name: String(m.name || 'Player').slice(0, 20) }; Party.members.push(mem);
            }
            seen[m.id] = performance.now();
            Party.t.send({ t: 'welcome', to: m.id }); Party.t.send(roster()); Party.onChange();
        } else if (m.t === 'ping' && seen[m.id] !== undefined) seen[m.id] = performance.now();
        else if (m.t === 'leave') { Party.members = Party.members.filter(x => x.id !== m.id); delete seen[m.id]; Party.t.send(roster()); Party.onChange(); }
    };
    beat = setInterval(() => {
        const now = performance.now();
        const before = Party.members.length;
        Party.members = Party.members.filter(x => x.id === 'leader' || now - (seen[x.id] || 0) < 9000);
        Party.t.send(roster());
        if (Party.members.length !== before) Party.onChange();
    }, 1500);
    set('Party created. Invite your borgs.');
    return true;
}

export async function joinParty(code) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { set('Party codes are 4 letters'); return false; }
    if (Party.role) leaveParty(true);
    Party.code = code; Party.role = 'member'; Party.myId = Math.random().toString(36).slice(2, 8); Party.members = [];
    try { Party.t = await openTransport('party-' + code); } catch (e) { Party.role = null; Party.code = ''; set(e.message); return false; }
    let welcomed = false;
    lastLeader = performance.now();
    Party.t.onmessage = (m) => {
        if (m.t === 'welcome' && m.to === Party.myId) { welcomed = true; set('Joined the party'); }
        else if (m.t === 'full' && m.to === Party.myId) { leaveParty(false); set('That party is full'); }
        else if (m.t === 'roster' && welcomed) { lastLeader = performance.now(); Party.members = m.members; Party.onChange(); }
        else if (m.t === 'disband') { leaveParty(false); set('The party was disbanded'); }
        else if (m.t === 'kick' && m.to === Party.myId) { leaveParty(false); set('You were removed from the party'); }
        else if (m.t === 'go' && welcomed) Party.onGo(m);
    };
    const hello = () => Party.t && Party.t.send({ t: 'hello', id: Party.myId, name: displayName() });
    hello();
    const retry = setInterval(() => { if (welcomed || !Party.t) clearInterval(retry); else hello(); }, 500);
    setTimeout(() => { if (!welcomed && Party.role === 'member') { leaveParty(false); set('No party with that code'); } }, 8000);
    beat = setInterval(() => {
        if (!Party.t) return;
        Party.t.send({ t: 'ping', id: Party.myId });
        if (welcomed && performance.now() - lastLeader > 9000) { leaveParty(false); set('Lost connection to the party'); }
    }, 2000);
    Party.onChange();
    return true;
}

export function kickFromParty(id) {
    if (Party.role !== 'leader' || id === 'leader') return;
    Party.t.send({ t: 'kick', to: id });
    Party.members = Party.members.filter(x => x.id !== id); delete seen[id];
    Party.t.send(roster()); Party.onChange();
}

/** leader: take everyone into a 1v1 (needs exactly 2 members) or a custom match lobby */
export async function partyGo(kind) {
    if (Party.role !== 'leader') return { ok: false, msg: 'Only the party leader can start.' };
    if (Online.role) return { ok: false, msg: 'Leave your current room first.' };
    if (kind === '1v1' && Party.members.length !== 2) return { ok: false, msg: 'A 1v1 needs exactly 2 party members.' };
    if (Party.members.length < 2) return { ok: false, msg: 'Invite at least one borg first.' };
    const ok = await hostRoom(undefined, kind === 'lobby' ? 'lobby' : 'pvp');
    if (!ok) return { ok: false, msg: Online.note || 'Could not open a room.' };
    for (let i = 0; i < 3; i++) setTimeout(() => Party.t && Party.t.send({ t: 'go', kind, code: Online.code }), i * 300);
    return { ok: true, msg: '' };
}
export function followGo(m) { return joinRoom(m.code); }
