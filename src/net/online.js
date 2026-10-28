// Online room logic: create / join a room by code, then run host or guest.
//   Host  : runs the real simulation (core.step), steers the guest's fighter from their inputs and
//           streams snapshots.
//   Guest : sends inputs, mirrors snapshots. See "Online play" in core.js.
import { S, p1, p2, startMatchSequence, applyRemote, applySnapshot, NETHOOK, resetSnapshotState, removeFighter } from '../core.js';
import { openTransport, hasRealtime } from './transport.js';
import { isDown } from '../controls.js';
import { displayName } from '../account.js';
import { bindChat, onRemoteChat, clearChat } from './chat.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const TIMEOUT_MS = 7000;

export const Online = {
    role: null,           // 'host' | 'guest' | null
    code: '',
    status: 'idle',       // idle | waiting | joining | connected | closed
    note: '',
    name: 'Player',
    mode: 'pvp',          // 'pvp' (1v1) | 'lobby' (up to 8)
    viaQueue: false,
    slot: 1,              // my fighter slot (0 = host)
    myId: '',
    lobby: { members: [], settings: { teams: false, startDamage: 0, stocks: 3 }, started: false },
    peerName: 'Opponent',
    t: null,
    lastRecv: 0,
    onChange: () => {},   // UI refresh
    onLeft: () => {},     // peer left / connection lost
};

let lastHeld = '';
let pingTimer = 0, watchTimer = 0, lobbyTimer = 0;
const TEAMS = ['red', 'blue', 'yellow', 'green'];
const MAX_PLAYERS = 8;

function set(status, note = '') { Online.status = status; Online.note = note; Online.onChange(); }

function stopTimers() { clearInterval(pingTimer); clearInterval(watchTimer); pingTimer = watchTimer = 0; }

export function isOnline() { return !!Online.role; }

/** ---- common ---- */
export function leaveRoom(notify = true) {
    if (Online.t) {
        if (notify) Online.t.send({ t: 'leave', id: Online.myId });
        Online.t.close();
    }
    Online.t = null; Online.role = null; Online.code = ''; stopTimers(); bindChat(null);
    NETHOOK.send = null; S.online = null; S.opponentName = null; lastHeld = '';
    Online.lobby = { members: [], settings: { teams: false, startDamage: 0, stocks: 3 }, started: false }; Online.slot = 1; clearInterval(lobbyTimer);
    set('idle');
}

function watch() {
    Online.lastRecv = performance.now();
    watchTimer = setInterval(() => {
        if (Online.status !== 'connected' || (Online.role === 'host' && Online.mode === 'lobby')) return;
        if (performance.now() - Online.lastRecv > TIMEOUT_MS) { const cb = Online.onLeft; leaveRoom(false); set('closed', 'Connection lost'); cb('Connection lost'); }
    }, 1000);
}

/** ---- host ---- */
export async function hostRoom(code, mode = 'pvp') {
    leaveRoom(false);
    Online.name = displayName(); Online.mode = mode; Online.viaQueue = false;
    Online.role = 'host'; Online.code = code || newCode();
    set('waiting', 'Opening room…');
    try { Online.t = await openTransport(Online.code); } catch (e) { Online.role = null; set('closed', e.message); return false; }
    const t = Online.t;
    t.onmessage = (m) => {
        Online.lastRecv = performance.now();
        switch (m.t) {
            case 'hello':
                if (Online.mode === 'lobby') { lobbyHello(m); break; }
                if (Online.status === 'connected') { t.send({ t: 'full', to: m.id }); break; }
                Online.peerName = (m.name || 'Guest').slice(0, 20);
                t.send({ t: 'welcome', name: Online.name, mode: 'pvp', to: m.id, slot: 1 });
                set('connected', Online.peerName + ' joined');
                beginMatch();
                break;
            case 'held': case 'act': { const mem = memberOf(m); if (Online.mode === 'lobby') { if (mem) { mem.seen = performance.now(); applyRemote(m, mem.slot); } } else applyRemote(m); break; }
            case 'team': { const mem = memberOf(m); if (mem && !Online.lobby.started && TEAMS.includes(m.team)) { mem.team = m.team; lobbyPush(); } break; }
            case 'rematch': if (Online.mode === 'lobby') { if (Online.lobby.started && S.gameState === 'gameover') beginLobbyMatch(); } else if (Online.status === 'connected') beginMatch(); break;
            case 'leave': {
                if (Online.mode === 'lobby') { const mem = memberOf(m); if (mem) dropMember(mem); break; }
                const cb = Online.onLeft; leaveRoom(false); set('closed', 'Opponent left'); cb('Opponent left'); break;
            }
            case 'chat': onRemoteChat(m); break;
            case 'ping': { const mem = memberOf(m); if (mem) mem.seen = performance.now(); break; }
        }
    };
    bindChat((msg) => t.send(msg)); clearChat();
    watch();
    if (mode === 'lobby') {
        Online.lobby = { members: [{ id: 'host', slot: 0, name: Online.name, team: 'red', seen: Infinity }], settings: { teams: false, startDamage: 0, stocks: 3 }, started: false };
        Online.slot = 0;
        lobbyTimer = setInterval(lobbyTick, 1500);
        set('connected', 'Lobby open. Share the code ' + Online.code);
    } else set('waiting', 'Waiting for a friend. Share the code ' + Online.code);
    return true;
}

// ---------------------------------------------------------------- custom-match lobby (host side)
const memberOf = (m) => Online.lobby.members.find(x => x.id === m.id && x.id !== 'host');
const publicLobby = () => ({ t: 'lobby', settings: Online.lobby.settings, started: Online.lobby.started, members: Online.lobby.members.map(x => ({ slot: x.slot, name: x.name, team: x.team, bot: x.bot || null })) });
export function lobbyPush() { if (Online.role === 'host' && Online.mode === 'lobby') { Online.t.send(publicLobby()); Online.onChange(); } }
function lobbyHello(m) {
    const L = Online.lobby;
    let mem = L.members.find(x => x.id === m.id);
    if (!mem) {
        if (L.started) { Online.t.send({ t: 'full', to: m.id, why: 'That match already started' }); return; }
        if (L.members.length >= MAX_PLAYERS) { Online.t.send({ t: 'full', to: m.id, why: 'That lobby is full (8 players)' }); return; }
        let slot = 1; while (L.members.some(x => x.slot === slot)) slot++;
        const counts = TEAMS.map(tm => L.members.filter(x => x.team === tm).length);
        mem = { id: m.id, slot, name: String(m.name || 'Guest').slice(0, 20), team: TEAMS[counts.indexOf(Math.min(...counts))], seen: performance.now() };
        L.members.push(mem);
    }
    Online.t.send({ t: 'welcome', name: Online.name, mode: 'lobby', to: m.id, slot: mem.slot });
    lobbyPush();
}
function dropMember(mem) {
    const L = Online.lobby;
    L.members = L.members.filter(x => x !== mem);
    if (L.started) removeFighter(mem.slot);
    lobbyPush();
}
function lobbyTick() {
    if (Online.role !== 'host') return;
    const now = performance.now();
    for (const mem of Online.lobby.members.slice()) if (mem.id !== 'host' && now - mem.seen > 9000) dropMember(mem);
    Online.t.send(publicLobby());
}
export function setLobbySetting(k, v) {
    if (Online.role !== 'host' || Online.lobby.started) return;
    if (Online.lobby.settings[k] === v) return;       // no change: don't rebuild the panel under the user's mouse
    Online.lobby.settings[k] = v; lobbyPush();
}
export function setMemberTeam(slot, team) {
    if (Online.role === 'host') { const mem = Online.lobby.members.find(x => x.slot === slot); if (mem && TEAMS.includes(team)) { mem.team = team; lobbyPush(); } }
    else if (Online.role === 'guest' && slot === Online.slot && Online.t) Online.t.send({ t: 'team', id: Online.myId, team });
}
export function addBot(level) {
    if (Online.role !== 'host' || Online.mode !== 'lobby' || Online.lobby.started) return false;
    const L = Online.lobby;
    if (L.members.length >= MAX_PLAYERS || !['easy', 'medium', 'hard'].includes(level)) return false;
    let slot = 1; while (L.members.some(x => x.slot === slot)) slot++;
    const counts = TEAMS.map(tm => L.members.filter(x => x.team === tm).length);
    const n = L.members.filter(x => x.bot).length + 1;
    L.members.push({ id: 'bot' + slot + '_' + Math.random().toString(36).slice(2, 5), slot, name: `CPU ${n} (${level})`, team: TEAMS[counts.indexOf(Math.min(...counts))], bot: level, seen: Infinity });
    lobbyPush();
    return true;
}
export function kickMember(slot) {
    if (Online.role !== 'host') return;
    const mem = Online.lobby.members.find(x => x.slot === slot); if (!mem || mem.id === 'host') return;
    if (!mem.bot) Online.t.send({ t: 'kick', to: mem.id });
    dropMember(mem);
}
export function beginLobbyMatch() {
    if (Online.role !== 'host' || Online.mode !== 'lobby') return false;
    const L = Online.lobby;
    if (L.members.length < 2) { Online.note = 'You need at least 2 players'; Online.onChange(); return false; }
    L.started = true;
    const cfg = { players: L.members.map(x => ({ slot: x.slot, name: x.name, team: x.team, bot: x.bot || null })), teams: L.settings.teams, startDamage: +L.settings.startDamage || 0, stocks: +L.settings.stocks || 3 };
    S.online = 'host'; S.opponentName = null;
    NETHOOK.send = (snap) => Online.t && Online.t.send({ t: 'snap', s: snap });
    Online.t.send({ t: 'start', cfg });
    startMatchSequence('lobby', { ...cfg, mySlot: 0 });
    Online.onChange();
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
    Online.name = displayName(); Online.viaQueue = false;
    code = (code || '').trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { set('closed', 'Codes are 4 letters'); return false; }
    Online.role = 'guest'; Online.code = code;
    set('joining', 'Connecting…');
    try { Online.t = await openTransport(code); } catch (e) { Online.role = null; set('closed', e.message); return false; }
    const t = Online.t;
    const myId = Online.myId = Math.random().toString(36).slice(2, 8);
    let welcomed = false;
    t.onmessage = (m) => {
        Online.lastRecv = performance.now();
        switch (m.t) {
            case 'welcome': if (m.to && m.to !== myId) break; Online.mode = m.mode === 'lobby' ? 'lobby' : 'pvp'; Online.slot = m.slot || 1; welcomed = true; Online.peerName = (m.name || 'Host').slice(0, 20); set('connected', 'Connected to ' + Online.peerName); break;
            case 'full': if (m.to === myId) { leaveRoom(false); set('closed', m.why || 'That room is full'); } break;
            case 'kick': if (m.to === myId) { const cb = Online.onLeft; leaveRoom(false); set('closed', 'You were removed from the lobby'); cb('You were removed from the lobby'); } break;
            case 'lobby': if (welcomed) { Online.lobby = { members: m.members, settings: m.settings, started: m.started }; Online.onChange(); } break;
            case 'start': if (m.cfg) { S.online = 'guest'; Online.lobby.started = true; resetSnapshotState(); startMatchSequence('lobby', { ...m.cfg, mySlot: Online.slot }); Online.onChange(); break; }
                Online.peerName = (m.name || Online.peerName).slice(0, 20); S.online = 'guest'; S.opponentName = Online.peerName; resetSnapshotState(); startMatchSequence('online'); break;
            case 'snap': if (S.online === 'guest') applySnapshot(m.s); break;
            case 'leave': { const cb = Online.onLeft; leaveRoom(false); set('closed', 'The host left'); cb('The host left'); break; }
            case 'chat': onRemoteChat(m); break;
        }
    };
    bindChat((msg) => t.send(msg)); clearChat();
    watch();
    const hello = () => t.send({ t: 'hello', id: myId, name: Online.name });
    hello();
    const retry = setInterval(() => { if (welcomed || Online.role !== 'guest') clearInterval(retry); else hello(); }, 500);
    setTimeout(() => { if (!welcomed && Online.role === 'guest') { clearInterval(retry); leaveRoom(false); set('closed', 'No room with that code'); } }, 8000);
    pingTimer = setInterval(() => Online.t && Online.t.send({ t: 'ping', id: myId }), 2000);
    return true;
}

/** ---- guest input forwarding (main.js calls these instead of acting locally) ---- */
export function sendAct(a, extra = {}) { if (Online.role === 'guest' && Online.t) Online.t.send({ t: 'act', id: Online.myId, a, ...extra }); }
export function sendHeld(aim) {
    if (Online.role !== 'guest' || !Online.t) return;
    const h = { left: isDown('left'), right: isDown('right'), shield: isDown('shield'), drop: isDown('drop') };
    const key = JSON.stringify(h);
    if (key === lastHeld && !aim) return;
    lastHeld = key;
    Online.t.send({ t: 'held', id: Online.myId, ...h, ...(aim || {}) });
}
export function requestRematch() { if (Online.role === 'guest' && Online.t) Online.t.send({ t: 'rematch' }); else if (Online.role === 'host') { if (Online.mode === 'lobby') beginLobbyMatch(); else beginMatch(); } }
export { hasRealtime };
