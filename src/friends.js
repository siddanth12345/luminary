// "Borgs" = friends (Table Wars calls them tbles). A borg request is sent by exact username, the other player
// accepts or declines, and borgs show a green dot when online. Up to 75. Guests can have borgs too, but only
// for the open tab; a guest that leaves shows up as "splintered" to the people who had requested them.
import { ACC, displayName } from './account.js';

export const MAX_BORGS = 75;
let borgs = [];          // { name, addedAt, splintered? }
let outgoing = [];       // { id, from, to, t }
let incoming = [];       // { id, from, to, t, splintered? }
let version = 0;
const subs = new Set();
export const onBorgs = (f) => { subs.add(f); return () => subs.delete(f); };
export const borgVersion = () => version;
function bump() { version++; subs.forEach(f => f()); }

let persister = null;
export const setBorgsPersister = (f) => { persister = f; };
const persistBorgs = () => { try { persister && persister(); } catch (e) { /* ignore */ } };

const reqKey = () => 'luminary-breq-' + (ACC.status === 'user' ? ACC.userId : 'guest');
function writeReqs() { try { localStorage.setItem(reqKey(), JSON.stringify({ outgoing, incoming })); } catch (e) { /* ignore */ } }
export function reloadRequests() {
    try { const d = JSON.parse(localStorage.getItem(reqKey()) || 'null'); outgoing = (d && d.outgoing) || []; incoming = (d && d.incoming) || []; }
    catch (e) { outgoing = []; incoming = []; }
    markStale(); bump();
}

export const isGuestName = (n) => /^guest\d{6}$/i.test((n || '').trim());
const same = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
export const isSelf = (n) => same(n, displayName());
export const isBorg = (n) => borgs.some(b => same(b.name, n));
export const getBorgs = () => borgs;
export const getRequests = () => ({ incoming, outgoing });
export const borgCount = () => borgs.length;

export const serializeBorgs = () => borgs.map(b => ({ name: b.name, addedAt: b.addedAt }));
export function hydrateBorgs(raw, merge = false) {
    const list = (Array.isArray(raw) ? raw : []).filter(x => x && typeof x.name === 'string' && x.name.trim().length >= 3)
        .map(x => ({ name: x.name.trim(), addedAt: +x.addedAt || Date.now() }));
    if (merge) {
        const map = new Map(borgs.map(b => [b.name.toLowerCase(), b]));
        for (const b of list) if (!map.has(b.name.toLowerCase())) map.set(b.name.toLowerCase(), b);
        borgs = [...map.values()].slice(0, MAX_BORGS);
    } else borgs = list.slice(0, MAX_BORGS);
    bump();
}

export function addBorgDirect(name) {
    const n = (name || '').trim();
    if (n.length < 3 || isSelf(n)) return { ok: false, msg: "Can't add that borg." };
    if (isBorg(n)) return { ok: true, msg: 'Already borgs.' };
    if (borgs.length >= MAX_BORGS) return { ok: false, msg: 'Too many borgs.' };
    borgs = [...borgs, { name: n, addedAt: Date.now() }];
    outgoing = outgoing.filter(r => !same(r.to, n));
    incoming = incoming.filter(r => !same(r.from, n));
    writeReqs(); persistBorgs(); bump();
    return { ok: true, msg: `Added ${n}.` };
}
export function removeBorg(name) { borgs = borgs.filter(b => !same(b.name, name)); persistBorgs(); bump(); }

export function noteOutgoing(req) {
    if (outgoing.some(r => r.id === req.id)) return;
    outgoing = [...outgoing.filter(r => !same(r.to, req.to)), req];
    writeReqs(); bump();
}
export function noteIncoming(req) {
    if (isSelf(req.from) || isBorg(req.from)) return false;
    if (incoming.some(r => r.id === req.id || same(r.from, req.from))) return false;
    incoming = [...incoming, { ...req, splintered: false }];
    writeReqs(); bump();
    return true;
}
export function removeIncoming(id) { incoming = incoming.filter(r => r.id !== id); writeReqs(); bump(); }
export function removeOutgoing(id) { outgoing = outgoing.filter(r => r.id !== id); writeReqs(); bump(); }

/** a guest left: their pending requests / borg entries can never be answered again */
export function markSplinteredFrom(name) {
    if (!isGuestName(name)) return;       // a real account just comes back later
    let ch = false;
    incoming = incoming.map(r => same(r.from, name) && !r.splintered ? (ch = true, { ...r, splintered: true }) : r);
    borgs = borgs.map(b => same(b.name, name) && !b.splintered ? (ch = true, { ...b, splintered: true }) : b);
    if (ch) { writeReqs(); bump(); }
}
function markStale() {
    const now = Date.now();
    incoming = incoming.map(r => !r.splintered && isGuestName(r.from) && now - r.t > 10 * 60_000 ? { ...r, splintered: true } : r);
}

// who is online right now (lowercase names), fed by the inbox bus
let online = new Set();
export const isOnlineName = (n) => online.has((n || '').trim().toLowerCase());
export function setOnlineNames(next) {
    if (next.size === online.size && [...next].every(n => online.has(n))) return;
    online = next; bump();
}
