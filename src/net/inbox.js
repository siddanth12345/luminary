// The shared "bus": who is online, borg requests, and match invites. One broadcast channel that every
// signed-in player and guest listens to; messages are addressed by username. (Table Wars does the same
// with its invite bus.)
import { openTransport } from './transport.js';
import { ACC, displayName, lookupUsername } from '../account.js';
import * as B from '../friends.js';
import { Online, hostRoom, joinRoom } from './online.js';

export const Inbox = {
    invites: [],                 // pending match invites: { id, from, code, kind, expires }
    onRequest: () => {},         // (fromName) a borg request arrived
    onInvite: () => {},          // (invite)
    sentAt: 0,
};
let t = null, beatT = 0, me = '';
const seen = new Map();
const isRec = (x) => x && typeof x === 'object';
const txt = (x, n) => typeof x === 'string' && x.length > 0 && x.length <= n;

function send(msg, times = 1, gap = 200) {
    return (async () => { for (let i = 0; i < times; i++) { try { t && t.send(msg); } catch (e) { /* ignore */ } if (times > 1) await new Promise(r => setTimeout(r, gap)); } })();
}
function beat() {
    if (!t) return;
    t.send({ t: 'here', name: me });
    const now = Date.now(), names = new Set();
    for (const [n, ts] of seen) { if (now - ts > 12000) seen.delete(n); else names.add(n); }
    B.setOnlineNames(names);
}
function handle(m) {
    if (!isRec(m)) return;
    switch (m.t) {
        case 'here': if (txt(m.name, 40) && m.name !== me) seen.set(m.name, Date.now()); break;
        case 'req':
            if (!txt(m.id, 80) || !txt(m.from, 40) || !txt(m.to, 40) || m.to.toLowerCase() !== me) break;
            if (B.noteIncoming({ id: m.id, from: m.from, to: m.to, t: Date.now() })) Inbox.onRequest(m.from);
            break;
        case 'accept':
            if (!txt(m.from, 40) || !txt(m.to, 40) || m.to.toLowerCase() !== me) break;
            B.addBorgDirect(m.from);
            break;
        case 'splinter': if (txt(m.from, 40)) B.markSplinteredFrom(m.from); break;
        case 'invite': {
            if (!txt(m.from, 40) || !txt(m.to, 40) || !txt(m.code, 8) || m.to.toLowerCase() !== me) break;
            const inv = { id: Math.random().toString(36).slice(2), from: m.from, code: m.code, kind: m.kind === 'lobby' ? 'lobby' : '1v1', expires: Date.now() + 20000 };
            const dup = Inbox.invites.some(i => i.from === inv.from && i.code === inv.code && i.expires > Date.now());
            Inbox.invites = [...Inbox.invites.filter(i => i.from !== inv.from), dup ? Inbox.invites.find(i => i.from === inv.from) : inv];
            if (!dup) Inbox.onInvite(inv);
            break;
        }
    }
}

export async function startInbox() {
    stopInbox();
    if (ACC.status !== 'user' && ACC.status !== 'guest') return;
    me = displayName().toLowerCase();
    try { t = await openTransport('bus'); } catch (e) { t = null; return; }
    t.onmessage = handle;
    beat(); beatT = setInterval(beat, 4000);
}
export function stopInbox() {
    clearInterval(beatT); beatT = 0;
    if (t) t.close();
    t = null; seen.clear(); B.setOnlineNames(new Set());
}
/** tell everyone who requested this guest that it is gone (called when a guest leaves) */
export function announceSplinter() { if (t && ACC.status === 'guest') for (let i = 0; i < 3; i++) t.send({ t: 'splinter', from: displayName() }); }

export async function sendBorgRequest(username) {
    const name = (username || '').trim();
    if (ACC.status !== 'user' && ACC.status !== 'guest') return { ok: false, msg: 'Log in or play as guest first.' };
    if (!name) return { ok: false, msg: 'Enter a username.' };
    if (B.isSelf(name)) return { ok: false, msg: "You can't add yourself as a borg." };
    if (B.isBorg(name)) return { ok: false, msg: 'Already borgs.' };
    if (B.borgCount() >= B.MAX_BORGS) return { ok: false, msg: 'Too many borgs.' };
    if (Date.now() - Inbox.sentAt < 2000) return { ok: false, msg: 'Wait a moment before sending another borg request.' };
    if (!B.isGuestName(name) && !(await lookupUsername(name))) return { ok: false, msg: 'No player with that exact username.' };
    Inbox.sentAt = Date.now();
    if (!t) await startInbox();
    const req = { id: Math.random().toString(36).slice(2) + Date.now().toString(36), from: displayName(), to: name, t: Date.now() };
    B.noteOutgoing(req);
    await send({ t: 'req', id: req.id, from: req.from, to: name.toLowerCase() }, 5, 200);
    return { ok: true, msg: `Borg request sent to ${name}.` };
}
export async function acceptRequest(req) {
    const r = B.addBorgDirect(req.from);
    if (!r.ok) return r;
    B.removeIncoming(req.id);
    await send({ t: 'accept', from: displayName(), to: req.from.toLowerCase(), id: req.id }, 5, 200);
    return { ok: true, msg: `You and ${req.from} are now borgs.` };
}
export const declineRequest = (req) => B.removeIncoming(req.id);
export const cancelRequest = (req) => B.removeOutgoing(req.id);

/** invite a borg into a private room: we host it and send them the code */
export async function inviteBorg(name, kind = '1v1') {
  if (Online.role) return { ok: false, msg: 'Leave your current room first.' };
  if (!B.isOnlineName(name)) return { ok: false, msg: `${name} is not online right now.` };
  const ok = await hostRoom(undefined, kind === 'lobby' ? 'lobby' : 'pvp');
  if (!ok) return { ok: false, msg: Online.note || 'Could not open a room.' };
  await send({ t: 'invite', kind, from: displayName(), to: name.toLowerCase(), code: Online.code }, 4, 150);
  return { ok: true, msg: `Invite sent to ${name}. Waiting for them to join…` };
}
/** invite another borg into the lobby I am already hosting */
export async function inviteToLobby(name) {
  if (Online.role !== 'host' || Online.mode !== 'lobby') return { ok: false, msg: 'Create a lobby first.' };
  if (!B.isOnlineName(name)) return { ok: false, msg: `${name} is not online right now.` };
  await send({ t: 'invite', kind: 'lobby', from: displayName(), to: name.toLowerCase(), code: Online.code }, 4, 150);
  return { ok: true, msg: `Invite sent to ${name}.` };
}
export async function acceptInvite(inv) {
  Inbox.invites = Inbox.invites.filter(i => i.id !== inv.id);
  return joinRoom(inv.code);
}
