// F specials per character. Slots:  N = neutral (hold F, charges), S = side, U = up, DG = down on the ground, DA = down in the air.
// On mobile these are the red-button hold (N) and the drag onto the side / up / down arrows.
// Every slot has a kind, tuning numbers and a short description. The engine in core.js reads these.
//
//   N  kinds: 'orb'   projectile (ranges are [uncharged, fully charged])
//             'burst' no projectile: a blast around you        'breath' a flame stream in front of you
//   S  kinds: 'tp' teleport + slash   'dash' travelling slash (armor optional)   'wave' a low projectile
//   U  kind : 'rise' recovery that rises (multi-hit or one big hit)
//   DG kinds: 'suplex' (the original grab)   'pound' windup + area hit (at your feet, in front, or at the foe)
//   DA kind : 'dive'  dive with an impact
//
// Damage plan: speedsters (Zephyr, Volt, Umbra) every special lands 8 to 17. Tanks reach 30 (Terra), Bulwark 28.
export const SP = {
    luminent: {
        N: { kind: 'orb', name: 'CBG Core', desc: 'Hold to charge a straight orb. Full charge is purple, bigger and stronger.', cd: 90,
             speed: [15.75, 14.8], r: [12, 39.7], dmg: [4, 20], R: [80, 170], bkb: [5, 9], kbg: 0.55, life: 260 },
        S: { kind: 'tp', name: 'Blink Slash', desc: 'Teleport 220 and slash.', cd: 60, dist: 220, swing: 'BLINK' },
        U: { kind: 'rise', name: 'Rising Spiral', desc: 'Multi-hit rise for recovery.', cd: 120, frames: 36, vy: 10.5, every: 6, hitDmg: 3, lastDmg: 6, lastBkb: 12, lastKbg: 1.1, w: 132, h: 118 },
        DG: { kind: 'suplex', name: 'Suplex', desc: 'Homing grab dash, backflip and slam for 14.', cd: 0 },
        DA: { kind: 'dive', name: 'Headbutt', desc: 'Dive with small hits, then a floor slam for 15 and a stun wave.', cd: 90, vy: 24, hitDmg: 2, every: 6, impactDmg: 15, impactW: 0.125, stun: true },
    },
    bulwark: {
        N: { kind: 'orb', name: 'Bastion Core', desc: 'A slow, huge orb that flies far. Big charge, up to 26 damage and heavy knockback.', cd: 150,
             speed: [8, 7], r: [28, 56], dmg: [12, 26], R: [110, 200], bkb: [8, 14], kbg: 0.7, life: 440 },
        S: { kind: 'dash', name: 'Shield Rush', desc: 'An armoured charge that shoves foes along in front of you without hurting much; the final shoulder-check at the end knocks them away (6 + 16).', cd: 110, dist: 300, frames: 17, armor: true, flow: true, dmg: 6, bkb: 0, kbg: 0, w: 96, h: 90, ang: 0.35, lock: 30, end: { fwd: 70, w: 130, h: 110, dmg: 16, bkb: 14, kbg: 1.0, ang: -0.35 } },
        U: { kind: 'rocket', name: 'Rocket Hoist', desc: 'An armoured battering ram: launches straight where you aim (almost no steering), you do not flinch and you plough through foes for 20.', cd: 150, frames: 28, speed: 8.5, turn: 0.012, armor: true, dmg: 20, bkb: 13, kbg: 1.2, w: 150, h: 130 },
        DG: { kind: 'pound', name: 'Seismic Stomp', desc: 'Wind up, then a ground-pound shockwave (28). Slow but huge.', cd: 150, windup: 20, w: 0.22, h: 70, dmg: 28, bkb: 12, kbg: 1.1, ang: -1.25, stun: 0, lock: 50, hits: 1 },
        DA: { kind: 'dive', name: 'Anvil Drop', desc: 'A fast, heavy plunge. No small hits, one 24-damage impact.', cd: 140, vy: 30, hitDmg: 0, every: 99, impactDmg: 24, impactW: 0.16, stun: false, bkb: 12, kbg: 1.1, ang: -1.3, lock: 30 },
    },
    zephyr: {
        N: { kind: 'burst', name: 'Gale Burst', desc: 'No projectile: a close-range blast of wind that shoves everyone around you away. 8 to 14.', cd: 70,
             frames: 12, every: 12, R: [110, 170], dmg: [8, 14], bkb: [9, 12], kbg: 0.9, radial: true },
        S: { kind: 'dash', name: 'Gust Dash', desc: 'A very fast long dash. It slices through foes (5), spins at the end with a gust that flings them away (6) and you bounce back out.', cd: 50, dist: 380, frames: 8, armor: false, dmg: 5, bkb: 5, kbg: 0.5, w: 84, h: 80, ang: 0.15, multi: true, lock: 14, rebound: 7, end: { w: 230, h: 170, radial: true, dmg: 6, bkb: 9, kbg: 0.9 } },
        U: { kind: 'lift', name: 'Updraft', desc: 'No attack at all: a very high, very fast rise on a gust that only shoves nearby foes away.', cd: 100, frames: 40, vy: 13.5, gust: 170 },
        DG: { kind: 'pound', name: 'Cyclone Kick', desc: 'Spin on the spot: two quick pulses (9 each) that fling nearby foes away from you.', cd: 70, windup: 0, w: 0.09, h: 90, dmg: 9, bkb: 6, kbg: 0.7, ang: -1.2, stun: 0, lock: 22, hits: 2, every: 8, radial: true, centred: true },
        DA: { kind: 'dive', name: 'Dive Kick', desc: 'A quick diagonal kick dive (13) that bounces you up.', cd: 80, vy: 22, vx: 8, hitDmg: 0, every: 99, impactDmg: 13, impactW: 0.08, stun: false, bkb: 9, kbg: 1.0, ang: -1.0, lock: 10 },
    },
    ember: {
        N: { kind: 'breath', name: 'Flamethrower', desc: 'Omnidirectional fire stream aimed where you look (mouse / aim matrix). Hold longer for a longer flame. Pushes, then a final burst.', cd: 100,
             frames: 26, every: 5, w: [200, 330], h: 90, dmg: 3, lastDmg: 8, bkb: 9, kbg: 0.8 },
        S: { kind: 'dash', name: 'Flame Lunge', desc: 'A short fiery lunge that carries foes along, ending in a pillar of fire that throws them upward (5 + 9).', cd: 70, dist: 250, frames: 11, armor: false, flow: true, dmg: 5, bkb: 0, kbg: 0, w: 90, h: 90, ang: 0.95, lock: 22, end: { fwd: 60, pillar: true, w: 120, h: 230, dmg: 9, bkb: 12, kbg: 1.1, ang: -1.35 } },
        U: { kind: 'rocket', name: 'Phoenix Dash', desc: 'Turn into a fire rocket and fly where you aim, steering very sharply for 2.5 s. Foes you drill through are carried along and burnt (1.5 each hit, no knockback). When the rocket runs out it explodes: that blast knocks everyone back (12).', cd: 140, frames: 150, speed: 12, turn: 0.16, drill: true, maxHits: 8, dmg: 1.5, bkb: 0, kbg: 0, w: 130, h: 130, boom: { R: 170, dmg: 12, bkb: 12, kbg: 1.2 } },
        DG: { kind: 'pound', name: 'Fire Pillar', desc: 'A pillar of flame erupts in front of you and launches foes (16).', cd: 90, windup: 10, w: 0.07, h: 260, off: 130, dmg: 16, bkb: 12, kbg: 1.2, ang: -1.35, stun: 0, lock: 26, hits: 1 },
        DA: { kind: 'dive', name: 'Meteor Fist', desc: 'A straight-down fiery punch with a floor slam (18).', cd: 110, vy: 26, hitDmg: 2, every: 6, impactDmg: 18, impactW: 0.12, stun: false, bkb: 11, kbg: 1.1, ang: -1.2, lock: 20 },
    },
    tide: {
        N: { kind: 'orb', look: 'water', name: 'Water Orb', desc: 'A big wobbling water orb that drifts far (long range). Bursts and drags foes toward it.', cd: 100,
             speed: [7, 6.5], r: [22, 40], dmg: [7, 15], R: [90, 150], bkb: [3, 5], kbg: 0.45, life: 460, wobble: 5, pull: 5 },
        S: { kind: 'bubble', name: 'Bubble Trap', desc: 'Fire a slow bubble. The first foe it touches is trapped inside until it pops: after 3 seconds, on the floor, or when someone hits it. The pop deals 9.', cd: 150, speed: 5.5, r: 46, life: 160, popDmg: 9, R: 95, bkb: 7, kbg: 0.7 },
        U: { kind: 'erupt', name: 'Geyser', desc: 'A water pillar erupts right under your nearest foe (on the ground or in mid-air). It lifts them high and stuns them (grey), and the jet throws you upward too (11).', cd: 130, windup: 12, near: 650, ride: 12, h: 420, w: 0.06, dmg: 11, stun: 40, lift: 11 },
        DG: { kind: 'pound', name: 'Whirlpool', desc: 'A big pull: drags everyone nearby toward you (8).', cd: 90, windup: 8, w: 0.3, h: 120, dmg: 8, bkb: 3, kbg: 0.3, ang: -1.0, stun: 0, lock: 30, hits: 1, pull: 6, centred: true },
        DA: { kind: 'dive', name: 'Splash Dive', desc: 'A plunge ending in a wide splash that shoves foes aside (12).', cd: 90, vy: 22, hitDmg: 0, every: 99, impactDmg: 12, impactW: 0.2, stun: false, bkb: 8, kbg: 0.9, ang: -0.7, lock: 20 },
    },
    volt: {
        N: { kind: 'burst', name: 'Overload', desc: 'No projectile: a close electric blast that stuns for a moment. 8 to 12.', cd: 90,
             frames: 10, every: 10, R: [90, 130], dmg: [8, 12], bkb: [2, 2], kbg: 0.2, stun: 24 },
        S: { kind: 'tp', name: 'Thunder Dash', desc: 'Teleport a very long way and zap on arrival: the foe is stunned (grey) for a moment instead of flung (10).', cd: 70, dist: 340, swing: 'SP_volt_S', dmg: 10, bkb: 0, kbg: 0, stun: 26, w: 120, h: 80 },
        U: { kind: 'bolt', name: 'Lightning Rod', desc: 'Vanish and strike upward instantly (toward your aim, always upward-ish): the bolt zaps and stuns everything along its path (9). No knockback.', cd: 110, dist: 320, w: 100, dmg: 9, stun: 30 },
        DG: { kind: 'pound', name: 'Shock Slam', desc: 'A quick stomp that stuns everyone nearby (9).', cd: 80, windup: 6, w: 0.12, h: 70, dmg: 9, bkb: 2, kbg: 0.2, ang: -1.2, stun: 30, lock: 24, hits: 1, centred: true },
        DA: { kind: 'dive', name: 'Bolt Dive', desc: 'The fastest dive: a stunning impact (12).', cd: 90, vy: 32, hitDmg: 1, every: 5, impactDmg: 12, impactW: 0.1, stun: true, stunFrames: 28 },
    },
    umbra: {
        N: { kind: 'orb', look: 'void', name: 'Void Orb', desc: 'A slow orb that bends a little toward your foe. 8 to 12.', cd: 160,
             speed: [8.5, 7.5], r: [14, 22], dmg: [8, 12], R: [75, 105], bkb: [4, 6], kbg: 0.5, life: 300, curve: 0.02 },
        S: { kind: 'tp', name: 'Shadow Step', desc: 'Teleports behind a foe close to you and stabs (10). Slow to recover.', cd: 130, lock: 50, dist: 190, behind: true, near: 380, swing: 'SP_umbra_S', dmg: 10, bkb: 9, kbg: 0.9, w: 90, h: 70 },
        U: { kind: 'lift', name: 'Smoke Vanish', desc: 'No attack: you vanish in smoke, untouchable for a moment, and reappear high above.', cd: 150, frames: 20, vy: 13, inv: 18 },
        DG: { kind: 'pound', name: 'Void Pit', desc: 'Marks the foe\'s spot (or in front of you): after a clear delay a pillar of shadow erupts (12).', cd: 150, windup: 32, w: 0.07, h: 200, dmg: 12, bkb: 9, kbg: 0.9, ang: -1.35, stun: 0, lock: 24, hits: 1, atTarget: true },
        DA: { kind: 'dive', name: 'Dagger Plunge', desc: 'A steep stab-dive with a sharp impact (10).', cd: 120, vy: 27, hitDmg: 0, every: 99, impactDmg: 10, impactW: 0.07, stun: false, bkb: 8, kbg: 0.9, ang: -1.1, lock: 18 },
    },
    terra: {
        N: { kind: 'orb', look: 'boulder', name: 'Boulder', desc: 'A heavy boulder thrown in an arc: up to 30 damage. Slow and loud.', cd: 170,
             speed: [10, 9], r: [34, 62], dmg: [14, 30], R: [120, 220], bkb: [10, 16], kbg: 0.8, life: 220, grav: 0.3 },
        S: { kind: 'dash', name: 'Boulder Roll', desc: 'A long, armoured roll for 26 damage. Long recovery.', cd: 160, dist: 420, frames: 17, armor: true, dmg: 26, bkb: 15, kbg: 1.1, w: 110, h: 100, ang: 0.4, lock: 70 },
        U: { kind: 'rise', name: 'Rubble Launch', desc: 'A rubble blast under your feet throws foes away (18), then an armoured slow lift with a crushing hit at the top (12).', cd: 170, frames: 36, vy: 6.5, armor: true, every: 99, hitDmg: 0, lastDmg: 12, lastBkb: 14, lastKbg: 1.2, w: 170, h: 150, start: { R: 150, dmg: 18, bkb: 11, kbg: 1.1 } },
        DG: { kind: 'pound', name: 'Quake', desc: 'A huge, slow ground pound: 30 damage in a big radius, armoured while winding up.', cd: 180, windup: 30, armor: true, w: 0.34, h: 80, dmg: 30, bkb: 14, kbg: 1.2, ang: -1.3, stun: 0, lock: 70, hits: 1, centred: true },
        DA: { kind: 'dive', name: 'Landslide', desc: 'A very heavy drop: one 28-damage impact in a wide area.', cd: 170, vy: 28, hitDmg: 0, every: 99, impactDmg: 28, impactW: 0.26, stun: false, bkb: 14, kbg: 1.1, ang: -1.3, lock: 40 },
    },
};

export const STYLE_OF = { luminent: 'core', bulwark: 'iron', zephyr: 'wind', ember: 'fire', tide: 'water', volt: 'volt', umbra: 'dark', terra: 'rock' };
export const spec = (id, slot) => (SP[id] || SP.luminent)[slot];
export const SLOT_OF = { CORE: 'N', BLINK: 'S', SPIRAL: 'U', SUPLEX: 'DG', HEADBUTT: 'DA' };
export const lerpR = (r, c) => r[0] + (r[1] - r[0]) * c;
