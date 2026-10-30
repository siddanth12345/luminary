// Playable characters. All share the same hitboxes and moves; they differ in walk speed, a few special
// tunings, their model and how their melee animations look. Team / FFA colours still drive the glow and
// armour tint, so `look` only adds shape, props and a suit/trim palette.
export const CHAR_IDS = ['luminent', 'bulwark', 'zephyr', 'ember', 'tide', 'volt', 'umbra', 'terra'];
export const DEFAULT_CHAR = 'luminent';

export const CHARS = {
    luminent: {
        id: 'luminent', name: 'Luminent', role: 'All-rounder', walk: 1.0, orb: 1.0, blink: 1.0, scale: 1.0,
        desc: 'The original fighter of light. Balanced speed, a blade of light and a halo on its back. Nothing is its weakness, nothing is its trick.',
        look: { suit: 0x0f172a, trim: 0xcbd5e1, head: 'crest', weapon: 'blade', anim: 'sword', extra: 'halo' },
        art: { skin: '#cbd5e1', feature: 'crest' },
    },
    bulwark: {
        id: 'bulwark', name: 'Bulwark', role: 'Tank', walk: 0.72, orb: 0.85, blink: 0.8, scale: 1.14,
        desc: 'An armoured knight who walks slowly but never hurries. Swings a heavy tower shield. Short Blink, slower Core orb.',
        look: { suit: 0x1e293b, trim: 0x94a3b8, head: 'bucket', weapon: 'slab', anim: 'heavy', extra: 'shieldback' },
        art: { skin: '#94a3b8', feature: 'bucket' },
    },
    zephyr: {
        id: 'zephyr', name: 'Zephyr', role: 'Light, very fast', walk: 1.35, orb: 1.15, blink: 1.15, scale: 0.92,
        desc: 'A wind dancer who fights with spins and kicks, no weapon. The fastest walker. Longer Blink, faster Core orb.',
        look: { suit: 0x134e4a, trim: 0xe2e8f0, head: 'ribbon', weapon: 'fist', anim: 'kick', extra: 'scarf' },
        art: { skin: '#e2e8f0', feature: 'ribbon' },
    },
    ember: {
        id: 'ember', name: 'Ember', role: 'Brawler', walk: 1.0, orb: 1.0, blink: 1.0, scale: 1.0,
        desc: 'A fire monk with bare hands. Palm strikes, flaming kicks, flame hair. Normal speed.',
        look: { suit: 0x3b1d0f, trim: 0xfdba74, head: 'flame', weapon: 'fist', anim: 'palm', extra: 'sash' },
        art: { skin: '#fdba74', feature: 'flame' },
    },
    tide: {
        id: 'tide', name: 'Tide', role: 'Zoner', walk: 0.9, orb: 1.1, blink: 1.0, scale: 1.0,
        desc: 'A water caster with a long staff. Sweeping reach, a slightly faster Core orb, a touch slower on foot.',
        look: { suit: 0x0c4a6e, trim: 0x7dd3fc, head: 'fin', weapon: 'staff', anim: 'staff', extra: 'staffback' },
        art: { skin: '#7dd3fc', feature: 'fin' },
    },
    volt: {
        id: 'volt', name: 'Volt', role: 'Rushdown', walk: 1.2, orb: 1.05, blink: 1.2, scale: 0.97,
        desc: 'A bare-fisted sprinter crackling with static. Fast, rapid punches and double stomps, long Blink.',
        look: { suit: 0x1e1b4b, trim: 0xfde047, head: 'spikes', weapon: 'fist', anim: 'rush', extra: 'bolt' },
        art: { skin: '#fde047', feature: 'spikes' },
    },
    umbra: {
        id: 'umbra', name: 'Umbra', role: 'Trickster', walk: 1.15, orb: 1.0, blink: 1.1, scale: 0.96,
        desc: 'A shadow assassin with twin daggers, a hood and a cape. Quick on its feet, slashes in tight crosses.',
        look: { suit: 0x111827, trim: 0x6b7280, head: 'hood', weapon: 'dagger', anim: 'dagger', extra: 'cape' },
        art: { skin: '#6b7280', feature: 'hood' },
    },
    terra: {
        id: 'terra', name: 'Terra', role: 'Heavy', walk: 0.62, orb: 0.8, blink: 0.75, scale: 1.2,
        desc: 'A rock golem. The slowest walker, with huge fists and a heavy, slow Core orb. Hits like a landslide.',
        look: { suit: 0x292524, trim: 0xa8a29e, head: 'rocks', weapon: 'fist', anim: 'heavy', extra: 'rocks' },
        art: { skin: '#a8a29e', feature: 'rocks' },
    },
};

export const charOf = (id) => CHARS[id] || CHARS[DEFAULT_CHAR];

const KEY = 'luminary.char';
export const getMyChar = () => { try { const v = localStorage.getItem(KEY); return CHARS[v] ? v : DEFAULT_CHAR; } catch (e) { return DEFAULT_CHAR; } };
export const setMyChar = (id) => { if (!CHARS[id]) return; try { localStorage.setItem(KEY, id); } catch (e) { /* storage blocked */ } };

/** half-profile portrait (SVG) in the given accent colour: shoulders, a side-on head and the character's feature */
export function portraitSVG(id, accent = '#22d3ee') {
    const c = charOf(id), a = c.art;
    const F = {
        crest: `<path d="M64 26 L96 8 L98 38 Z" fill="#334155"/><path d="M70 22 L94 14" stroke="${accent}" stroke-width="3"/>`,
        bucket: `<rect x="48" y="22" width="52" height="14" rx="3" fill="#64748b"/><path d="M82 10 Q112 8 104 40 L92 34 Z" fill="${accent}" opacity=".85"/><rect x="82" y="46" width="22" height="26" rx="4" fill="#475569"/>`,
        ribbon: `<path d="M52 36 Q22 34 10 62 Q30 52 50 52" fill="${accent}" opacity=".9"/><path d="M52 44 Q26 52 18 84 Q40 68 52 60" fill="${accent}" opacity=".6"/><rect x="52" y="36" width="44" height="6" rx="3" fill="#0f766e"/>`,
        flame: `<path d="M56 34 Q50 8 66 14 Q64 -2 80 10 Q90 0 92 24 Q100 22 98 38 Z" fill="#fb923c"/><path d="M66 32 Q64 16 76 20 Q78 8 88 24 L88 34 Z" fill="#fde047"/>`,
        fin: `<path d="M50 40 Q30 20 54 6 Q50 22 66 28 Q60 14 78 6 Q76 24 90 34 Z" fill="${accent}"/><path d="M50 44 Q40 52 46 66" stroke="#0369a1" stroke-width="6" fill="none"/>`,
        spikes: `<path d="M54 36 L50 6 L66 26 L72 2 L82 26 L96 8 L96 38 Z" fill="#facc15"/><path d="M60 30 L64 18 M78 26 L82 12" stroke="#fff" stroke-width="2" opacity=".8"/>`,
        hood: `<path d="M44 74 Q36 14 74 10 Q110 14 102 56 L92 44 Q96 28 76 26 Q56 28 60 74 Z" fill="#1f2937"/><path d="M96 44 Q118 52 120 84 L104 74 Z" fill="#374151"/>`,
        rocks: `<path d="M52 34 L58 12 L72 24 L84 6 L94 28 L100 34 Z" fill="#78716c"/><circle cx="62" cy="62" r="6" fill="#57534e"/><circle cx="94" cy="58" r="5" fill="#57534e"/><path d="M46 80 L60 66 L72 82 Z" fill="#57534e"/>`,
    };
    return `<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="pg${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity=".35"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></linearGradient></defs>
        <circle cx="64" cy="64" r="60" fill="url(#pg${id})"/>
        <path d="M6 128 Q10 92 42 84 L86 84 Q118 92 122 128 Z" fill="#1e293b"/>
        <path d="M6 128 Q10 92 42 84 L52 84 Q36 100 38 128 Z" fill="#0f172a"/>
        <path d="M18 112 Q40 98 66 100" stroke="${accent}" stroke-width="3" fill="none" opacity=".9"/>
        <rect x="58" y="70" width="20" height="18" rx="6" fill="#334155"/>
        <path d="M48 40 Q48 24 68 24 Q96 24 98 48 Q100 64 90 72 L66 74 Q50 70 48 56 Z" fill="${a.skin}"/>
        <path d="M80 44 L100 46 Q100 54 92 54 L80 52 Z" fill="${accent}"/>
        <path d="M80 44 L100 46" stroke="#fff" stroke-width="2" opacity=".9"/>
        ${F[a.feature] || ''}
    </svg>`;
}
