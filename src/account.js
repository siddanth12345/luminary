// Accounts, guests and progress transfer. Mirrors how Table Wars does it:
//   - username (3-20) + password (3-20, 1 upper, 1 lower, 1 number); optional contact email
//   - "Play as guest" gives you a random name (guest482913); guest data lives only in this tab
//   - signing in from a guest can TRANSFER the guest's borgs / record / controls into the account
//   - an account saves: controls, borgs (friends) and the 1v1 win/loss record
// Two backends: Supabase (when src/net/config.js is filled in) or a local one (this browser only) so the
// whole flow can be used and tested with no server.
import { getClient, supabaseConfigured } from './net/supa.js';
import { exportBindings, importBindings, setBindingsPersister } from './controls.js';
import * as Borgs from './friends.js';

export const ACC = { status: 'loading', userId: null, username: '' };   // status: loading | signedOut | guest | user
const subs = new Set();
export const onAccount = (f) => { subs.add(f); return () => subs.delete(f); };
function set(p) { Object.assign(ACC, p); subs.forEach(f => f()); }

const stats = { wins: 0, losses: 0 };
export const getStats = () => ({ ...stats });

// ------------------------------------------------------------------ names
let guestTag = '';
function loadGuestTag() {
    if (guestTag) return guestTag;
    try { const s = sessionStorage.getItem('luminary-guest-tag'); if (s && /^\d{6}$/.test(s)) { guestTag = s; return s; } } catch (e) { /* ignore */ }
    guestTag = String(Math.floor(100000 + Math.random() * 900000));
    try { sessionStorage.setItem('luminary-guest-tag', guestTag); } catch (e) { /* ignore */ }
    return guestTag;
}
/** the name other players see */
export const displayName = () => ACC.status === 'user' ? ACC.username : `guest${loadGuestTag()}`;

export function validateUsername(u) {
    if (u.length < 3 || u.length > 20) return 'Username must be 3-20 characters.';
    if (!/^[A-Za-z0-9_]+$/.test(u)) return 'Username can only use letters, numbers and _.';
    if (u.toLowerCase().startsWith('guest')) return 'Usernames can\'t start with "guest".';
    return null;
}
export function validatePassword(p) {
    if (p.length < 3 || p.length > 20) return 'Password must be 3-20 characters.';
    if (!/[A-Z]/.test(p)) return 'Password needs at least 1 uppercase letter.';
    if (!/[a-z]/.test(p)) return 'Password needs at least 1 lowercase letter.';
    if (!/[0-9]/.test(p)) return 'Password needs at least 1 number.';
    return null;
}
const authPw = (p) => `${p}#lum`;                                 // the auth service wants 6+ characters
const toEmail = (u) => `${u.trim().toLowerCase()}@players.luminary.app`;

// ------------------------------------------------------------------ backends
const LS_ACCOUNTS = 'luminary.local.accounts', LS_SESSION = 'luminary.local.session';
const rd = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
async function sha(text) {
    try {
        const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
    } catch (e) { let h = 5381; for (const c of text) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return String(h); }
}

const LocalBackend = {
    name: 'local',
    async restore() {
        const id = rd(LS_SESSION, null); if (!id) return null;
        const a = Object.values(rd(LS_ACCOUNTS, {})).find(x => x.id === id);
        return a ? { userId: a.id, username: a.username } : null;
    },
    async exists(u) { return !!rd(LS_ACCOUNTS, {})[u.toLowerCase()]; },
    async signUp(u, pw, email) {
        const all = rd(LS_ACCOUNTS, {});
        if (all[u.toLowerCase()]) return { error: 'That username is taken.' };
        const salt = Math.random().toString(36).slice(2), id = 'local-' + Math.random().toString(36).slice(2, 10);
        all[u.toLowerCase()] = { id, username: u, salt, hash: await sha(salt + pw), email: email || '', data: {} };
        wr(LS_ACCOUNTS, all); wr(LS_SESSION, id);
        return { userId: id, username: u };
    },
    async signIn(u, pw) {
        const a = rd(LS_ACCOUNTS, {})[u.toLowerCase()];
        if (!a || a.hash !== await sha(a.salt + pw)) return { error: 'Wrong username or password.' };
        wr(LS_SESSION, a.id);
        return { userId: a.id, username: a.username };
    },
    async signOut() { try { localStorage.removeItem(LS_SESSION); } catch (e) { /* ignore */ } },
    async load(userId) { const a = Object.values(rd(LS_ACCOUNTS, {})).find(x => x.id === userId); return a ? a.data : {}; },
    async save(userId, data) {
        const all = rd(LS_ACCOUNTS, {});
        for (const k in all) if (all[k].id === userId) all[k].data = data;
        wr(LS_ACCOUNTS, all);
    },
};

const SupaBackend = {
    name: 'supabase',
    async restore() {
        const c = await getClient();
        const { data } = await c.auth.getUser();
        if (!data || !data.user) return null;
        const { data: p } = await c.from('luminary_profiles').select('username').eq('id', data.user.id).maybeSingle();
        return p ? { userId: data.user.id, username: p.username } : null;
    },
    async exists(u) { const c = await getClient(); const { data } = await c.rpc('luminary_username_exists', { _name: u }); return !!data; },
    async signUp(u, pw, email) {
        const c = await getClient();
        const { data, error } = await c.auth.signUp({
            email: toEmail(u), password: authPw(pw),
            options: { data: { username: 'lum_' + u, contact_email: email || '' } },   // prefixed: harmless in a project shared with another game
        });
        if (error) return { error: /registered|exists/i.test(error.message) ? 'That username is taken.' : `Couldn't create the account: ${error.message}` };
        let user = data.user;
        if (!data.session) {                                        // email confirmation is on: try to sign in anyway
            const r = await c.auth.signInWithPassword({ email: toEmail(u), password: authPw(pw) });
            if (r.error) return { error: 'Account created, but the server requires email confirmation. Turn off "Confirm email" in Supabase Auth settings.' };
            user = r.data.user;
        }
        const { error: e2 } = await c.from('luminary_profiles').insert({ id: user.id, username: u, email: email || null, settings: {} });
        if (e2) return { error: /duplicate|unique/i.test(e2.message) ? 'That username is taken.' : `Couldn't save the profile: ${e2.message}` };
        return { userId: user.id, username: u };
    },
    async signIn(u, pw) {
        const c = await getClient();
        const { data, error } = await c.auth.signInWithPassword({ email: toEmail(u), password: authPw(pw) });
        if (error) return { error: 'Wrong username or password.' };
        const { data: p } = await c.from('luminary_profiles').select('username').eq('id', data.user.id).maybeSingle();
        return { userId: data.user.id, username: p ? p.username : u };
    },
    async signOut() { const c = await getClient(); await c.auth.signOut(); },
    async load(userId) { const c = await getClient(); const { data } = await c.from('luminary_profiles').select('settings').eq('id', userId).maybeSingle(); return (data && data.settings) || {}; },
    async save(userId, data) { const c = await getClient(); await c.from('luminary_profiles').update({ settings: data, updated_at: new Date().toISOString() }).eq('id', userId); },
};
export const backend = supabaseConfigured() ? SupaBackend : LocalBackend;

// ------------------------------------------------------------------ saved data
const GUEST_KEY = 'luminary-guest-data';
const collect = () => ({ controls: exportBindings(), borgs: Borgs.serializeBorgs(), stats: { ...stats } });

let saveT = 0;
export function persist() {
    clearTimeout(saveT);
    saveT = setTimeout(persistNow, 400);
}
async function persistNow() {
    if (ACC.status === 'user' && ACC.userId) { try { await backend.save(ACC.userId, collect()); } catch (e) { /* retry next change */ } }
    else if (ACC.status === 'guest') { try { sessionStorage.setItem(GUEST_KEY, JSON.stringify(collect())); } catch (e) { /* ignore */ } }
}
setBindingsPersister(() => { if (ACC.status === 'user' || ACC.status === 'guest') persist(); });
Borgs.setBorgsPersister(() => persist());

/** apply saved data. merge = keep what this guest has and add the account's on top (transfer) */
function applyData(d, merge) {
    d = d || {};
    if (merge) {
        Borgs.hydrateBorgs(d.borgs, true);
        stats.wins += (d.stats && d.stats.wins) || 0; stats.losses += (d.stats && d.stats.losses) || 0;
        // controls: the guest's current bindings win (they just set them), the account's only fill nothing
    } else {
        Borgs.hydrateBorgs(d.borgs, false);
        stats.wins = (d.stats && d.stats.wins) || 0; stats.losses = (d.stats && d.stats.losses) || 0;
        if (d.controls) importBindings(d.controls);
    }
}

async function enterUser(r, merge) {
    const data = await backend.load(r.userId);
    set({ status: 'user', userId: r.userId, username: r.username });
    applyData(data, merge);
    await persistNow();
    Borgs.reloadRequests();
    afterChange();
}
export let onProfileChange = () => {};
export const setProfileListener = (f) => { onProfileChange = f; };
function afterChange() { try { onProfileChange(); } catch (e) { /* ui not ready */ } }

export async function initAccount() {
    try { const r = await backend.restore(); if (r) await enterUser(r, false); } catch (e) { /* offline: stay signed out */ }
    if (ACC.status === 'loading') set({ status: 'signedOut' });
}

/** transfer = bring the current guest's borgs / record into the account */
export async function signUp(username, password, email, transfer = false) {
    const err = validateUsername(username) || validatePassword(password);
    if (err) return err;
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return "That email doesn't look right.";
    try {
        if (await backend.exists(username)) return 'That username is taken.';
        const r = await backend.signUp(username, password, email);
        if (r.error) return r.error;
        await enterUser(r, transfer);
    } catch (e) { return 'Could not reach the server: ' + e.message; }
    return null;
}
export async function signIn(username, password, transfer = false) {
    if (!username || !password) return 'Enter your username and password.';
    try {
        const r = await backend.signIn(username, password);
        if (r.error) return r.error;
        await enterUser(r, transfer);
    } catch (e) { return 'Could not reach the server: ' + e.message; }
    return null;
}
export function playAsGuest() {
    if (ACC.status === 'guest') return;
    stats.wins = stats.losses = 0;
    Borgs.hydrateBorgs([], false);
    try {
        const d = JSON.parse(sessionStorage.getItem(GUEST_KEY) || 'null');
        if (d) applyData(d, false);
    } catch (e) { /* fresh guest */ }
    set({ status: 'guest', userId: null, username: displayName() });
    Borgs.reloadRequests();
    afterChange();
}
export async function signOut() {
    if (ACC.status === 'user') { await persistNow(); try { await backend.signOut(); } catch (e) { /* ignore */ } }
    try { sessionStorage.removeItem(GUEST_KEY); } catch (e) { /* ignore */ }
    set({ status: 'signedOut', userId: null, username: '' });
    stats.wins = stats.losses = 0;
    Borgs.hydrateBorgs([], false);
    Borgs.reloadRequests();
    afterChange();
}
export async function lookupUsername(name) { try { return await backend.exists(name); } catch (e) { return false; } }

export function recordResult(win) {
    if (ACC.status !== 'user' && ACC.status !== 'guest') return;
    if (win) stats.wins++; else stats.losses++;
    persist(); afterChange();
}
