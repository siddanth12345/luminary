// Online room logic: create / join a room by code, then run host or guest.
//   Host  : runs the real simulation (core.step), steers the guest's fighter from their inputs and
//           streams snapshots.
//   Guest : sends inputs, mirrors snapshots. See "Online play" in core.js.
import { S, p1, p2, startMatchSequence, applyRemote, applySnapshot, NETHOOK, resetSnapshotState } from '../core.js';
import { openTransport, hasRealtime } from './transport.js';
import { isDown } from '../controls.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const TIMEOUT_MS = 7000;

export const Online = {
    role: null,           // 'host' | 'guest' | null
    code: '',
    status: 'idle',       // idle | waiting | joining | connected | closed
    note: '',
    name: 'Player',
    peerName: 'Opponent',
    t: null,
    lastRecv: 0,
    onChange: () => {},   // UI refresh
    onLeft: () => {},     // peer left / connection lost
};

let lastHeld = '';
let pingTimer = 0, watchTimer = 0;

function set(status, note = '') { Online.status = status; Online.note = note; Online.onChange(); }

function stopTimers() { clearInterval(pingTimer); clearInterval(watchTimer); pingTimer = watchTimer = 0; }

export function isOnline() { return !!Online.role; }

/** ---- common ---- */
export function leaveRoom(notify = true) {
    if (Online.t) {
        if (notify) Online.t.send({ t: 'leave' });
        Online.t.close();
    }
    Online.t = null; Online.role = null; Online.code = ''; stopTimers();
    NETHOOK.send = null; S.online = null; S.opponentName = null; lastHeld = '';
    set('idle');
}

function watch() {
    Online.lastRecv = performance.now();
    watchTimer = setInterval(() => {
        if (Online.status !== 'connected') return;
        if (performance.now() - Online.lastRecv > TIMEOUT_MS) { const cb = Online.onLeft; leaveRoom(false); set('closed', 'Connection lost'); cb('Connection lost'); }
    }, 1000);
}

/** ---- host ---- */
export async function hostRoom() {
    leaveRoom(false);
    Online.role = 'host'; Online.code = newCode();
    set('waiting', 'Opening room…');
    try { Online.t = await openTransport(Online.code); } catch (e) { Online.role = null; set('closed', e.message); return false; }
    const t = Online.t;
    t.onmessage = (m) => {
        Online.lastRecv = performance.now();
        switch (m.t) {
            case 'hello':
                if (Online.status === 'connected') { t.send({ t: 'full', to: m.id }); break; }
                Online.peerName = (m.name || 'Guest').slice(0, 20);
                t.send({ t: 'welcome', name: Online.name });
                set('connected', Online.peerName + ' joined');
                beginMatch();
                break;
            case 'held': case 'act': applyRemote(m); break;
            case 'rematch': if (Online.status === 'connected') beginMatch(); break;
            case 'leave': { const cb = Online.onLeft; leaveRoom(false); set('closed', 'Opponent left'); cb('Opponent left'); break; }
            case 'ping': break;
        }
    };
    watch();
    set('waiting', 'Waiting for a friend. Share the code ' + Online.code);
    return true;
}

export function beginMatch() {
    if (Online.role !== 'host') return;
    S.online = 'host'; S.opponentName = Online.peerName;
    NETHOOK.send = (snap) => Online.t && Online.t.send({ t: 'snap', s: snap });
    Online.t.send({ t: 'start', name: Online.name });
    startMatchSequence('online');
}

/** ---- guest ---- */
export async function joinRoom(code) {
    leaveRoom(false);
    code = (code || '').trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { set('closed', 'Codes are 4 letters'); return false; }
    Online.role = 'guest'; Online.code = code;
    set('joining', 'Connecting…');
    try { Online.t = await openTransport(code); } catch (e) { Online.role = null; set('closed', e.message); return false; }
    const t = Online.t;
    const myId = Math.random().toString(36).slice(2, 8);
    let welcomed = false;
    t.onmessage = (m) => {
        Online.lastRecv = performance.now();
        switch (m.t) {
            case 'welcome': welcomed = true; Online.peerName = (m.name || 'Host').slice(0, 20); set('connected', 'Connected to ' + Online.peerName); break;
            case 'full': if (m.to === myId) { leaveRoom(false); set('closed', 'That room is full'); } break;
            case 'start': Online.peerName = (m.name || Online.peerName).slice(0, 20); S.online = 'guest'; S.opponentName = Online.peerName; resetSnapshotState(); startMatchSequence('online'); break;
            case 'snap': if (S.online === 'guest') applySnapshot(m.s); break;
            case 'leave': { const cb = Online.onLeft; leaveRoom(false); set('closed', 'The host left'); cb('The host left'); break; }
        }
    };
    watch();
    const hello = () => t.send({ t: 'hello', id: myId, name: Online.name });
    hello();
    const retry = setInterval(() => { if (welcomed || Online.role !== 'guest') clearInterval(retry); else hello(); }, 500);
    setTimeout(() => { if (!welcomed && Online.role === 'guest') { clearInterval(retry); leaveRoom(false); set('closed', 'No room with that code'); } }, 5000);
    pingTimer = setInterval(() => Online.t && Online.t.send({ t: 'ping' }), 2000);
    return true;
}

/** ---- guest input forwarding (main.js calls these instead of acting locally) ---- */
export function sendAct(a, extra = {}) { if (Online.role === 'guest' && Online.t) Online.t.send({ t: 'act', a, ...extra }); }
export function sendHeld(aim) {
    if (Online.role !== 'guest' || !Online.t) return;
    const h = { left: isDown('left'), right: isDown('right'), shield: isDown('shield') };
    const key = JSON.stringify(h);
    if (key === lastHeld && !aim) return;
    lastHeld = key;
    Online.t.send({ t: 'held', ...h, ...(aim || {}) });
}
export function requestRematch() { if (Online.role === 'guest' && Online.t) Online.t.send({ t: 'rematch' }); else if (Online.role === 'host') beginMatch(); }
export { hasRealtime };
