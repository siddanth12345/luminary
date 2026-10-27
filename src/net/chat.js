// In-room chat (online 1v1 and custom matches). Messages are max 50 characters; a word filter replaces
// anything nasty with "*splinter*" (checked again on receive, in case a modified client skipped it);
// five mild insults in a row get the same treatment. Same idea as Table Wars' chat.
import { displayName } from '../account.js';

const MAX = 30;
let messages = [];
const subs = new Set();
let mildStrikes = 0;
export const onChat = (f) => { subs.add(f); return () => subs.delete(f); };
export const getChat = () => messages;
const bump = () => subs.forEach(f => f());
export function clearChat() { messages = []; mildStrikes = 0; bump(); }
export function pushChat(m) { if (messages.some(x => x.id === m.id)) return; messages = [...messages, m].slice(-MAX); bump(); }

export const chatEnabled = () => { try { return localStorage.getItem('luminary.chat') !== 'off'; } catch (e) { return true; } };
export const setChatEnabled = (on) => { try { localStorage.setItem('luminary.chat', on ? 'on' : 'off'); } catch (e) { /* ignore */ } bump(); };

const HARD = ['nigger', 'nigga', 'nigg', 'faggot', 'faggots', 'fag', 'fags', 'retard', 'retarded', 'retards', 'kys', 'kill yourself', 'kill urself', 'killyourself',
    'nazi', 'hitler', 'rape', 'rapist', 'raping', 'molest', 'pedo', 'paedo', 'pedophile', 'cunt', 'cunts', 'whore', 'whores', 'slut', 'sluts', 'bitch', 'bitches',
    'motherfucker', 'motherfuck', 'fuck you', 'fuck u', 'fuckoff', 'fuck off', 'shithead', 'asshole', 'dickhead', 'cock', 'pussy', 'bastard'];
const MILD = ['stupid', 'idiot', 'dumb', 'moron', 'loser', 'trash', 'noob', 'suck', 'shut up', 'ugly', 'fatass', 'hate you', 'nobody likes', 'dumbass', 'shutthefuck'];

/** lower-case, strip accents / zero-width characters and undo look-alike swaps (leet speak, ph -> f) */
function base(s) {
    return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[​-‏‪-‮⁠﻿­]/g, '')
        .replace(/[@ø0]/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a')
        .replace(/5/g, 's').replace(/7/g, 't').replace(/\$/g, 's').replace(/ph/g, 'f');
}
const squash = (s) => base(s).replace(/[^a-z]+/g, '').replace(/(.)\1+/g, '$1');            // f.u.c.k / fuuuck -> fuk
const spaced = (s) => base(s).replace(/[^a-z\s]/g, ' ').replace(/(.)\1+/g, '$1').replace(/\s+/g, ' ').trim();
const F_ANY = ['fuck', 'fvck', 'fuhk', 'fuq', 'fucc'];
const F_WORD = /^(fu?c?k|fck|fuk|fuq|fvk|fvck)(er|ers|ed|ing|in|s|a|ah|y)?$/;
function hasF(text) {
    const c = squash(text);
    if (F_ANY.some(w => c.includes(squash(w)))) return true;
    return base(text).split(/[\s,;:!?'"()[\]{}/\\]+/).some(tok => { const t = tok.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1'); return t.length > 1 && F_WORD.test(t); });
}
function isHard(text) {
    if (hasF(text)) return true;
    const c = squash(text), sp = spaced(text);
    return HARD.some(w => { const cw = squash(w); return (cw && c.includes(cw)) || sp.includes(spaced(w)); });
}
export function filterChat(raw) {
    const text = raw.slice(0, 50);
    if (isHard(text)) return '*splinter*';
    const c = squash(text), sp = spaced(text);
    if (MILD.some(w => { const cw = squash(w); return (cw && c.includes(cw)) || sp.includes(w); })) { if (++mildStrikes >= 5) return '*splinter*'; }
    return text;
}

let transport = null;
/** online.js hands us the room's transport so chat shares its connection */
export function bindChat(sendFn) { transport = sendFn; }
export function sendChat(raw) {
    const t = (raw || '').trim();
    if (!t || !transport) return;
    const m = { id: Math.random().toString(36).slice(2, 10), name: displayName(), text: filterChat(t), t: Date.now() };
    pushChat(m);
    transport({ t: 'chat', id: m.id, name: m.name, text: m.text });
}
export function onRemoteChat(p) {
    if (!p || typeof p !== 'object') return;
    const text = String(p.text || '').slice(0, 50);
    pushChat({ id: String(p.id || Math.random().toString(36).slice(2, 10)), name: String(p.name || 'player').slice(0, 20), text: isHard(text) ? '*splinter*' : text, t: Date.now() });
}
