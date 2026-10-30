// Layout settings: which control scheme to use (auto / PC / mobile) and where the mobile on-screen
// buttons sit. Positions are fractions of the screen (centre of each control) so they survive any
// screen size; button sizes are in pixels. The aim grid is resized from its red centre in the editor (it scales around its middle).
const KEY = 'luminary.layout.v1';
export const DEFAULT_LAYOUT = {
    mode: 'auto',                                   // 'auto' | 'pc' | 'mobile'
    mobile: {
        matrix: { x: 0.86, y: 0.50 },          // s (px) is optional: unset = automatic size
        jump:   { x: 0.64, y: 0.80, s: 86 },
        grab:   { x: 0.775, y: 0.86, s: 80 },
        shield: { x: 0.91, y: 0.84, s: 86 },
    },
};
const clone = (o) => JSON.parse(JSON.stringify(o));
let layout = clone(DEFAULT_LAYOUT);
const subs = new Set();

function sanitize(raw) {
    const out = clone(DEFAULT_LAYOUT);
    if (!raw || typeof raw !== 'object') return out;
    if (['auto', 'pc', 'mobile'].includes(raw.mode)) out.mode = raw.mode;
    const m = raw.mobile || {};
    for (const k of Object.keys(out.mobile)) {
        const v = m[k]; if (!v) continue;
        if (Number.isFinite(v.x)) out.mobile[k].x = Math.min(0.98, Math.max(0.02, v.x));
        if (Number.isFinite(v.y)) out.mobile[k].y = Math.min(0.98, Math.max(0.02, v.y));
        if (Number.isFinite(v.s)) out.mobile[k].s = k === 'matrix' ? Math.min(320, Math.max(130, v.s)) : Math.min(150, Math.max(44, v.s));
    }
    return out;
}
try { layout = sanitize(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { /* no storage: defaults */ }

export const getLayout = () => layout;
export const copyLayout = () => clone(layout);
export function saveLayout(next) {
    layout = sanitize(next);
    try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch (e) { /* ignore */ }
    for (const f of subs) f();
}
export function setMode(mode) { saveLayout({ ...layout, mode }); }
export const onLayout = (f) => { subs.add(f); return () => subs.delete(f); };

const coarse = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };
/** true when the on-screen touch controls should be used */
export const touchMode = () => layout.mode === 'mobile' || (layout.mode === 'auto' && coarse());
