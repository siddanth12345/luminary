// ============================================================================
//  COOL BATTLE GAME - game core
//  All gameplay runs in the original 2D world space: x -> right, y -> down,
//  3800 x 2100. The 3D renderer only *reads* this state; the `fx(...)` hooks and
//  presentation fields (attackKind, specialKind, ...) never feed back in.
// ============================================================================
import { charOf, getMyChar, DEFAULT_CHAR } from './characters.js';
import { SoundEngine } from './audio.js';
import { isDown } from './controls.js';
import { ITEM_TYPES } from './items.js';
import { SP, spec, SLOT_OF, lerpR } from './specials.js';

export const S = { screenShake: 0, gameMode: 'hard', gameState: 'start', online: null };   // online: null | 'host' | 'guest'
export const audio = new SoundEngine();
/** everything the host has produced since the last network snapshot (effects, sounds, particles) */
export const outbox = [];
export const NETHOOK = { send: null };
// online host: forward every sound the simulation plays so the guest hears it too
for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(audio))) {
    if (!/^play/.test(name) || typeof audio[name] !== 'function') continue;
    const orig = audio[name].bind(audio);
    audio[name] = (...args) => { if (S.online === 'host') outbox.push({ k: 'a', m: name, a: args }); return orig(...args); };
}
export const koBeams = [];
export const shockwaves = [];
export const fxEvents = [];
export const orbs = [];                    // CBG Core projectiles
let orbSerial = 0;
function fx(type, x, y, a = 0, b = 0) { fxEvents.push({ type, x, y, a, b }); if (S.online === 'host') outbox.push({ k: 'f', e: [type, x, y, a, b] }); }

const WORLD = {
    width: 3800,
    height: 2100,
    gravity: 0.5,
    terminalVelocity: 16,
    friction: 0.86,
    airFriction: 0.985
};

const STAGE = {
    x: 1140,
    y: 1250,
    width: 1520,
    height: 90,
    color: '#1e293b',
    topColor: '#38bdf8'
};

const BLAST_ZONES = {
    left: -380,
    right: 4180,
    top: -283,
    bottom: 2423
};
STAGE.platforms = [];                       // soft (one-way) platforms: { x, y, w } with x = left edge, y = top surface

/** the normal 1v1 / bot arena, and the custom-match arena: stage + kill zone 2.5x bigger, with Battlefield-style platforms */
const ARENAS = {
    normal: {
        world: { width: 3800, height: 2100 },
        stage: { x: 1140, y: 1250, width: 1520, height: 90 },
        bz: { left: -380, right: 4180, top: -283, bottom: 2423 },       // kill zone 10% taller than before
        platforms: () => [],
    },
    lobby: {
        // 0.7x the old big arena horizontally (stage, kill zone and platforms); same height
        world: { width: 6650, height: 5250 },
        stage: { x: 1995, y: 3125, width: 2660, height: 225 },
        bz: { left: -665, right: 7315, top: -400, bottom: 5750 },
        // Big Battlefield: two side platforms and one high platform in the middle
        platforms: (st) => {
            const w = Math.round(st.width * 0.22), cx = st.x + st.width / 2;
            return [
                { x: Math.round(cx - st.width * 0.25 - w / 2), y: st.y - 200, w },
                { x: Math.round(cx + st.width * 0.25 - w / 2), y: st.y - 200, w },
                { x: Math.round(cx - w / 2), y: st.y - 390, w },
            ];
        },
    },
};
export function setArena(kind) {
    const a = ARENAS[kind] || ARENAS.normal;
    Object.assign(WORLD, a.world);
    Object.assign(STAGE, a.stage);
    STAGE.platforms = a.platforms(STAGE);
    Object.assign(BLAST_ZONES, a.bz);
    S.arena = kind === 'lobby' ? 'lobby' : 'normal';
    S.arenaVersion = (S.arenaVersion || 0) + 1;
}


// ----------------------------------------------------------------- tuning (frames @ 60 Hz)
export const ATTACK_FRAMES = 18;
const LOCK = 36;              // 0.6 s: after ANY move you can't start another one (you can still walk)
const JUMP_OK = 24;           // ...but you may jump once 0.2 s of that lock has passed (36 - 12)
const MELEE_CHARGE_MAX = 102; // 1.7 s to fully charge a held side / up / down melee
const MELEE_CHARGE_BONUS = 0.3;   // fully charged = +30% damage and knockback
const GRAB_KB_SCALE = 0.7;    // a grab throw is worth 0.7x a melee hit (percent based)
const STUN = 30;              // 0.5 s stun
const FREEZE = 18;            // 0.3 s "getting up" after a headbutt
const SUPLEX_DETECT = 0.45;    // suplex homing radius, as a fraction of the stage length
const SUPLEX_SPEED = 20;
const SUPLEX_RISE = 20;       // frames spent rising with the opponent before the slam
const TOP_LIMIT = 80;         // reaching the top of the map cancels a suplex
export const ROLL_FRAMES = 20;       // 3x faster than the old 60-frame roll (same distance)
const ROLL_DISTANCE = 368;
const ROLL_COOLDOWN = 120;    // 2 s
const HANG_MAX = 180;         // 3 s on a ledge -> kicked off...
const TIMEOUT_BAN = 240;      // ...and can't re-grab a ledge for 4 s
const KICK_BAN = 180;         // kicked by someone taking your ledge -> 3 s no ledge
export const AIR_F_MAX = 2;   // F moves usable in the air before you must touch the ground
const CD = { CORE: 90, BLINK: 60, SPIRAL: 120, SUPLEX: 0, HEADBUTT: 90 };   // no aftermath cooldown on the suplex
const F_MOVES = new Set(['BLINK', 'SPIRAL', 'HEADBUTT']);   // (the ground-down Suplex is a grab, so it counts as GRAB)
const SPIRAL_JUMP_COST = 0;   // Rising Spiral takes no jumps at all
const HOLD_TO_CORE = 30;      // F held < 0.5 s -> directional variant, >= 0.5 s -> CBG Core charge
const CHARGE_MAX = 63;        // full charge after 63 frames (0.7x the old 1.5 s)

let dramaticZoom = {
    active: false,
    targetX: 0,
    targetY: 0,
    currentZoom: 1,
    targetZoom: 3.5,
    progress: 0
};

/** a press that arrived while the fighter was still locked is kept for a few frames so it fires the instant it can (responsiveness) */
export const inputBuf = { a: null, t: 0, wx: 0, wy: 0, dir: 'NEUTRAL', hold: false };
export function bufferInput(a, extra = {}) { Object.assign(inputBuf, { a, t: 9, wx: 0, wy: 0, dir: 'NEUTRAL', hold: false }, extra); }
function flushBuffered() {
    const b = inputBuf;
    if (!b.a) return;
    if (--b.t < 0 || S.online === 'guest') { b.a = null; return; }
    let ok = false;
    if (b.a === 'attack') ok = p1.attack(b.dir, b.hold);
    else if (b.a === 'grab') ok = p1.executeGrabDash(b.wx, b.wy);
    else if (b.a === 'jump') ok = p1.jump();
    if (ok) b.a = null;
}

const keys = {};
const mouse = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    worldX: WORLD.width / 2,
    worldY: WORLD.height / 2,
    originX: null,      // screen position the aim matrix is measured from (the player); set by the camera
    originY: null,
    dx: 0,
    dy: 0,
    dist: 0,
    direction: 'NEUTRAL'
};

function updateAimMatrix() {
    if (mouse.touchMode) return;                       // on-screen controls set the aim directly
    const centerX = mouse.originX ?? window.innerWidth / 2;
    const centerY = mouse.originY ?? window.innerHeight / 2;

    mouse.dx = mouse.x - centerX;
    mouse.dy = mouse.y - centerY;
    mouse.dist = Math.sqrt(mouse.dx * mouse.dx + mouse.dy * mouse.dy);

    const DEADZONE = 45;

    const forcedNeutral = isDown('neutral');          // hold the neutral key: the matrix reads NEUTRAL
    if (forcedNeutral || mouse.dist <= DEADZONE) {
        mouse.direction = 'NEUTRAL';
    } else {
        const absDx = Math.abs(mouse.dx);
        const absDy = Math.abs(mouse.dy);

        if (absDx > absDy) {
            mouse.direction = mouse.dx < 0 ? 'SIDE_LEFT' : 'SIDE_RIGHT';
        } else {
            mouse.direction = mouse.dy < 0 ? 'UP' : 'DOWN';
        }
    }

    const arrowElem = document.getElementById('aimMatrixArrow');
    const labelElem = document.getElementById('aimMatrixLabel');
    const vectorElem = document.getElementById('aimVectorText');

    vectorElem.textContent = `dx: ${Math.round(mouse.dx)} | dy: ${Math.round(mouse.dy)}`;

    switch (mouse.direction) {
        case 'UP':
            arrowElem.textContent = '⬆';
            labelElem.textContent = 'UP  •  J: Up Slash  •  F: Rising Spiral';
            break;
        case 'DOWN':
            arrowElem.textContent = '⬇';
            labelElem.textContent = 'DOWN  •  J: Down Strike  •  F: Suplex / Headbutt';
            break;
        case 'SIDE_LEFT':
            arrowElem.textContent = '⬅';
            labelElem.textContent = 'SIDE (LEFT)  •  J: Side Slash  •  F: Blink Slash';
            break;
        case 'SIDE_RIGHT':
            arrowElem.textContent = '➡';
            labelElem.textContent = 'SIDE (RIGHT)  •  J: Side Slash  •  F: Blink Slash';
            break;
        default:
            arrowElem.textContent = '⏺';
            labelElem.textContent = (forcedNeutral ? 'NEUTRAL (held)' : 'NEUTRAL') + '  •  J: Jab  •  hold F: CBG Core';
            break;
    }
}

// ----------------------------------------------------------------- swing profiles
// J attacks (and the Blink slash) are *swings*: the hitbox is rebuilt every frame from the
// fighter's current position and sweeps along the animation, only inside its active window.
const rad = (d) => d * Math.PI / 180;
const arc = (r, a0, a1) => (k, f) => {
    const a = rad(a0 + (a1 - a0) * k);
    return { x: f * Math.cos(a) * r, y: -Math.sin(a) * r };
};
const SWING = {
    // neutral melee: a sword spin around the body (both sides, air and ground) that only launches UP
    JAB:  { type: 'J', a: 5, b: 15, w: 150, h: 74, damage: 7, bkb: 13, kbg: 1.05, multi: true, path: () => ({ x: 0, y: -4 }),
            angle: () => -Math.PI / 2 },
    UP:   { type: 'J', a: 4, b: 11, w: 75, h: 55, damage: 8,  bkb: 12, kbg: 1.25, chargeable: true, path: arc(56, 10, 150),
            angle: () => -Math.PI / 2 },
    DOWN: { type: 'J', a: 4, b: 11, w: 75, h: 55, damage: 9,  bkb: 13, kbg: 1.25, chargeable: true, path: arc(54, 25, -110),
            angle: (f, grounded) => grounded ? -Math.PI / 3 : Math.PI / 2 },
    SIDE_LEFT:  { type: 'J', a: 5, b: 12, w: 70, h: 62, damage: 10, bkb: 12, kbg: 1.25, chargeable: true, path: arc(64, 70, -20),
            angle: () => Math.PI + Math.PI / 6 },
    SIDE_RIGHT: { type: 'J', a: 5, b: 12, w: 70, h: 62, damage: 10, bkb: 12, kbg: 1.25, chargeable: true, path: arc(64, 70, -20),
            angle: () => -Math.PI / 6 },
    BLINK: { type: 'BLINK', a: 1, b: 9, w: 110, h: 72, damage: 11, bkb: 11, kbg: 1.2, path: (k, f) => ({ x: f * (30 + 70 * k), y: 0 }),
            angle: (f) => f === 1 ? -Math.PI / 5 : Math.PI + Math.PI / 5 },
};

// character-specific side specials (Thunder Dash, Shadow Step, and every travelling dash) are swings with their own hit data
for (const id in SP) {
    const sp = SP[id].S;
    if (!sp || (sp.kind !== 'tp' && sp.kind !== 'dash') || sp.swing === 'BLINK') continue;
    const ang = sp.ang !== undefined ? sp.ang : Math.PI / 5;
    SWING['SP_' + id + '_S'] = {
        type: 'BLINK', a: 1, b: sp.kind === 'dash' ? sp.frames : 9, w: sp.w || 110, h: sp.h || 72, damage: sp.dmg, bkb: sp.bkb, kbg: sp.kbg, multi: !!sp.multi,
        path: sp.kind === 'dash' ? (k, f) => ({ x: f * (sp.w * 0.3), y: 0 }) : (k, f) => ({ x: f * (30 + 70 * k), y: 0 }),
        angle: (f) => f === 1 ? -ang : Math.PI + ang,
    };
}

// ----------------------------------------------------------------- counter matrix
//  Move types: J, GRAB (also the Suplex dash), CORE, BLINK, SPIRAL, HEADBUTT  (+ the SHIELD state)
//   * SHIELD   counters everything except GRAB
//   * GRAB     is countered by every other active move (except HEADBUTT, which grab beats) - and beats SHIELD
//   * HEADBUTT counters everything except GRAB and SHIELD
//   * J        counters everything except SHIELD
//   * CORE     counters every F move and GRAB (not J)
function counters(defType, atkType) {
    if (!defType) return false;
    if (atkType === 'GRAB') return defType !== 'SHIELD' && defType !== 'HEADBUTT' && defType !== 'GRAB';
    switch (defType) {
        case 'SHIELD': case 'J': case 'HEADBUTT': return true;
        case 'CORE': return F_MOVES.has(atkType);
        default: return false;
    }
}
/** 'hit' | 'shield' | 'countered' | 'clash' */
function interaction(atkType, defender) {
    const dType = defender.isShielding ? 'SHIELD' : (defender.activeMove ? defender.activeMove.type : null);
    if (!counters(dType, atkType)) return 'hit';
    if (dType === 'SHIELD') return 'shield';
    return counters(atkType, dType) ? 'clash' : 'countered';
}

class Fighter {
    constructor(x, y, color, name, isAI = false) {
        this.char = DEFAULT_CHAR;                // which character this fighter is (model, walk speed, special tunings)
        this.startX = x;
        this.startY = y;
        this.home = { x, y, color, name };       // restored when leaving a custom match
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.width = 44;
        this.height = 68;
        this.color = color;
        this.name = name;
        this.isAI = isAI;

        this.damage = 0;
        this.stocks = 3;
        this.active = true;                  // takes part in the match (custom matches use up to 8)
        this.out = false;                    // out of stocks
        this.team = null;                    // 'red' | 'blue' | 'yellow' | 'green' in team matches
        this.slot = 0;
        this.superColor = null;
        this.dropT = 0;                      // frames during which soft platforms are ignored (dropping through)

        this.maxJumps = 3;
        this.jumpsLeft = 3;
        this.grounded = false;

        this.isHanging = false;
        this.hangSide = 0;

        this.canGrab = true;
        this.heldItem = null;                // item in hand (host only; guests read `heldId`)
        this.heldId = 0;
        this.balloon = false;                // balloon item: 7 jumps until knocked out
        this.gravT = 0;                      // frames of reduced gravity (0.65x) after being hit by someone holding a balloon
        this.stuckTo = 0;                    // id of a thrown firestick (spear) this fighter is pinned to
        this.kills = 0;                      // timer matches: score
        this.deaths = 0;
        this.lastHitBy = null;               // for kill credit
        this.lastHitT = 9999;
        this._acc = 0; this._since = 0; this._slowK = 1; this._upd = true;   // clock time bubble

        this.isShielding = false;
        this.shieldHealth = 100;
        this.maxShieldHealth = 100;
        this.dizzyTimer = 0;
        this.clashStunTimer = 0;

        this.isRolling = false;
        this.rollTimer = 0;
        this.rollVx = 0;

        this.isGrabDashing = false;
        this.grabDashTimer = 0;
        this.grabHolding = null;
        this.grabbedBy = null;
        this.grabTimer = 0;

        this.hitstun = 0;
        this.invincibleTimer = 0;
        this.facing = 1;

        this.attackTimer = 0;
        this.activeHitbox = null;
        this.ghosts = [];
        this.incomingHitCount = 0;

        // --- 3D presentation only (never read by game logic) ---
        this.attackKind = null;      // 'JAB' | 'UP' | 'DOWN' | 'SIDE_LEFT' | 'SIDE_RIGHT'
        this.attackSerial = 0;
        this.throwFxT = 0;
        this.px = x; this.py = y;
        this._teleported = true;

        this.initCombat();
    }

    /** every field of the action / special-move system (reset on spawn) */
    initCombat() {
        this.actionLock = 0;                 // frames until another move may start
        this.airSpecials = 0;                // F moves used since last touching the ground
        this.cd = { CORE: 0, BLINK: 0, SPIRAL: 0, SUPLEX: 0, HEADBUTT: 0 };
        this.activeMove = null;              // { type, t }: what the fighter is "doing" for counter purposes
        this.fActive = false;                // F is being held
        this.fNeutral = false;               // F was pressed with the aim in the deadzone
        this.fDirPress = 'NEUTRAL';
        this.chargeFrames = 0;
        this.aiChargeGoal = 0;
        this.swing = null;                   // current J / Blink swing profile
        this.swingHit = false;
        this.swingHitSet = null;             // spin attack: who it already hit
        this.attackHeld = false;             // melee button still held: charging a side / up / down swing
        this.meleeCharge = 0;                // frames charged (0..MELEE_CHARGE_MAX)
        this.suplexAng = 0;                  // backflip angle during a suplex (radians)
        this.landFlipT = 0;                  // landing recovery of the suplex backflip
        this.spiralT = 0;
        this.sx = null;                      // running character special: { k: 'burst'|'breath'|'pound'|'dash', t, ... }
        this.armorT = 0;                     // frames of armour (damage, but no flinch / knockback)
        this.suplexT = 0;                    // > 0 while carrying an opponent in a suplex
        this.suplexN = 0;
        this.suplexPhase = 'rise';
        this.suplexPending = false;          // the grab dash in flight is a suplex
        this.suplexTarget = null;
        this.grabVictim = null;
        this.diving = false;
        this.diveT = 0;
        this.diveHit = false;
        this.freezeTimer = 0;                // "getting up" frames after a headbutt
        this.rollCooldown = 0;
        this.rollTotal = ROLL_FRAMES;
        this.hangTimer = 0;
        this.ledgeBan = 0;
        this.specialKind = null;             // presentation: 'CORE' | 'SPIRAL' | 'SUPLEX' | 'HEADBUTT'
        this.specialT = 0;
        this.specialDur = 0;
    }

    get charging() { return this.fActive && (this.fNeutral || this.chargeFrames >= HOLD_TO_CORE); }

    reset(fullReset = false) {
        this.x = this.startX;
        this.y = STAGE.y - 300;
        this.vx = 0;
        this.vy = 0;
        this.damage = S.match ? S.match.startDamage : 0;    // custom match: you start AND respawn with the chosen starting damage
        this.dropHeld();
        this.balloon = false; this.maxJumps = charOf(this.char).jumps; this.gravT = 0; this.stuckTo = 0; this.sx = null; this.armorT = 0;
        this.jumpsLeft = this.maxJumps;
        this.isHanging = false;
        this.canGrab = true;
        this.isGrabDashing = false;
        this.isRolling = false;
        this.rollTimer = 0;
        this.dropT = 0;
        this.grabHolding = null;
        this.grabbedBy = null;
        this.grabTimer = 0;
        this.isShielding = false;
        this.shieldHealth = this.maxShieldHealth;
        this.dizzyTimer = 0;
        this.clashStunTimer = 0;
        this.hitstun = 0;
        this.invincibleTimer = 120;
        this.attackTimer = 0;
        this.activeHitbox = null;
        this.incomingHitCount = 0;
        this.attackKind = null;
        this.throwFxT = 0;
        this._teleported = true;
        this.initCombat();

        if (fullReset) {
            this.stocks = S.match ? S.match.stocks : 3;
            this.out = false;
            this.kills = 0; this.deaths = 0; this.lastHitBy = null; this.lastHitT = 9999;
        }
    }

    // ------------------------------------------------------------ action gating
    /** true while the fighter may NOT start a new move */
    actionBlocked() {
        return this.actionLock > 0 || this.hitstun > 0 || this.dizzyTimer > 0 || this.clashStunTimer > 0 ||
            this.freezeTimer > 0 || this.isRolling || this.isHanging || !!this.grabbedBy || !!this.grabHolding ||
            this.isShielding || this.fActive || this.spiralT > 0 || this.suplexT > 0 || this.diving || !!this.sx;
    }
    canShield() {
        return this.actionLock <= 0 && !this.attackHeld && !this.fActive && this.spiralT === 0 && this.suplexT === 0 && !this.diving && !this.sx &&
            !this.isRolling && this.freezeTimer === 0;
    }
    setMove(type, frames) { this.activeMove = { type, t: frames }; }

    /** being hit / countered cancels whatever the fighter was doing */
    interrupt() {
        this.fActive = false; this.chargeFrames = 0; this.aiChargeGoal = 0;
        this.swing = null; this.attackTimer = 0; this.activeHitbox = null; this.attackHeld = false; this.meleeCharge = 0;
        this.releaseSuplexVictim();
        this.spiralT = 0; this.suplexT = 0; this.suplexPending = false; this.diving = false; this.sx = null;
        this.specialKind = null; this.specialDur = 0; this.specialT = 0;
        this.activeMove = null; this.actionLock = 0; this.freezeTimer = 0;
        this.isGrabDashing = false;
    }

    update() {
        if (this.armorT > 0) this.armorT--;
        const bj = charOf(this.char).jumps + (this.balloon ? 3 : 0);       // each character has its own jump count; a balloon ADDS 3
        if (this.maxJumps !== bj) { this.jumpsLeft = Math.min(bj, this.jumpsLeft + Math.max(0, bj - this.maxJumps)); this.maxJumps = bj; }
        if (this.gravT > 0) this.gravT--;
        if (this.dropT > 0) this.dropT--;
        if (this.damage >= 250) {
            this.takeKO();
            return;
        }

        if (this.invincibleTimer > 0) this.invincibleTimer--;
        if (this.lastHitT < 9999) this.lastHitT++;
        if (this.landFlipT > 0) this.landFlipT--;
        if (this.actionLock > 0) this.actionLock--;
        if (this.rollCooldown > 0) this.rollCooldown--;
        if (this.ledgeBan > 0) this.ledgeBan--;
        for (const k in this.cd) if (this.cd[k] > 0) this.cd[k]--;
        if (this.activeMove && --this.activeMove.t <= 0) this.activeMove = null;
        if (this.activeHitbox && this.activeHitbox.ttl !== undefined && --this.activeHitbox.ttl <= 0) this.activeHitbox = null;
        if (this.specialDur > 0 && ++this.specialT >= this.specialDur) { this.specialKind = null; this.specialDur = 0; }

        if (this.clashStunTimer > 0) {
            this.clashStunTimer--;
            this.vx = 0;
            this.vy = Math.min(this.vy + WORLD.gravity * (this.gravT > 0 ? 0.65 : 1), WORLD.terminalVelocity);
            this.x += this.vx;
            this.y += this.vy;
            this.checkStageCollision();
            return;
        }

        if (this.dizzyTimer > 0) {
            this.dizzyTimer--;
            this.vx *= 0.8;
            this.vy = Math.min(this.vy + WORLD.gravity * (this.gravT > 0 ? 0.65 : 1), WORLD.terminalVelocity);
            this.x += this.vx;
            this.y += this.vy;
            this.checkStageCollision();
            return;
        }

        if (this.freezeTimer > 0) {          // getting up after a headbutt (not a stun: no grey, no damage)
            this.freezeTimer--;
            this.vx = 0;
            this.vy = Math.min(this.vy + WORLD.gravity * (this.gravT > 0 ? 0.65 : 1), WORLD.terminalVelocity);
            this.y += this.vy;
            this.checkStageCollision();
            return;
        }

        if (this.isHanging) {
            this.hangTimer++;
            if (this.hangTimer >= HANG_MAX) {          // overstayed the ledge
                this.kickFromLedge(TIMEOUT_BAN);
                return;
            }
            this.vx = 0;
            this.vy = 0;
            const ledgeX = this.hangSide === -1 ? STAGE.x : STAGE.x + STAGE.width;
            this.x = ledgeX + (this.hangSide * 12);
            this.y = STAGE.y + 12;
            return;
        }

        if (this.isRolling) {
            this.rollTimer--;
            this.invincibleTimer = Math.max(this.invincibleTimer, 2);
            this.vx = this.rollVx;
            this.vy = 0;
            // a roll can never carry you over the void: it stops at the ledge
            let nx = this.x + this.vx;
            const minX = STAGE.x + 12, maxX = STAGE.x + STAGE.width - 12;
            let atEdge = false;
            if (nx < minX) { nx = minX; atEdge = true; }
            else if (nx > maxX) { nx = maxX; atEdge = true; }
            this.x = nx;
            this.y = STAGE.y - this.height / 2;
            this.ghosts.push({ x: this.x, y: this.y, alpha: 0.5, color: '#38bdf8' });

            if (this.rollTimer <= 0 || atEdge) {
                this.isRolling = false;
                this.vx = 0;
            }
            return;
        }

        if (this.grabbedBy) {
            this.vx = 0;
            this.vy = 0;
            const g = this.grabbedBy;
            if (g.suplexT > 0) {                  // carried round the backflip: overhead -> behind -> underneath
                const a = g.suplexAng || 0;
                this.x = g.x - g.facing * 46 * Math.sin(a);
                this.y = g.y - 46 * Math.cos(a);
            } else {
                this.x = g.x + (g.facing * 35);
                this.y = g.y;
            }
            return;
        }

        if (this.suplexT > 0) {                   // Suplex: rise with the opponent, then slam them down
            this.updateSuplex();
            return;
        }

        if (this.grabHolding) {
            this.grabTimer--;
            this.vx = 0;
            this.vy = 0;

            if (this.grabTimer <= 0) {
                const target = this.grabHolding;
                this.grabHolding = null;
                target.grabbedBy = null;

                let dx = 0;
                let dy = 0;

                if (this.isAI) {
                    const stageCenterX = STAGE.x + STAGE.width / 2;
                    dx = this.x < stageCenterX ? -1 : 1;
                    dy = -0.4;
                } else {
                    dx = (this.remoteAim ? this.remoteAim.x : mouse.worldX) - this.x;
                    dy = (this.remoteAim ? this.remoteAim.y : mouse.worldY) - this.y;
                }

                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const throwSpeed = grabThrowSpeed(target);          // 0.7x a melee hit, grows with the victim's percent
                target.vx = (dx / dist) * throwSpeed;
                target.vy = (dy / dist) * throwSpeed;
                target.hitstun = 60;
                target.grounded = false;
                target.lastHitBy = this; target.lastHitT = 0;

                audio.playThrow();
                this.throwFxT = 14;
                S.screenShake = 14;
                createParticles(target.x, target.y, '#ef4444', 25);
            }
            return;
        }

        if (this.isGrabDashing) {
            this.grabDashTimer--;
            this.ghosts.push({ x: this.x, y: this.y, alpha: 0.6, color: '#ef4444' });
            if (this.suplexPending && this.suplexTarget) {      // home in on the locked target
                const t = this.suplexTarget;
                this.facing = t.x >= this.x ? 1 : -1;
                this.vx = this.facing * SUPLEX_SPEED;
            }
            if (this.grabDashTimer <= 0) {
                this.isGrabDashing = false;
                this.suplexPending = false;
                this.suplexTarget = null;
            }
        }

        if (this.hitstun > 0) {
            this.hitstun--;
            this.vx *= 0.98;
            this.vy = Math.min(this.vy + WORLD.gravity * 0.75, WORLD.terminalVelocity);
            this.x += this.vx;
            this.y += this.vy;
            this.checkStageCollision(true);                  // ragdolled: bounce off the stage instead of sliding along it
            return;
        }

        for (let i = this.ghosts.length - 1; i >= 0; i--) {
            this.ghosts[i].alpha -= 0.05;
            if (this.ghosts[i].alpha <= 0) this.ghosts.splice(i, 1);
        }

        if (this.isShielding) {
            this.shieldHealth -= 0.25;
            this.vx = 0;
            if (this.shieldHealth <= 0) {
                this.isShielding = false;
                this.dizzyTimer = 180;
                audio.playHit(true);
            }
        } else if (this.shieldHealth < this.maxShieldHealth) {
            this.shieldHealth += 0.3;
        }

        this.updateSpecials();

        if (this.diving || this.spiralT > 0) {
            this.vx *= 0.92;
        } else if (!this.grounded) {
            this.vy = Math.min(this.vy + WORLD.gravity * (this.gravT > 0 ? 0.65 : 1), WORLD.terminalVelocity);
            this.vx *= WORLD.airFriction;
        } else {
            this.vx *= WORLD.friction;
        }

        this.x += this.vx;
        this.y += this.vy;

        this.checkStageCollision();
        this.checkLedgeMagnet();

        if (this.diving && this.grounded) this.diveImpact();

        if (this.attackTimer > 0) {
            const sw = this.swing;
            if (this.attackHeld && sw && sw.chargeable && ATTACK_FRAMES - this.attackTimer >= sw.a - 1) {
                // button still held at the wind-up: the swing waits there, charging (up to 1.7 s)
                this.actionLock = Math.max(this.actionLock, LOCK - sw.a + 1 + (this.heldItem && this.heldItem.type === 'FIRESTICK' ? 12 : 0));
                if (this.meleeCharge < MELEE_CHARGE_MAX) this.meleeCharge++;   // stays fully charged until you let go
            } else {
                const slowSwing = this.heldItem && this.heldItem.type === 'FIRESTICK' && this.swing && this.swing.type !== 'BLINK';
                if (!(slowSwing && (this._slowTick = (this._slowTick || 0) + 1) % 3 === 0)) this.attackTimer--;   // firestick: swings take 1.5x as long
                if (this.attackTimer === 0 && this.swing) {
                    this.swing = null;
                    this.activeHitbox = null;
                    this.attackHeld = false; this.meleeCharge = 0;
                }
            }
        }
        this.updateSwing();

        if (this.x < BLAST_ZONES.left || this.x > BLAST_ZONES.right ||
            this.y < BLAST_ZONES.top || this.y > BLAST_ZONES.bottom) {
            this.takeKO();
        }
    }

    // ------------------------------------------------------------ swings (J attack, Blink slash)
    updateSwing() {
        const sw = this.swing;
        if (!sw) return;
        const e = ATTACK_FRAMES - this.attackTimer;          // frames elapsed (1..18)
        if (this.swingHit || e < sw.a || e > sw.b) {
            this.activeHitbox = null;
            return;
        }
        const k = (e - sw.a) / Math.max(1, sw.b - sw.a);
        const p = sw.path(k, this.facing);
        const cm = 1 + MELEE_CHARGE_BONUS * (this.meleeCharge / MELEE_CHARGE_MAX);          // charged swing: up to +30%
        const fl = this.heldItem && this.heldItem.type === 'FIRESTICK' ? this.heldItem.len : 1;   // firestick: longer reach
        const reach = 1 + (fl - 1) * 0.6;
        this.activeHitbox = {
            x: this.x + p.x * reach, y: this.y + p.y * reach, w: sw.w * fl, h: sw.h * (1 + (fl - 1) * 0.35),
            damage: sw.damage * cm, bkb: sw.bkb * cm, kbg: sw.kbg * cm, angle: sw.angle(this.facing, this.grounded), type: sw.type,
            multi: !!sw.multi, fire: fl > 1,
        };
        if (sw.type === 'J') this.setMove('J', 2);            // J only counters while its swing is live
    }

    // ------------------------------------------------------------ F specials: per-frame state
    updateSpecials() {
        if (this.fActive) this.chargeFrames = Math.min(120, this.chargeFrames + 1);

        if (this.sx) this.updateSx();

        if (this.spiralT > 0) {                               // the Up-F recovery (Rising Spiral and every character's own version)
            const sp = spec(this.char, 'U');
            this.spiralT--;
            this.vy = -sp.vy;
            const n = sp.frames - this.spiralT;               // 1..frames
            if (sp.inv && n <= sp.inv) this.invincibleTimer = Math.max(this.invincibleTimer, 2);
            const lastZone = n >= sp.frames - 5;
            const fire = lastZone ? n === sp.frames - 5 : (sp.hitDmg > 0 && n % sp.every === 1);
            if (fire) {
                const last = lastZone;
                this.activeHitbox = {
                    x: this.x, y: this.y - 8, w: sp.w, h: sp.h, type: 'SPIRAL', ttl: 5,
                    damage: last ? sp.lastDmg : sp.hitDmg, bkb: last ? sp.lastBkb : 0, kbg: last ? sp.lastKbg : 0,
                    angle: -Math.PI / 2 + this.facing * 0.35,
                    fixed: last ? null : { vx: this.facing * 1.5, vy: -sp.vy, hitstun: 14 },
                };
                fx('spiral', this.x, this.y);
            }
            if (this.spiralT === 0) this.endSpiral();
        }

        if (this.diving) {                                    // Down-F in the air: dive (Air Headbutt and every character's own version)
            const sp = spec(this.char, 'DA');
            this.diveT++;
            this.vx = sp.vx ? this.facing * sp.vx : 0;
            this.vy = sp.vy;
            this.activeMove = { type: 'HEADBUTT', t: 3 };
            if (sp.hitDmg > 0 && this.diveT % sp.every === 1) {   // consecutive hits on the way down
                this.activeHitbox = {
                    x: this.x, y: this.y + 12, w: 132, h: 118, type: 'HEADBUTT', ttl: 5,
                    damage: sp.hitDmg, bkb: 0, kbg: 0, angle: Math.PI / 2,
                    fixed: { vx: 0, vy: 18, hitstun: 14 },
                };
                fx('spiral', this.x, this.y);
            }
            if (this.diveT > 90 || this.y > STAGE.y + 260) {
                this.diving = false; this.specialKind = null; this.specialDur = 0; this.activeMove = null; this.activeHitbox = null;
            }
        }
    }

    /** running character specials: burst / breath / ground pound / dash */
    updateSx() {
        const x = this.sx, f = this.facing;
        x.t++;
        if (x.k === 'burst') {
            const sp = spec(this.char, 'N'), pt = x.t - 3;
            this.activeMove = { type: 'CORE', t: 3 };
            if (pt >= 0 && pt < sp.frames && pt % sp.every === 0) {
                const R = lerpR(sp.R, x.c);
                this.swingHitSet = new Set();
                this.activeHitbox = { x: this.x, y: this.y, w: R * 2, h: R * 2, type: 'CORE', ttl: 4, multi: true, radial: !!sp.radial, stun: sp.stun || 0,
                    damage: lerpR(sp.dmg, x.c), bkb: lerpR(sp.bkb, x.c), kbg: sp.kbg, angle: -0.8 };
                fx('explosion', this.x, this.y, R, x.c); S.screenShake = Math.max(S.screenShake, 8); audio.playHit(true);
            }
            if (x.t >= sp.frames + 8) { this.sx = null; this.activeMove = null; }
        } else if (x.k === 'breath') {
            const sp = spec(this.char, 'N');
            this.activeMove = { type: 'CORE', t: 3 };
            if (x.t < sp.frames && x.t % sp.every === 0) {
                const w = lerpR(sp.w, x.c), last = x.t + sp.every >= sp.frames;
                this.swingHitSet = new Set();
                this.activeHitbox = { x: this.x + f * (w / 2 + 16), y: this.y - 6, w, h: sp.h, type: 'CORE', ttl: sp.every, multi: true,
                    damage: last ? sp.lastDmg : sp.dmg, bkb: last ? sp.bkb : 0, kbg: last ? sp.kbg : 0, angle: f > 0 ? -0.5 : Math.PI + 0.5,
                    fixed: last ? null : { vx: f * 3.5, vy: -1, hitstun: 12 } };
                createParticles(this.x + f * w * 0.5, this.y - 6, '#fb923c', 8); createParticles(this.x + f * w * 0.8, this.y - 6, '#fde047', 5);
                fx('burn', this.x + f * w * 0.6, this.y - 6);
            }
            if (x.t >= sp.frames + 6) { this.sx = null; this.activeMove = null; }
        } else if (x.k === 'pound') {
            const sp = spec(this.char, 'DG');
            this.activeMove = { type: 'SPIRAL', t: 3 };
            this.vx = 0;
            const pt = x.t - sp.windup, n = sp.hits || 1, ev = sp.every || 6;
            if (pt >= 0 && pt < n * ev && pt % ev === 0) {
                const w = STAGE.width * sp.w, feet = this.y + this.height / 2;
                const cx = x.tx !== null ? x.tx : this.x + (sp.centred ? 0 : f * (sp.off || 0)), cy = x.ty !== null ? x.ty : feet - sp.h / 2;
                this.swingHitSet = new Set();
                this.activeHitbox = { x: cx, y: cy, w, h: sp.h, type: 'SPIRAL', ttl: 4, multi: true, mirror: true, radial: !!sp.radial, stun: sp.stun || 0,
                    pull: sp.pull || 0, damage: sp.dmg, bkb: sp.bkb, kbg: sp.kbg, angle: sp.ang };
                fx('stomp', cx, cy + sp.h / 2, w, 0); S.screenShake = Math.max(S.screenShake, 10); audio.playHit(true);
                createParticles(cx, cy + sp.h / 2, this.color, 14);
            }
            if (x.t >= sp.windup + n * ev + 6) { this.sx = null; this.activeMove = null; this.actionLock = Math.max(this.actionLock, sp.lock || LOCK); }
        } else if (x.k === 'dash') {
            const sp = spec(this.char, 'S');
            if (x.t <= sp.frames) {
                this.x = Math.min(WORLD.width - 20, Math.max(20, this.x + x.d * sp.dist / sp.frames));
                this.vx = 0; this.vy = Math.min(this.vy, 0.5);
                this.ghosts.push({ x: this.x, y: this.y, alpha: 0.6, color: '#fde68a' });
            } else { this.sx = null; this.armorT = Math.min(this.armorT, 2); }
        }
    }

    endSpiral() {
        this.activeMove = null;
        const overStage = this.x > STAGE.x - 40 && this.x < STAGE.x + STAGE.width + 40 && this.y < STAGE.y;
        if (!overStage) this.actionLock = Math.max(this.actionLock, 96);   // missed the stage -> extra lag
    }

    diveImpact() {
        const sp = spec(this.char, 'DA');
        this.diving = false;
        this.vy = 0;
        const w = STAGE.width * sp.impactW;                   // Headbutt: 1/8 of the stage
        const hit = sp.stun ? { damage: sp.impactDmg, bkb: 0, kbg: 0, angle: -Math.PI / 2, stun: sp.stunFrames || STUN }
                            : { damage: sp.impactDmg, bkb: sp.bkb, kbg: sp.kbg, angle: sp.ang, mirror: true, multi: true };
        this.activeHitbox = { x: this.x, y: this.y + this.height / 2 - 30, w, h: 64, type: 'HEADBUTT', ttl: 8, ...hit };
        this.activeMove = { type: 'HEADBUTT', t: 10 };
        this.specialKind = null; this.specialDur = 0;
        this.freezeTimer = sp.lock !== undefined ? sp.lock : FREEZE;
        if (sp.vx) { this.vy = -8; this.grounded = false; this.freezeTimer = Math.min(this.freezeTimer, 8); }   // the diagonal kick bounces back up
        if (hit.multi) this.swingHitSet = new Set();
        fx('stomp', this.x, this.y + this.height / 2, w, 0);
        S.screenShake = Math.max(S.screenShake, 14);
        audio.playHit(true);
    }

    // ------------------------------------------------------------ F special: input
    canStartF(dir) {
        if (this.actionBlocked()) return false;
        if (!this.grounded && this.airSpecials >= AIR_F_MAX) return false;
        if (dir === 'NEUTRAL' && this.cd.CORE > 0) return false;
        return true;
    }
    fPress(dir) {
        if (!this.canStartF(dir)) return false;
        this.fActive = true;
        this.fNeutral = dir === 'NEUTRAL';
        this.fDirPress = dir;
        this.chargeFrames = 0;
        this.aiChargeGoal = 0;
        return true;
    }
    cancelF() { this.fActive = false; this.chargeFrames = 0; this.aiChargeGoal = 0; }
    /** F released: held >= 0.5 s (or neutral aim) -> CBG Core, otherwise the directional variant */
    fRelease(dir, tx, ty) {
        if (!this.fActive) return false;
        const held = this.chargeFrames, neutral = this.fNeutral, dp = this.fDirPress;
        this.cancelF();
        if (neutral || held >= HOLD_TO_CORE) {
            return this.useSpecial('CORE', tx, ty, Math.min(1, held / CHARGE_MAX));
        }
        const d = dir !== 'NEUTRAL' ? dir : dp;
        switch (d) {
            case 'SIDE_LEFT': return this.useSpecial('BLINK', this.x - 100, this.y);
            case 'SIDE_RIGHT': return this.useSpecial('BLINK', this.x + 100, this.y);
            case 'UP': return this.useSpecial('SPIRAL', tx, ty);
            case 'DOWN': return this.useSpecial(this.grounded ? 'SUPLEX' : 'HEADBUTT', tx, ty);
            default: return this.useSpecial('CORE', tx, ty, 0);
        }
    }

    useSpecial(kind, tx, ty, charge = 0) {
        if (this.actionBlocked()) return false;
        if (this.cd[kind] > 0) return false;
        if (kind === 'SUPLEX' && !this.grounded) return false;
        if (kind === 'HEADBUTT' && this.grounded) return false;
        if (!this.grounded && kind !== 'SUPLEX' && this.airSpecials >= AIR_F_MAX) return false;

        const sp = spec(this.char, SLOT_OF[kind]);
        if (!this.grounded) this.airSpecials++;
        this.cd[kind] = sp.cd !== undefined ? sp.cd : CD[kind];
        this.actionLock = sp.lock !== undefined ? sp.lock : LOCK;

        switch (kind) {
            case 'CORE': this.startCore(tx, ty, charge); break;
            case 'BLINK': {
                const d = tx >= this.x ? 1 : -1;
                if (sp.kind === 'dash') this.startDash(d, sp); else if (sp.kind === 'wave') this.startWave(d, sp); else this.startBlink(d, sp);
                break;
            }
            case 'SPIRAL': this.startSpiral(tx); break;
            case 'SUPLEX': if (sp.kind === 'pound') this.startPound(sp); else this.startSuplex(tx); break;
            case 'HEADBUTT': this.startHeadbutt(); break;
        }
        return true;
    }

    startCore(tx, ty, charge) {
        const sp = spec(this.char, 'N');
        if (sp.kind === 'burst') return this.startSx('burst', charge);
        if (sp.kind === 'breath') {
            if (tx !== undefined && Math.abs(tx - this.x) > 20) this.facing = tx > this.x ? 1 : -1;
            return this.startSx('breath', charge);
        }
        let dx = tx - this.x, dy = ty - this.y;
        let len = Math.hypot(dx, dy);
        if (len < 1) { dx = this.facing; dy = 0; len = 1; }
        dx /= len; dy /= len;
        if (Math.abs(dx) > 0.2) this.facing = dx > 0 ? 1 : -1;
        const speed = lerpR(sp.speed, charge);
        const r = lerpR(sp.r, charge);
        const full = charge >= 1;
        const color = full ? (this.superColor || (this === p1 ? '#a855f7' : '#fb923c')) : this.color;   // full charge: blue -> purple, red -> orange
        orbs.push({
            x: this.x + dx * (40 + r * 0.4), y: this.y + dy * (40 + r * 0.4),
            vx: dx * speed, vy: dy * speed, r, charge, owner: this, life: sp.life, color, id: ++orbSerial,
            d: lerpR(sp.dmg, charge), R: lerpR(sp.R, charge), bkb: lerpR(sp.bkb, charge), kbg: sp.kbg,
            grav: sp.grav || 0, curve: sp.curve || 0, wobble: sp.wobble || 0, pull: sp.pull || 0, age: 0,
        });                                                   // flies straight along the aim (Umbra's curves a little, Terra's arcs)
        this.setMove('CORE', 24);
        this.specialKind = 'CORE'; this.specialT = 0; this.specialDur = 24;
        audio.playDash();
        fx('core', this.x, this.y, charge, Math.atan2(dy, dx));
    }

    startSx(k, charge = 0, extra = {}) {
        this.sx = { k, t: 0, c: Math.round(charge * 100) / 100, tx: null, ty: null, d: 1, ...extra };
        this.setMove(k === 'dash' ? 'BLINK' : k === 'pound' ? 'SPIRAL' : 'CORE', 6);
        this.specialKind = 'CORE'; this.specialT = 0; this.specialDur = 30;
        audio.playDash();
    }

    startPound(sp) {
        this.startSx('pound');
        if (sp.armor) this.armorT = sp.windup + 8;
        if (sp.atTarget) {
            const foe = nearestOf(this, foesOf(this));
            if (foe && Math.hypot(foe.x - this.x, foe.y - this.y) < 700) { this.sx.tx = foe.x; this.sx.ty = foe.y + 20 - sp.h / 2 + 30; fx('stomp', foe.x, foe.y + 34, STAGE.width * sp.w, 0); }
            else { this.sx.tx = this.x + this.facing * 170; this.sx.ty = this.y + this.height / 2 - sp.h / 2; }
        }
    }

    startWave(d, sp) {
        this.facing = d;
        orbs.push({
            x: this.x + d * 50, y: this.y + this.height / 2 - sp.r * 0.7, vx: d * sp.speed, vy: 0, r: sp.r, charge: 0.35, owner: this, life: sp.life, color: this.color, id: ++orbSerial,
            d: sp.dmg, R: sp.R, bkb: sp.bkb, kbg: sp.kbg, flat: true, grav: 0, curve: 0, wobble: 0, pull: 0, age: 0,
        });
        this.setMove('CORE', 20);
        this.specialKind = 'CORE'; this.specialT = 0; this.specialDur = 20;
        audio.playDash();
        fx('core', this.x, this.y, 0.4, d > 0 ? 0 : Math.PI);
    }

    startDash(d, sp) {
        this.facing = d;
        this.startSx('dash', 0, { d });
        this.setMove('BLINK', sp.frames + 3);
        if (sp.armor) this.armorT = sp.frames + 6;
        this.attackKind = d > 0 ? 'SIDE_RIGHT' : 'SIDE_LEFT';
        this.attackTimer = ATTACK_FRAMES; this.attackSerial++;
        this.swing = SWING['SP_' + this.char + '_S'];
        this.swingHit = false;
        this.swingHitSet = this.swing.multi ? new Set() : null;
        this.vy = Math.min(this.vy, 0.5);
    }

    startBlink(d, sp = spec(this.char, 'S')) {
        this.facing = d;
        const fromX = this.x, fromY = this.y;
        let nx = this.x + d * sp.dist;
        if (sp.behind) {                                      // Shadow Step: appear behind the nearest foe
            const foe = nearestOf(this, foesOf(this));
            if (foe && Math.hypot(foe.x - this.x, foe.y - this.y) < 520) {
                d = foe.x >= this.x ? 1 : -1; this.facing = d;
                nx = foe.x - d * 70; this.y = foe.y;
            }
        }
        this.x = Math.min(WORLD.width - 20, Math.max(20, nx));
        this.vy = Math.min(this.vy, 1.5);
        this.vx = d * 2;
        this.invincibleTimer = Math.max(this.invincibleTimer, 8);
        for (let i = 1; i <= 6; i++) {
            this.ghosts.push({ x: fromX + (this.x - fromX) * i / 7, y: fromY, alpha: 0.75 - i * 0.08, color: '#a78bfa' });
        }
        fx('blink', fromX, fromY, this.x, this.y);
        this.attackKind = d > 0 ? 'SIDE_RIGHT' : 'SIDE_LEFT';
        this.attackTimer = ATTACK_FRAMES;
        this.attackSerial++;
        this.swing = SWING[sp.swing] || SWING.BLINK;
        this.swingHit = false;
        this.setMove('BLINK', 18);
        audio.playDash();
    }

    startSpiral(tx) {
        const sp = spec(this.char, 'U');
        this.jumpsLeft = Math.max(0, this.jumpsLeft - SPIRAL_JUMP_COST);   // recovery that costs a couple of jumps
        this.grounded = false;
        this.y -= 4;
        this.vy = -sp.vy;
        if (tx !== undefined && Math.abs(tx - this.x) > 20) this.facing = tx > this.x ? 1 : -1;
        this.spiralT = sp.frames;
        if (sp.armor) this.armorT = sp.frames;
        if (sp.inv) this.invincibleTimer = Math.max(this.invincibleTimer, sp.inv);
        this.specialKind = 'SPIRAL'; this.specialT = 0; this.specialDur = sp.frames;
        this.setMove('SPIRAL', sp.frames);
        audio.playJump();
        fx('spiral', this.x, this.y);
    }

    /** Ground Down-F: dash forward like a grab; if it connects, carry the opponent up and slam them down. */
    startSuplex(tx) {
        if (tx !== undefined && Math.abs(tx - this.x) > 20) this.facing = tx > this.x ? 1 : -1;
        this.suplexPending = true;
        this.isGrabDashing = true;
        // homing: lock onto an opponent inside 0.45 of the stage length, otherwise it is a blank dash forward
        const foe = nearestOf(this, foesOf(this));
        const inRange = foe && Math.hypot(foe.x - this.x, foe.y - this.y) <= STAGE.width * SUPLEX_DETECT;
        this.suplexTarget = inRange ? foe : null;
        if (inRange) {
            this.facing = foe.x >= this.x ? 1 : -1;
            this.grabDashTimer = Math.min(50, Math.ceil(Math.abs(foe.x - this.x) / SUPLEX_SPEED) + 8);
        } else {
            this.grabDashTimer = 14;
        }
        this.vx = this.facing * SUPLEX_SPEED;
        this.vy = 0;
        this.setMove('GRAB', 14);                              // counters / is countered exactly like a grab
        audio.playDash();
    }
    beginSuplex(d) {
        this.suplexPending = false;
        this.isGrabDashing = false;
        this.grabDashTimer = 0;
        this.grabHolding = null;
        this.vx = 0; this.vy = 0;
        d.interrupt();
        d.isShielding = false;
        d.grabbedBy = this;
        d.hitstun = 90;
        this.suplexT = 1; this.suplexN = 0; this.suplexPhase = 'rise';
        this.suplexAng = 0;
        this.grabVictim = d;
        this.specialKind = 'SUPLEX'; this.specialT = 0; this.specialDur = 999;
        this.activeMove = null;
        audio.playGrab();
        fx('grab', d.x, d.y);
    }
    releaseSuplexVictim() {
        const d = this.grabVictim;
        if (d && d.grabbedBy === this) { d.grabbedBy = null; d.hitstun = 10; }
        this.grabVictim = null;
        if (this.suplexT > 0) { this.specialKind = null; this.specialDur = 0; }
    }
    updateSuplex() {
        const d = this.grabVictim;
        if (!d || d.grabbedBy !== this) { this.endSuplex(); return; }
        this.suplexN++;
        // a backwards half backflip: hop up and back while rotating, the victim is carried round with you
        if (this.suplexPhase === 'rise') {
            const u = Math.min(1, this.suplexN / SUPLEX_RISE);
            this.vy = -13.5 * (1 - u * 0.6); this.vx = -this.facing * 3.2;
            this.suplexAng = Math.PI * 0.62 * u * u * (3 - 2 * u);
            this.x += this.vx; this.y += this.vy;
            if (this.y < TOP_LIMIT) {                          // reached the top of the map: cancel
                this.endSuplex();
                this.actionLock = Math.max(this.actionLock, 60);
                return;
            }
            if (this.suplexN >= SUPLEX_RISE) { this.suplexPhase = 'slam'; this.suplexN = 0; }
        } else {
            const u = Math.min(1, this.suplexN / 9);
            this.vy = Math.min(26, 6 + this.suplexN * 2.6); this.vx = -this.facing * 2.2;
            this.suplexAng = Math.PI * (0.62 + 0.38 * u);
            this.x += this.vx; this.y += this.vy;
            this.checkStageCollision();
            if (this.grounded) { this.suplexImpact(d); return; }
            if (this.suplexN > 45 || this.y > STAGE.y + 300) { this.endSuplex(); return; }   // never found the floor
        }
    }
    suplexImpact(d) {
        d.grabbedBy = null;
        this.grabVictim = null;
        this.suplexT = 0;
        this.specialKind = null; this.specialDur = 0;
        d.x = this.x - this.facing * 34;
        d.y = this.y;
        this.vx = 0; this.vy = 0;
        this.suplexAng = 0; this.landFlipT = 12;               // the backflip finishes with a quick landing roll
        fx('stomp', this.x, this.y + this.height / 2, STAGE.width / 8, 0);
        S.screenShake = Math.max(S.screenShake, 16);
        launch(this, d, {
            damage: 14, bkb: 7, kbg: 0.7,
            angle: this.facing === 1 ? Math.PI + Math.PI / 3 : -Math.PI / 3,   // thrown up and behind
        });
    }
    endSuplex() {
        this.releaseSuplexVictim();
        this.suplexT = 0; this.suplexAng = 0;
        this.specialKind = null; this.specialDur = 0;
        this.vx = 0; this.vy = 0;
    }

    startHeadbutt() {
        const sp = spec(this.char, 'DA');
        this.diving = true;
        this.diveT = 0;
        this.diveHit = false;
        this.vx = sp.vx ? this.facing * sp.vx : 0;
        this.vy = sp.vy;
        this.specialKind = 'HEADBUTT'; this.specialT = 0; this.specialDur = 999;
        this.setMove('HEADBUTT', 3);
        audio.playDash();
    }

    // ------------------------------------------------------------ ledges
    checkLedgeMagnet() {
        if (this.grounded || this.isHanging || this.hitstun > 0 || this.ledgeBan > 0 || this.diving) return;

        const leftLedgeX = STAGE.x;
        const rightLedgeX = STAGE.x + STAGE.width;
        const ledgeY = STAGE.y;

        const magnetRangeX = 225;
        const magnetRangeY = 165;

        if (this.x >= leftLedgeX - magnetRangeX && this.x <= leftLedgeX + 50 &&
            this.y >= ledgeY - 40 && this.y <= ledgeY + magnetRangeY && this.vy >= -3) {
            this.hangLedge(-1);
        }
        else if (this.x >= rightLedgeX - 50 && this.x <= rightLedgeX + magnetRangeX &&
            this.y >= ledgeY - 40 && this.y <= ledgeY + magnetRangeY && this.vy >= -3) {
            this.hangLedge(1);
        }
    }

    hangLedge(side) {
        // one fighter per ledge: whoever arrives second kicks the first one off (3 s without a ledge)
        for (const other of fighters) if (other !== this && other.active && other.isHanging && other.hangSide === side) other.kickFromLedge(KICK_BAN);

        this.isHanging = true;
        this.hangSide = side;
        this.hangTimer = 0;
        this.vx = 0;
        this.vy = 0;
        this.grounded = false;
        this.fActive = false; this.chargeFrames = 0;
        this.actionLock = 0;

        this.jumpsLeft = this.maxJumps;
        this.canGrab = true;
        // (air F moves are NOT refilled here: only the ground does that)

        this.invincibleTimer = 90;
        audio.playShield();
        createParticles(this.hangSide === -1 ? STAGE.x : STAGE.x + STAGE.width, STAGE.y, '#38bdf8', 10);
    }

    kickFromLedge(ban) {
        const side = this.hangSide;
        this.isHanging = false;
        this.hangTimer = 0;
        this.ledgeBan = ban;
        this.vx = side * 5;                                   // away from the stage
        this.vy = 3;
        this.grounded = false;
        this.invincibleTimer = 0;
        fx('kick', this.x, this.y, side);
        createParticles(this.x, this.y, '#f59e0b', 14);
        audio.playHit(false);
    }

    checkStageCollision(bounce = false) {
        const vx0 = this.vx, vy0 = this.vy;                  // speed on impact (used for the ragdoll bounce)
        const BOUNCE = 0.62, MIN_BOUNCE = 3.2;
        const platLeft = STAGE.x;
        const platRight = STAGE.x + STAGE.width;
        const platTop = STAGE.y;
        const platBottom = STAGE.y + STAGE.height;

        const fLeft = this.x - this.width / 2;
        const fRight = this.x + this.width / 2;
        const fTop = this.y - this.height / 2;
        const fBottom = this.y + this.height / 2;

        // (the 0.5 tolerance keeps a fighter standing exactly on the surface "grounded" every
        //  frame; the strict comparison used to flicker grounded on/off, which made rolls and
        //  ground-only moves fail about half of the time)
        if (fRight > platLeft && fLeft < platRight && fBottom > platTop - 0.5 && fTop < platBottom) {
            const overlapLeft = fRight - platLeft;
            const overlapRight = platRight - fLeft;
            const overlapTop = fBottom - platTop;
            const overlapBottom = platBottom - fTop;

            const minOverlapX = Math.min(overlapLeft, overlapRight);
            const minOverlapY = Math.min(overlapTop, overlapBottom);

            if (minOverlapY < minOverlapX) {
                if (overlapTop < overlapBottom && this.vy >= 0) {
                    this.y = platTop - this.height / 2;
                    if (bounce && vy0 > MIN_BOUNCE) {         // land hard: bounce back up with the knockback that is left
                        this.vy = -vy0 * BOUNCE;
                        this.vx = vx0 * 0.9;
                        this.grounded = false;
                        fx('hit', this.x, platTop, Math.min(16, vy0 * 0.6), -Math.PI / 2);
                        S.screenShake = Math.max(S.screenShake, Math.min(10, vy0 * 0.4));
                        return;
                    }
                    this.vy = 0;
                    if (bounce) this.vx *= 0.35;               // settled: no skating across the floor
                    this.grounded = true;
                    this.jumpsLeft = this.maxJumps;
                    this.canGrab = true;
                    this.isHanging = false;
                    this.airSpecials = 0;                     // touching the ground recharges air F moves
                } else if (overlapBottom <= overlapTop && this.vy < 0) {
                    this.y = platBottom + this.height / 2;
                    this.vy = bounce ? -vy0 * BOUNCE : 0;      // knocked into the underside: rebound downward
                }
            } else {
                if (overlapLeft < overlapRight) {
                    this.x = platLeft - this.width / 2;
                } else {
                    this.x = platRight + this.width / 2;
                }
                this.vx = bounce ? -vx0 * BOUNCE : 0;          // rebound off the side wall with the speed that is left
                if (bounce && Math.abs(vx0) > MIN_BOUNCE) fx('hit', this.x, this.y, Math.min(16, Math.abs(vx0) * 0.6), vx0 > 0 ? Math.PI : 0);
            }
        } else {
            this.grounded = false;
        }

        // soft platforms (custom-match arena): you land on top when coming down onto them, and pass through from below
        if (!this.grounded && STAGE.platforms.length && this.dropT <= 0 && vy0 >= 0) {
            const bottom = this.y + this.height / 2, prevBottom = this.py + this.height / 2;
            for (const pl of STAGE.platforms) {
                if (this.x + this.width / 2 > pl.x && this.x - this.width / 2 < pl.x + pl.w &&
                    bottom > pl.y - 0.5 && prevBottom <= pl.y + 1 && bottom < pl.y + 60) {
                    this.y = pl.y - this.height / 2;
                    if (bounce && vy0 > MIN_BOUNCE) {
                        this.vy = -vy0 * BOUNCE; this.vx = vx0 * 0.9;
                        fx('hit', this.x, pl.y, Math.min(16, vy0 * 0.6), -Math.PI / 2);
                        break;
                    }
                    this.vy = 0;
                    if (bounce) this.vx *= 0.35;
                    this.grounded = true;
                    this.jumpsLeft = this.maxJumps;
                    this.canGrab = true;
                    this.isHanging = false;
                    this.airSpecials = 0;
                    break;
                }
            }
        }
    }

    // ------------------------------------------------------------ moves
    /** Roll: ONLY while shielding (hold E + scroll wheel), 2 s cooldown, never over the void. */
    executeRoll(force = false, dirOverride = 0) {
        if (!this.grounded || this.hitstun > 0 || this.dizzyTimer > 0 || this.clashStunTimer > 0 || this.isRolling ||
            this.freezeTimer > 0 || this.suplexT > 0 || this.diving || this.spiralT > 0 || this.sx || this.grabbedBy || this.grabHolding) return false;
        if (this.rollCooldown > 0) return false;
        if (!force && !this.isShielding) return false;

        this.isShielding = false;
        this.cancelF();

        let rollDir = this.facing;
        if (dirOverride) rollDir = dirOverride;
        else if (Math.abs(mouse.worldX - this.x) > 10) rollDir = mouse.worldX > this.x ? 1 : -1;

        this.facing = rollDir;
        this.isRolling = true;
        this.rollTotal = ROLL_FRAMES;
        this.rollTimer = ROLL_FRAMES;
        this.rollCooldown = ROLL_COOLDOWN;
        this.actionLock = LOCK;
        this.rollVx = rollDir * (ROLL_DISTANCE / ROLL_FRAMES);

        audio.playDash();
        createParticles(this.x, this.y, '#38bdf8', 12);
        return true;
    }

    jump() {
        if (this.hitstun > 0 || this.isShielding || this.dizzyTimer > 0 || this.clashStunTimer > 0 || this.grabbedBy || this.grabHolding || this.isRolling) return false;
        if (this.freezeTimer > 0 || this.suplexT > 0 || this.diving || this.spiralT > 0 || this.sx) return false;
        if (this.actionLock > JUMP_OK) return false;                // 0.3 s after a move you may jump again

        if (this.isHanging) {
            this.isHanging = false;
            this.vy = -14.5;
            this.vx = this.hangSide * 7.5;
            this.jumpsLeft = this.maxJumps;
            this.canGrab = true;
            audio.playJump();
            createParticles(this.x, this.y, '#38bdf8', 10);
            return true;
        }

        if (this.grounded) {
            this.vy = -15.2;
            this.grounded = false;
            this.jumpsLeft--;
            audio.playJump();
            createParticles(this.x, this.y + this.height/2, '#38bdf8', 8);
        } else if (this.jumpsLeft > 0) {
            this.vy = -13.5;
            this.jumpsLeft--;
            audio.playJump();
            createParticles(this.x, this.y + this.height/2, '#06b6d4', 10);
        }
        else return false;
        return true;
    }

    executeGrabDash(targetWorldX, targetWorldY) {
        if (this.heldItem && !this.actionBlocked()) return throwHeldItem(this, targetWorldX, targetWorldY);   // aimed grab with an item = throw it
        if (!this.canGrab || this.actionBlocked()) return false;

        const dx = targetWorldX - this.x;
        const dy = targetWorldY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return false;

        this.canGrab = false;
        this.actionLock = LOCK;

        const grabDashSpeed = 23;
        this.vx = (dx / dist) * grabDashSpeed;
        this.vy = (dy / dist) * grabDashSpeed;

        this.isGrabDashing = true;
        this.grabDashTimer = 16;
        this.setMove('GRAB', 16);
        audio.playDash();
        return true;
    }


    /** The "J" attack (now on right click / the aim-matrix attack). The hitbox follows the animation. */
    attack(aimDirection, hold = false) {
        if (this.attackTimer > 0 || this.actionBlocked()) return false;

        let kind = 'JAB';
        switch (aimDirection) {
            case 'UP': kind = 'UP'; break;
            case 'DOWN': kind = 'DOWN'; break;
            case 'SIDE_LEFT': kind = 'SIDE_LEFT'; this.facing = -1; break;
            case 'SIDE_RIGHT': kind = 'SIDE_RIGHT'; this.facing = 1; break;
        }
        this.attackKind = kind;
        this.attackSerial++;
        this.attackTimer = ATTACK_FRAMES;
        this.swing = SWING[kind];
        this.swingHit = false;
        this.swingHitSet = this.swing.multi ? new Set() : null;
        this.attackHeld = !!(hold && this.swing.chargeable);
        this.meleeCharge = 0;
        this.activeHitbox = null;
        this.actionLock = LOCK + (this.heldItem && this.heldItem.type === 'FIRESTICK' ? 12 : 0);   // firestick: 0.2 s more aftermath
        audio.playHit(false);
        return true;
    }
    /** melee button released: a charging swing is let go */
    releaseAttack() { this.attackHeld = false; }

    /** drop (and destroy) whatever item is in hand */
    dropHeld() {
        if (this.heldItem) { this.heldItem.st = 'dead'; this.heldItem.holder = null; }
        this.heldItem = null; this.heldId = 0;
    }

    takeKO() {
        if (S.gameMode === 'training' && this.isAI) {
            this.reset(false);
            return;
        }

        const timerMode = !!(S.match && S.match.mode === 'timer');
        if (!timerMode) this.stocks--;
        this.deaths++;
        if (S.online !== 'guest') {                         // kill credit: whoever hit this fighter in the last 6 s (self-KO costs a point)
            const k = this.lastHitBy;
            if (k && k !== this && this.lastHitT < 360) k.kills++; else if (timerMode) this.kills = Math.max(-99, this.kills - 1);
        }
        this.lastHitBy = null; this.lastHitT = 9999;
        audio.playKO();
        createExplosion(this.x, this.y);
        fx('ko', this.x, this.y);

        if (S.online === 'host') outbox.push({ k: 'b', e: [this.x, this.y] });
        koBeams.push({
            startX: this.x,
            startY: this.y,
            targetX: STAGE.x + STAGE.width / 2,
            targetY: STAGE.y,
            alpha: 1.0,
            width: 32
        });

        if (timerMode) { this.reset(false); return; }      // timer match: nobody is ever eliminated
        if (this.stocks <= 0 && S.match) {                 // custom match: out of the game, the match may be over
            this.out = true; this.vx = 0; this.vy = 0; this.isShielding = false; this.fActive = false;
            if (S.online !== 'guest') checkMatchEnd();
            return;
        }
        if (this.stocks <= 0) {
            saveBotMemory();
            if (S.online === 'host') {                       // human vs human: the other fighter wins
                const winner = this === p1 ? p2 : p1;
                triggerDramaticZoom(winner);
                S.iWon = S.online === 'host' ? winner === p1 : winner === p2;
                endGame(winner === p1 ? 'YOU WIN!' : 'YOU LOSE!', winner === p1 ? 'host' : 'guest');
                return;
            }
            triggerDramaticZoom(this.isAI ? p1 : p2);
            endGame(this.isAI ? "PLAYER 1 WINS!" : "AI BOT WINS!");
        } else {
            this.reset(false);
        }
    }
}

// ============================================================================
//  BOT
//  The bot uses exactly the same move rules as the player (lock, cooldowns, air limit).
//  It also *trains*: it watches which moves you use, remembers that (saved in the browser
//  between matches) and shifts its choices to beat your habits.
// ============================================================================
const BOT_MEM_KEY = 'luminary.botMemory.v1';
const botMem = (() => {
    try { return JSON.parse(localStorage.getItem(BOT_MEM_KEY)) || {}; } catch (e) { return {}; }
})();
function saveBotMemory() { try { localStorage.setItem(BOT_MEM_KEY, JSON.stringify(botMem)); } catch (e) { /* storage unavailable */ } }
const MEM_KEYS = ['SHIELD', 'J', 'GRAB', 'CORE', 'BLINK', 'SPIRAL', 'SUPLEX', 'HEADBUTT'];
/** how often the player uses `k` (0..1, smoothed so a short history can't be extreme) */
function habitOf(k) {
    let total = 0;
    for (const m of MEM_KEYS) total += botMem[m] || 0;
    return ((botMem[k] || 0) + 1) / (total + MEM_KEYS.length);
}

class AIBot extends Fighter {
    constructor(x, y, color, name) {
        super(x, y, color, name, true);
        this.actionTimer = 0;
        this.shieldHold = 0;
        this.lastSeen = null;
        this.memSaveT = 0;
        this.diff = null;                       // custom matches: 'easy' | 'medium' | 'hard' per bot
    }

    get level() { return this.diff || (S.gameMode === 'easy' ? 'easy' : S.gameMode === 'medium' ? 'medium' : 'hard'); }

    /** watch the player (learn their habits) */
    observe(target) {
        const m = target.isShielding ? 'SHIELD' : (target.activeMove ? target.activeMove.type : null);
        if (m && m !== this.lastSeen && MEM_KEYS.includes(m)) botMem[m] = (botMem[m] || 0) + 1;
        this.lastSeen = m;
        if (++this.memSaveT >= 600) { this.memSaveT = 0; saveBotMemory(); }
    }

    raiseShield(frames) { this.shieldHold = frames; }

    beginCore(target, frames) {
        if (!this.canStartF('NEUTRAL')) return false;
        this.fActive = true; this.fNeutral = true; this.fDirPress = 'NEUTRAL';
        this.chargeFrames = 0; this.aiChargeGoal = frames;
        this.facing = target.x >= this.x ? 1 : -1;
        return true;
    }

    /** a recovery decision for when the bot is off the stage */
    recover() {
        const cx = STAGE.x + STAGE.width / 2;
        const ledgeX = this.x < cx ? STAGE.x : STAGE.x + STAGE.width;
        let tx = ledgeX, ty = STAGE.y;
        if (this.ledgeBan > 0) { tx = ledgeX + (ledgeX === STAGE.x ? 150 : -150); ty = STAGE.y - 80; }   // can't hang: land on the stage
        const dir = tx > this.x ? 1 : -1;
        const dxAbs = Math.abs(tx - this.x);
        const below = this.y - STAGE.y;

        this.cancelF();
        this.facing = dir;
        this.vx += dir * 1.2;

        let acted = false;
        if (this.actionTimer % 4 === 0 && below > 40 && dxAbs < 380 && (this.jumpsLeft === 0 || below > 140)) {
            acted = this.useSpecial('SPIRAL', tx, ty);
        }
        if (!acted && this.actionTimer % 6 === 0 && dxAbs > 200 && below < 220) acted = this.useSpecial('BLINK', tx, ty);
        if (!acted && this.actionTimer % 6 === 0) acted = this.executeGrabDash(tx, ty);
        if (!acted && this.attackTimer === 0 && this.actionTimer % 8 === 0 && dxAbs < 220) acted = this.attack(dir === 1 ? 'SIDE_RIGHT' : 'SIDE_LEFT');

        if (this.jumpsLeft > 0 && this.vy > -2 && this.actionTimer % 6 === 0) this.jump();
    }

    updateAI(target) {
        if (S.gameMode === 'training') {
            // the dummy never acts, but it moves with the same physics as everyone else
            // (update() applies gravity / friction / knockback once), so launches go sideways too
            this.isShielding = false;
            return;
        }

        if (this.level === 'hard') this.observe(target);

        if (this.hitstun > 0 || this.dizzyTimer > 0 || this.clashStunTimer > 0 || this.grabbedBy || this.freezeTimer > 0) {
            this.shieldHold = 0;
            this.isShielding = false;
            return;
        }

        if (this.shieldHold > 0) {
            this.shieldHold--;
            this.isShielding = this.canShield();
        } else {
            this.isShielding = false;
        }

        this.actionTimer++;
        const stageCenterX = STAGE.x + STAGE.width / 2;

        if (this.isHanging) {
            this.jump();
            this.vx = (this.x < stageCenterX) ? 8.5 : -8.5;
            return;
        }

        // steer through moves already in progress
        if (this.spiralT > 0) {
            this.vx = Math.max(-6, Math.min(6, this.vx + (this.x < stageCenterX ? 0.9 : -0.9)));
            return;
        }
        if (this.suplexT > 0 || this.diving || this.isRolling || this.sx) return;

        const isOverVoid = this.x < STAGE.x || this.x > STAGE.x + STAGE.width;
        if (isOverVoid) {
            this.recover();
            return;
        }

        const distToTargetX = target.x - this.x;
        const distToTargetY = target.y - this.y;
        const dist = Math.sqrt(distToTargetX * distToTargetX + distToTargetY * distToTargetY);

        // charging a CBG Core: stand still, then fire it straight at where the target is heading
        if (this.fActive) {
            this.vx *= 0.8;
            this.facing = distToTargetX > 0 ? 1 : -1;
            if (this.chargeFrames >= this.aiChargeGoal) {
                const flight = Math.min(30, dist / 20);
                const lead = this.level === 'hard' ? flight * 0.6 : 0;
                this.fRelease('NEUTRAL', target.x + target.vx * lead, target.y + target.vy * lead * 0.5);
            }
            return;
        }

        if (items.length && this.actionTimer % 18 === 0 && !this.grabHolding) {      // use items: throw what we hold, chase what lies near
            if (this.heldItem) {
                if (dist < 650 && Math.random() < (this.level === 'easy' ? 0.15 : 0.5) && this.executeGrabDash(target.x, target.y)) return;
            } else if (this.canGrab && this.level !== 'easy') {
                const it = items.find(i => i.st === 'idle' && Math.hypot(i.x - this.x, i.y - this.y) < 420 && Math.abs(i.y - this.y) < 200);
                if (it && Math.random() < 0.6 && this.executeGrabDash(it.x, it.y)) return;
            }
        }

        if (this.level === 'easy') {
            const reactionRate = 35;
            const movementSpeed = 0.55;

            if (this.actionTimer % reactionRate === 0) {
                this.facing = distToTargetX > 0 ? 1 : -1;

                if (Math.abs(distToTargetX) > 100) {
                    this.vx += this.facing * movementSpeed;
                }

                if (dist < 130 && Math.random() < 0.65) {
                    this.raiseShield(54);
                } else if (dist < 90 && Math.random() < 0.3) {
                    this.attack(distToTargetY < -30 ? 'UP' : 'NEUTRAL');
                } else if (dist > 380 && dist < 900 && Math.random() < 0.18 && this.grounded) {
                    this.beginCore(target, 15 + Math.random() * 17);     // the odd slow, small core
                }
            }

            const nearLeftEdge = this.x < STAGE.x + 100;
            const nearRightEdge = this.x > STAGE.x + STAGE.width - 100;
            if (nearLeftEdge || nearRightEdge || this.y > STAGE.y + 20) {
                const targetX = STAGE.x + STAGE.width / 2;
                this.vx += (targetX - this.x > 0 ? 0.6 : -0.6);
                if (this.y > STAGE.y + 20) this.recover();
                else if (this.vy > 1 && this.jumpsLeft > 0 && this.actionTimer % 25 === 0) {
                    this.jump();
                }
            }
            return;
        }

        // ------------------------------------------------------------ medium / hard (medium: slower, no habit learning, fewer counters)
        const med = this.level === 'medium';
        const habit = (k) => med ? 0 : habitOf(k);
        const nearLeftEdge = this.x < STAGE.x + 180;
        const nearRightEdge = this.x > STAGE.x + STAGE.width - 180;
        const isOffStage = nearLeftEdge || nearRightEdge || this.y > STAGE.y + 20;

        if (this.y > STAGE.y + 20) {          // under the stage: climb back
            this.recover();
            return;
        }

        const speedMultiplier = (isOffStage ? 1.4 : 1.365) * (med ? 0.78 : 1);

        const targetIsOffStage = target.x < STAGE.x - 20 || target.x > STAGE.x + STAGE.width + 20 || target.y > STAGE.y + 10 || target.isHanging;
        const targetOnEdge = target.isHanging || target.x < STAGE.x + 140 || target.x > STAGE.x + STAGE.width - 140;

        // the player is on / over the edge: shoot a CBG Core at them from range
        if ((targetIsOffStage || targetOnEdge) && this.grounded && dist > 280 && this.cd.CORE <= 0 &&
            this.actionTimer % 10 === 0 && Math.random() < (med ? 0.25 : 0.55)) {
            if (this.beginCore(target, 35 + Math.random() * 28)) return;
        }

        if (targetIsOffStage && this.grounded && !isOffStage) {
            const guardLedgeX = target.x < STAGE.x ? STAGE.x + 60 : STAGE.x + STAGE.width - 60;
            const guardDir = guardLedgeX > this.x ? 1 : -1;
            this.facing = guardDir;
            this.vx += guardDir * 1.5;

            if (Math.abs(this.x - guardLedgeX) < 100 && this.actionTimer % 15 === 0) {
                this.attack('DOWN');
            }
            return;
        }

        if (this.actionTimer % (med ? 12 : 7) === 0) {
            this.facing = distToTargetX > 0 ? 1 : -1;
            const tMove = target.isShielding ? 'SHIELD' : (target.activeMove ? target.activeMove.type : null);
            const aim = distToTargetY < -40 ? 'UP' : (distToTargetY > 40 ? 'DOWN' : (this.facing === 1 ? 'SIDE_RIGHT' : 'SIDE_LEFT'));

            if (Math.abs(distToTargetX) > 70) {
                this.vx += this.facing * 1.05 * speedMultiplier;
            }

            // 1) a core is coming: raise the shield (counters everything but grab)
            const incoming = orbs.find(o => o.owner === target && Math.hypot(o.x - this.x, o.y - this.y) < 300);
            if (incoming && Math.random() < (med ? 0.4 : 0.75)) { this.raiseShield(40); return; }

            // 2) the player is mid-attack right next to us: counter it
            if (dist < 170 && (target.isGrabDashing || (tMove && tMove !== 'SHIELD' && tMove !== 'GRAB'))) {
                const r = Math.random();
                if (target.isGrabDashing) {                      // grab is beaten by every active move: J it
                    if (r < 0.6 && this.attack(aim)) return;
                } else if (r < 0.3 + 0.4 * habit('J')) {
                    this.raiseShield(26); return;                // shield counters it
                } else if (r < 0.75 && this.attack(aim)) return; // J counters everything but shield
            }

            // 3) the player turtles in a shield: grab beats shield
            if (target.isShielding && dist < 170 && this.canGrab && Math.random() < 0.55 + 0.4 * habit('SHIELD')) {
                if (this.executeGrabDash(target.x, target.y)) return;
            }

            // 4) player is above us: spiral / up slash / jump
            const targetIsAirborne = !target.grounded && target.y < STAGE.y - 10;
            if (targetIsAirborne) {
                if (this.grounded && Math.random() < 0.6) this.jump();
                if (dist < 190 && Math.abs(distToTargetX) < 140 && distToTargetY < -50 && Math.random() < 0.4 &&
                    this.useSpecial('SPIRAL', target.x, target.y)) return;
                if (dist < 150 && this.canGrab && Math.random() < 0.5 && this.executeGrabDash(target.x, target.y)) return;
            }

            // 5) we are above the player over the stage: headbutt dive
            if (!this.grounded && distToTargetY > 80 && Math.abs(distToTargetX) < 90 && this.y < STAGE.y - 120 &&
                this.x > STAGE.x + 60 && this.x < STAGE.x + STAGE.width - 60 && Math.random() < 0.55 &&
                this.useSpecial('HEADBUTT', target.x, target.y)) return;

            if (distToTargetY < -90 && this.grounded) {
                this.jump();
            }

            // 6) neutral game at close / mid range
            if (dist < 130 && !this.grabHolding) {
                const opts = [];
                opts.push([3, () => this.attack(aim)]);
                if (this.canGrab) opts.push([1 + 3 * habit('SHIELD'), () => this.executeGrabDash(target.x, target.y)]);
                if (this.grounded && target.grounded && dist < 260) opts.push([2, () => this.useSpecial('SUPLEX', target.x, target.y)]);
                if (this.cd.BLINK <= 0 && Math.abs(distToTargetY) < 60 && dist > 80) opts.push([1, () => this.useSpecial('BLINK', target.x, target.y)]);
                this.pickWeighted(opts);
            } else if (dist < 330 && Math.abs(distToTargetY) < 70 && this.cd.BLINK <= 0 && Math.random() < 0.3) {
                this.useSpecial('BLINK', target.x, target.y);        // blink slash to close the gap
            } else if (dist > 330 && this.grounded && this.cd.CORE <= 0 && Math.random() < 0.25) {
                this.beginCore(target, 14 + Math.random() * 28);     // zoning with cores
            } else if (dist < 120) {
                this.attack(aim);
            }

            // 7) incoming attack at close range and nothing better to do: shield
            if (dist < 90 && target.activeHitbox && Math.random() < 0.5) {
                this.raiseShield(24);
            }
        }
    }

    pickWeighted(opts) {
        let total = 0;
        for (const o of opts) total += o[0];
        let r = Math.random() * total;
        for (const o of opts) {
            r -= o[0];
            if (r <= 0) return o[1]();
        }
    }
}

const particles = [];
function createParticles(x, y, color, count = 10) {
    if (S.online === 'host') outbox.push({ k: 'p', e: [x, y, color, count] });
    for (let i = 0; i < count; i++) {
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 14,
            vy: (Math.random() - 0.5) * 14,
            z: (Math.random() - 0.5) * 50,
            vz: (Math.random() - 0.5) * 9,
            radius: Math.random() * 5 + 2,
            color: color,
            alpha: 1,
            life: 25
        });
    }
}

function createExplosion(x, y) {
    createParticles(x, y, '#ef4444', 40);
    createParticles(x, y, '#f59e0b', 40);
    createParticles(x, y, '#ffffff', 25);
    S.screenShake = 22;
}

const p1 = new Fighter(STAGE.x + 300, STAGE.y - 100, '#06b6d4', 'Player 1');
const p2 = new AIBot(STAGE.x + 1200, STAGE.y - 100, '#f43f5e', 'AI Bot');
/** every possible fighter: p1 = this browser's player (or the host), p2 = the bot / first guest, p3..p8 = more guests in custom matches */
export const fighters = [p1, p2];
for (let i = 2; i < 8; i++) { const f = new AIBot(STAGE.x + 300 * i, STAGE.y - 100, '#9ca3af', 'Player ' + (i + 1)); f.active = false; fighters.push(f); }
fighters.forEach((f, i) => { f.slot = i; });
const isAlive = (f) => f.active && !f.out;
/** who this fighter can hurt: everyone still in the match, except teammates in team matches */
const foesOf = (f) => fighters.filter(o => o !== f && isAlive(o) && !(S.match && S.match.teams && f.team && o.team === f.team));
const nearestOf = (f, list) => list.reduce((b, o) => (!b || Math.hypot(o.x - f.x, o.y - f.y) < Math.hypot(b.x - f.x, b.y - f.y)) ? o : b, null);


// ============================================================================
//  Items (custom matches): Ball, Strawberry, Balloon, Firestick, Clock
//  Picked up and used with an AIMED GRAB (the grab dash touches the item). Balloon is used with jump.
// ============================================================================
export const items = [];
let itemSerial = 0;
const ITEM_R = { BALL: 24, STRAWBERRY: 22, BALLOON: 26, FIRESTICK: 22, CLOCK: 26 };
const CLOCK_RADIUS = 760;               // diameter 1520 = 0.4 x the ORIGINAL 3800-wide map (it does not grow with the big arena)
const CLOCK_SLOW = 0.3;
const CLOCK_ARM = 60;                   // 1 s after the throw the bubble starts
const CLOCK_LIFE = 900;                 // despawns 15 s after being thrown
const REST_LIFE = { BALL: 3600, STRAWBERRY: 1800, BALLOON: 1800, FIRESTICK: 1800, CLOCK: 1800 };
const STICK_MAX_LEN = 5;
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

function spawnItem(type) {
    // only ever above a surface: the main stage or one of the soft platforms
    const surfaces = [{ x: STAGE.x, w: STAGE.width, y: STAGE.y }, ...STAGE.platforms];
    const sf = surfaces[Math.random() * surfaces.length | 0];
    const pad = Math.min(60, sf.w * 0.15);
    const x = sf.x + pad + Math.random() * Math.max(10, sf.w - pad * 2);
    const y = sf.y - 300;
    items.push({ id: ++itemSerial, type, x, y, py: y, vx: 0, vy: 0, r: ITEM_R[type], st: 'idle', age: 0, rest: 0, owner: null, grace: 0,
        rot: 0, spin: 0, hold: -1, hitCool: 0, throws: 0, len: STICK_MAX_LEN, reductions: 0, act: false, armed: false, tT: 0, holder: null });
    fx('pickup', x, y);
}

/** 0.3 inside an active clock bubble, 1 elsewhere */
function slowAt(x, y, owner) {
    for (const it of items) {
        if (it.type !== 'CLOCK' || !it.act || Math.hypot(it.x - x, it.y - y) >= CLOCK_RADIUS) continue;
        const c = it.owner;                                          // whoever threw the clock last (catching it before it starts keeps that thrower)
        if (owner && c && (owner === c || (S.match && S.match.teams && owner.team && owner.team === c.team))) continue;   // the thrower and their team are not slowed
        return CLOCK_SLOW;
    }
    return 1;
}

function burnItem(it) {
    it.reductions++;
    it.len = STICK_MAX_LEN - 0.5 * it.reductions;
    fx('burn', it.x, it.y);
    if (it.reductions >= 6) { it.st = 'dead'; if (it.holder) { it.holder.heldItem = null; it.holder.heldId = 0; it.holder = null; } }
}
function burnStick(f) { if (f.heldItem && f.heldItem.type === 'FIRESTICK') burnItem(f.heldItem); }

function pickUp(f, it) {
    if (it.type === 'STRAWBERRY') {
        f.damage = Math.max(0, f.damage - 30);
        fx('heal', f.x, f.y); audio.playGrab(); it.st = 'dead'; return true;
    }
    if (it.type === 'BALLOON') {
        if (!f.balloon) { f.balloon = true; f.maxJumps += 3; f.jumpsLeft += 3; }          // adds 3 jumps on top of the character's own
        fx('pickup', f.x, f.y - 30); audio.playGrab(); it.st = 'dead'; return true;
    }
    if (f.heldItem) return false;
    it.st = 'held'; it.holder = f; it.hold = f.slot; it.armed = false; it.tT = 0; it.vx = it.vy = 0; it.grace = 0;
    f.heldItem = it; f.heldId = it.id;
    f.isGrabDashing = false; f.suplexPending = false; f.vx *= 0.2; f.vy *= 0.2;
    fx('pickup', it.x, it.y); audio.playGrab();
    return true;
}

function throwHeldItem(f, tx, ty) {
    const it = f.heldItem; if (!it) return false;
    let dx = tx - f.x, dy = ty - f.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    if (Math.abs(dx) > 0.15) f.facing = dx > 0 ? 1 : -1;
    const sp = it.type === 'CLOCK' ? 15 : it.type === 'FIRESTICK' ? 17 : 19;
    it.st = 'thrown'; it.holder = null; it.hold = -1; it.owner = f; it.grace = 16; it.hitCool = 0; it.rest = 0;
    it.x = f.x + dx * 40; it.y = f.y + dy * 40 - 4; it.py = it.y; it.vx = dx * sp; it.vy = dy * sp;
    it.spin = (dx >= 0 ? 1 : -1) * (it.type === 'FIRESTICK' ? 0.5 : it.type === 'BALL' ? 0.3 : 0.15);
    if (it.type === 'BALL') it.throws++;
    if (it.type === 'CLOCK') { it.armed = true; it.tT = 0; }
    f.heldItem = null; f.heldId = 0;
    f.actionLock = Math.max(f.actionLock, 18); f.throwFxT = 14;
    audio.playThrow();
    return true;
}

function releasePins(it, recharge) {
    it.hitCool = 40;
    for (const f of fighters) if (f.stuckTo === it.id) {
        f.stuckTo = 0; f.vy = Math.min(f.vy, -2);
        if (recharge) { f.jumpsLeft = f.maxJumps; f.airSpecials = 0; f.canGrab = true; }
    }
}

function landOn(it) {
    const bottom = it.y + it.r, prevBottom = it.py + it.r;
    if (it.x > STAGE.x - 6 && it.x < STAGE.x + STAGE.width + 6 && prevBottom <= STAGE.y + 4 && bottom >= STAGE.y) { it.y = STAGE.y - it.r; return true; }
    if (it.vy >= 0) for (const p of STAGE.platforms) {
        if (it.x > p.x && it.x < p.x + p.w && prevBottom <= p.y + 4 && bottom >= p.y) { it.y = p.y - it.r; return true; }
    }
    return false;
}

function updateItems() {
    const cfg = S.match && S.match.items;
    if (cfg && cfg.on && cfg.types.length && S.gameState === 'playing') {
        if (--S.itemTimer <= 0) {
            S.itemTimer = Math.max(60, cfg.interval * 60);
            if (items.filter(i => i.st !== 'held' && i.st !== 'dead').length < 4) spawnItem(cfg.types[Math.floor(Math.random() * cfg.types.length)]);
        }
    }
    for (let n = items.length - 1; n >= 0; n--) {
        const it = items[n];
        if (it.st === 'dead') { if (it.holder) { it.holder.heldItem = null; it.holder.heldId = 0; } if (it.type === 'FIRESTICK') releasePins(it, false); items.splice(n, 1); continue; }
        it.age++;
        if (it.st === 'held') {
            const h = it.holder;
            if (!h || !isAlive(h) || h.heldItem !== it) { it.st = 'idle'; it.holder = null; it.hold = -1; it.vx = 0; it.vy = 0; continue; }
            it.x = h.x + h.facing * 30; it.y = h.y - 2; it.py = it.y;
            continue;
        }
        if (it.type === 'CLOCK' && it.armed) {                       // the thrown clock: bubble after 1 s, gone after 15 s
            it.tT++;
            if (!it.act && it.tT >= CLOCK_ARM) { it.act = true; it.st = 'zone'; it.vx = 0; it.vy = 0; fx('bubble', it.x, it.y, CLOCK_RADIUS); audio.playShield(); }
            if (it.tT >= CLOCK_LIFE) { it.st = 'dead'; continue; }
        }
        if (it.st === 'zone') continue;                              // frozen where it started the bubble
        const k = it.type === 'CLOCK' ? 1 : slowAt(it.x, it.y, it.owner);
        it.py = it.y;
        if (it.grace > 0) it.grace--;
        const thrown = it.st === 'thrown';
        it.vy = Math.min(thrown ? 16 : 14, it.vy + WORLD.gravity * (thrown ? 0.55 : 1) * (it.type === 'BALL' ? 0.85 : 1) * k);
        it.x += it.vx * k; it.y += it.vy * k;
        it.rot += (thrown ? it.spin : 0) * k;
        // stage body: slide out sideways instead of tunnelling in
        if (it.y > STAGE.y + 4 && it.y < STAGE.y + STAGE.height && it.x > STAGE.x - it.r && it.x < STAGE.x + STAGE.width + it.r) {
            it.x = it.x < STAGE.x + STAGE.width / 2 ? STAGE.x - it.r : STAGE.x + STAGE.width + it.r; it.vx *= -0.5;
        }
        const landed = landOn(it);
        if (it.type === 'FIRESTICK') {
            for (const f of fighters) if (f.stuckTo === it.id) {                 // pinned fighters ride the spear
                if (!isAlive(f)) { f.stuckTo = 0; continue; }
                f.x = it.x; f.y = it.y; f.px = f.x; f.py = f.y; f.vx = f.vy = 0; f.hitstun = Math.max(f.hitstun, 2); f.grounded = false;
            }
            if (landed) releasePins(it, false);                                   // hits the ground: they come off
            else if (it.y > STAGE.y + 24 && (it.x < STAGE.x || it.x > STAGE.x + STAGE.width)) releasePins(it, true);   // fell below the stage tip: free, with the ground's recharge
        }
        if (landed) {
            if (it.type === 'BALL' && thrown) {
                it.vy = Math.abs(it.vy) > 2.5 ? -it.vy * 0.5 : 0;
                it.vx *= 0.9;
            } else { it.vy = 0; it.vx *= 0.8; }
            if (it.vy === 0) it.vx *= (it.type === 'BALL' ? 0.94 : 0.8);
        }
        if (thrown) {
            const sp = Math.hypot(it.vx, it.vy);
            if (landed && (it.type !== 'BALL' || sp < 1.4)) {          // came to rest
                it.st = it.type === 'CLOCK' && it.armed ? 'idle' : 'idle'; it.vx = 0; it.vy = 0; it.spin = 0;
                if (it.type === 'BALL' && it.throws >= 2) { it.st = 'dead'; fx('pickup', it.x, it.y); continue; }   // second throw used up: it breaks
            }
        } else if (landed || it.vy === 0) {
            if (!it.armed && ++it.rest > REST_LIFE[it.type]) { it.st = 'dead'; continue; }
        }
        if (it.x < BLAST_ZONES.left - 400 || it.x > BLAST_ZONES.right + 400 || it.y > BLAST_ZONES.bottom + 400 || it.y < BLAST_ZONES.top - 1600) it.st = 'dead';
    }
}

/** grab-dash pickups and thrown ball / firestick hits */
function itemInteractions() {
    if (!items.length) return;
    for (const f of fighters) {
        if (!isAlive(f) || !f.isGrabDashing || f.suplexPending) continue;
        for (const it of items) {
            if ((it.st !== 'idle' && it.st !== 'thrown') || (it.st === 'thrown' && (it.type !== 'BALL' || (it.owner === f && it.grace > 0)))) continue;
            if (Math.hypot(it.x - f.x, it.y - f.y) < 72 + it.r) { if (pickUp(f, it)) break; }
        }
    }
    for (const it of items) {
        if (it.st !== 'thrown' || (it.type !== 'BALL' && it.type !== 'FIRESTICK')) continue;
        if (it.hitCool > 0) { it.hitCool--; continue; }
        const speed = Math.hypot(it.vx, it.vy);
        if (it.type === 'BALL' && speed < 2.5) continue;
        const R = it.type === 'FIRESTICK' ? 26 + 14 * it.len : it.r;
        for (const f of fighters) {
            if (!isAlive(f)) continue;
            if (it.owner && f === it.owner && it.grace > 0) continue;
            if (it.owner && f !== it.owner && S.match && S.match.teams && f.team && f.team === it.owner.team) continue;
            const hb = f.activeHitbox;
            if (it.type === 'BALL' && hb && !(it.owner === f)) {                      // the ball counters every attack except a grab
                if (Math.abs(hb.x - it.x) < hb.w / 2 + it.r && Math.abs(hb.y - it.y) < hb.h / 2 + it.r) {
                    f.activeHitbox = null; f.swingHit = true;
                    audio.playHit(true); fx('counter', it.x, it.y);
                    counterStun(f, it);
                    it.vx = (it.vx >= 0 ? -1 : 1) * Math.max(4, Math.abs(it.vx) * 0.6); it.vy = -5; it.hitCool = 10; it.grace = 0;
                    break;
                }
            }
            if (f.invincibleTimer > 0) continue;
            const cx = clampN(it.x, f.x - f.width / 2, f.x + f.width / 2), cy = clampN(it.y, f.y - f.height / 2, f.y + f.height / 2);
            if (Math.hypot(it.x - cx, it.y - cy) > R) continue;
            if (it.type === 'BALL' && f.isGrabDashing && f !== it.owner) { pickUp(f, it); break; }   // grabbing the ball catches it
            const dirx = it.vx >= 0 ? 1 : -1;
            if (f.isShielding) {
                audio.playShield(); f.shieldHealth = Math.max(0, f.shieldHealth - 10); fx('block', it.x, it.y);
            } else if (it.type === 'FIRESTICK') {                                      // thrown like a spear: pins whoever it hits and carries them
                if (f.stuckTo === it.id) continue;
                f.interrupt(); f.damage += 15; f.lastHitBy = it.owner || f; f.lastHitT = 0;
                f.stuckTo = it.id; f.vx = f.vy = 0; f.hitstun = Math.max(f.hitstun, 3);
                S.screenShake = Math.max(S.screenShake, 12); audio.playHit(true); fx('hit', f.x, f.y, 15, dirx > 0 ? -0.2 : Math.PI + 0.2);
                burnItem(it);
                continue;                                                              // keeps flying (no bounce back), may pin others too
            } else {
                launch(it.owner || f, f, { damage: 10, bkb: 8, kbg: 0.9, angle: dirx > 0 ? -0.5 : Math.PI + 0.5 });
            }
            it.vx = -dirx * Math.max(4, Math.abs(it.vx) * 0.6); it.vy = -6; it.hitCool = 14; it.grace = 0;      // bounces back
            break;
        }
    }
}

/** timer matches: most kills wins (fewest deaths breaks a tie) */
function finishTimer() {
    if (!S.match || S.gameState !== 'playing') return;
    const live = fighters.filter(f => f.active);
    const keyOf = (f) => S.match.teams && f.team ? 't:' + f.team : 'p:' + f.slot;
    const score = new Map(), deaths = new Map(), members = new Map();
    for (const f of live) {
        const k = keyOf(f);
        score.set(k, (score.get(k) || 0) + f.kills); deaths.set(k, (deaths.get(k) || 0) + f.deaths);
        if (!members.has(k)) members.set(k, []);
        members.get(k).push(f);
    }
    let best = -Infinity, bestD = Infinity, winners = [];
    for (const [k, sc] of score) {
        const d = deaths.get(k);
        if (sc > best || (sc === best && d < bestD)) { best = sc; bestD = d; winners = [k]; }
        else if (sc === best && d === bestD) winners.push(k);
    }
    const wf = winners.flatMap(k => members.get(k) || []);
    S.winnerSlots = wf.map(f => f.slot);
    const draw = winners.length > 1;
    const w = wf[0];
    S.winnerLabel = draw ? 'DRAW' : (S.match.teams && w.team ? `${TEAM_NAMES[w.team]} TEAM` : String(w.name).toUpperCase());
    S.iWon = !draw && S.winnerSlots.includes(S.mySlot || 0);
    triggerDramaticZoom(w || p1);
    endGame(draw ? 'DRAW!' : (S.iWon ? 'YOU WIN!' : `${S.winnerLabel} WINS!`), 'lobby');
}

// ============================================================================
//  Combat resolution
// ============================================================================
/** the attacker's move was stopped (shield / counter / clash): effects + punishment */
function counterStun(attacker, defender) {
    attacker.interrupt();
    attacker.clashStunTimer = STUN;                         // 0.5 s
    attacker.vx = (attacker.x < defender.x ? -1 : 1) * 5;
    attacker.vy = -4;
}

function handleBlocked(res, attacker, defender) {
    if (res === 'shield') {
        audio.playShield();
        defender.shieldHealth = Math.max(0, defender.shieldHealth - 10);
        createParticles(defender.x, defender.y, '#22d3ee', 10);
        fx('block', defender.x, defender.y);
        counterStun(attacker, defender);
    } else if (res === 'countered') {
        audio.playHit(true);
        S.screenShake = Math.max(S.screenShake, 10);
        createParticles(defender.x, defender.y, '#f472b6', 14);
        fx('counter', defender.x, defender.y);
        counterStun(attacker, defender);
    } else {                                                // clash: both moves cancel
        audio.playShield();
        const mx = (attacker.x + defender.x) / 2, my = (attacker.y + defender.y) / 2;
        createParticles(mx, my, '#e0f2fe', 14);
        fx('block', mx, my);
        const d = attacker.x < defender.x ? -1 : 1;
        attacker.activeHitbox = null; defender.activeHitbox = null;
        attacker.swingHit = true; defender.swingHit = true;
        attacker.vx = d * 6; defender.vx = -d * 6;
    }
}

/** speed of a grab throw: 0.7x the knockback of a side melee hit at the victim's current percent */
function grabThrowSpeed(victim) {
    const m = SWING.SIDE_RIGHT;
    const eff = victim.damage / 2;
    const force = ((eff / 10) + (eff * m.damage / 20)) * m.kbg + m.bkb;
    return force * 0.85 * GRAB_KB_SCALE * charOf(victim.char).kb;
}

/** apply damage + knockback / stun for a landed hit */
/** hitting someone with a melee while holding a balloon pops it: they get a floaty 2 s (0.65x gravity) */
function balloonPop(attacker, defender, hb) {
    if (!attacker.balloon || (hb.type && hb.type !== 'J')) return;
    attacker.balloon = false; attacker.maxJumps = charOf(attacker.char).jumps; attacker.jumpsLeft = Math.min(attacker.jumpsLeft, attacker.maxJumps);
    defender.gravT = 120;
    fx('burn', attacker.x, attacker.y - 40); audio.playHit(false);
}

function launch(attacker, defender, hb) {
    if (hb.radial || hb.mirror) {                           // area hits push away from their centre / mirror to the victim's side
        hb = { ...hb };
        if (hb.radial) hb.angle = Math.atan2(defender.y - hb.y - 20, (defender.x - hb.x) || 1);
        else if (defender.x < hb.x) hb.angle = Math.PI - hb.angle;
    }
    if (defender.armorT > 0 && !hb.stun) {                  // armour: it hurts, but no flinch and no knockback
        defender.damage += hb.damage; defender.lastHitBy = attacker; defender.lastHitT = 0;
        if (defender.heldItem && defender.heldItem.type === 'FIRESTICK') burnStick(defender);
        S.screenShake = Math.max(S.screenShake, 6); audio.playHit(false);
        createParticles(defender.x, defender.y, '#e2e8f0', 8); fx('block', defender.x, defender.y);
        return;
    }
    defender.interrupt();
    defender.damage += hb.damage;
    defender.lastHitBy = attacker; defender.lastHitT = 0;
    if (defender.heldItem && defender.heldItem.type === 'FIRESTICK') burnStick(defender);      // getting hit shortens the firestick

    if (defender.isAI && defender.level === 'hard') {
        defender.incomingHitCount++;
        if (!hb.stun && defender.grounded && defender.incomingHitCount >= 3 && defender.rollCooldown <= 0) {
            defender.incomingHitCount = 0;
            const away = Math.sign(defender.x - attacker.x) || 1;
            if (defender.executeRoll(true, away)) {            // the bot slips out of the combo with a roll
                audio.playHit(false);
                fx('hit', defender.x, defender.y, 8, hb.angle);
                return;
            }
        }
    } else if (!defender.isAI) {
        attacker.incomingHitCount = 0;
    }

    if (hb.stun) {                                          // headbutt: freeze them for 0.5 s, no launch
        defender.clashStunTimer = hb.stun;
        defender.vx = 0;
        defender.vy = 0;
        S.screenShake = Math.max(S.screenShake, 14);
        audio.playHit(true);
        createParticles(defender.x, defender.y, '#a78bfa', 18);
        fx('hit', defender.x, defender.y, 14, hb.angle);
        return;
    }

    if (hb.pull) {                                          // Whirlpool / Bubble: drag them toward the centre
        const px = hb.px !== undefined ? hb.px : hb.x, py = hb.py !== undefined ? hb.py : hb.y;
        const dx = px - defender.x, dy = py - defender.y, d = Math.hypot(dx, dy) || 1;
        defender.vx = dx / d * hb.pull; defender.vy = dy / d * hb.pull - 1;
        defender.hitstun = 22; defender.grounded = false;
        S.screenShake = Math.max(S.screenShake, 6); audio.playHit(false);
        createParticles(defender.x, defender.y, '#7dd3fc', 10); fx('hit', defender.x, defender.y, 6, hb.angle);
        return;
    }

    if (hb.fixed) {                                         // Spiral's chained hits keep the victim in the whirlwind
        defender.vx = hb.fixed.vx;
        defender.vy = hb.fixed.vy;
        defender.hitstun = hb.fixed.hitstun;
        defender.grounded = false;
        S.screenShake = Math.max(S.screenShake, 5);
        audio.playHit(false);
        createParticles(defender.x, defender.y, '#c4b5fd', 8);
        fx('hit', defender.x, defender.y, 8, hb.angle);
        return;
    }

    const effectiveDamage = defender.damage / 2;
    const percentFactor = (effectiveDamage / 10) + (effectiveDamage * hb.damage / 20);
    const kbForce = ((percentFactor * hb.kbg) + hb.bkb) * charOf(defender.char).kb;      // slow characters take less, fast ones more

    defender.vx = Math.cos(hb.angle) * kbForce * 0.85;
    defender.vy = Math.sin(hb.angle) * kbForce * 0.85;
    defender.hitstun = 60;
    defender.grounded = false;

    S.screenShake = Math.min(25, Math.floor(kbForce));
    audio.playHit(kbForce > 18);
    createParticles(defender.x, defender.y, '#f59e0b', Math.floor(kbForce));
    fx('hit', defender.x, defender.y, kbForce, hb.angle);
}

function explodeOrb(o) {
    const R = o.R !== undefined ? o.R : 80 + 90 * o.charge;
    const dmg = o.d !== undefined ? o.d : 4 + 16 * o.charge;          // Luminent: min 4, max 20; every character has its own numbers
    fx('explosion', o.x, o.y, R, o.charge);
    S.screenShake = Math.max(S.screenShake, 8 + 10 * o.charge);
    audio.playHit(o.charge > 0.5);
    createParticles(o.x, o.y, o.color, 18 + Math.floor(24 * o.charge));
    createParticles(o.x, o.y, '#ffffff', 10);

    for (const t of foesOf(o.owner)) {
        if (t.invincibleTimer > 0 || t.stocks <= 0) continue;
        const cx = Math.max(t.x - t.width / 2, Math.min(o.x, t.x + t.width / 2));
        const cy = Math.max(t.y - t.height / 2, Math.min(o.y, t.y + t.height / 2));
        if (Math.hypot(o.x - cx, o.y - cy) > R) continue;

        const res = interaction('CORE', t);
        if (res === 'hit') {
            launch(o.owner, t, {
                damage: dmg, bkb: o.bkb !== undefined ? o.bkb : (10 + 8 * o.charge) / 2, kbg: o.kbg !== undefined ? o.kbg : 1.1 / 2,      // half the knockback
                angle: Math.atan2(t.y - o.y - 25, (t.x - o.x) || o.vx), x: o.x, y: o.y, pull: o.pull || 0,
            });
        } else if (res === 'shield') {
            audio.playShield();
            t.shieldHealth = Math.max(0, t.shieldHealth - 10);
            fx('block', t.x, t.y);
        } else {
            fx('counter', t.x, t.y);
        }
    }
}

function updateOrbs() {
    for (let i = orbs.length - 1; i >= 0; i--) {
        const o = orbs[i];
        const ok = slowAt(o.x, o.y, o.owner);
        o.age = (o.age || 0) + 1;
        if (o.curve) {                                            // Void Orb bends toward the nearest foe
            const foe = nearestOf(o, foesOf(o.owner).filter(isAlive));
            if (foe) {
                const sp = Math.hypot(o.vx, o.vy), cur = Math.atan2(o.vy, o.vx);
                let da = Math.atan2(foe.y - o.y, foe.x - o.x) - cur; da = Math.atan2(Math.sin(da), Math.cos(da));
                const a = cur + Math.max(-o.curve, Math.min(o.curve, da)) * ok;
                o.vx = Math.cos(a) * sp; o.vy = Math.sin(a) * sp;
            }
        }
        if (o.grav) o.vy += o.grav * ok;
        if (o.wobble) o.y += Math.sin(o.age * 0.22) * o.wobble * 0.35 * ok;
        o.x += o.vx * ok;
        o.y += o.vy * ok;
        o.life -= ok;

        if (o.x < -600 || o.x > WORLD.width + 600 || o.y < -600 || o.y > WORLD.height + 600) { orbs.splice(i, 1); continue; }

        const sr = o.r * 0.35;          // the stage only stops the orb's core, so big orbs can skim along the floor
        if (!o.flat && o.x + sr > STAGE.x && o.x - sr < STAGE.x + STAGE.width && o.y + sr > STAGE.y && o.y - sr < STAGE.y + STAGE.height) {
            orbs.splice(i, 1);
            explodeOrb(o);
            continue;
        }

        let hitOrb = false;
        for (const t of foesOf(o.owner)) {
            if (t.invincibleTimer > 0 || t.stocks <= 0) continue;
            const cx = Math.max(t.x - t.width / 2, Math.min(o.x, t.x + t.width / 2));
            const cy = Math.max(t.y - t.height / 2, Math.min(o.y, t.y + t.height / 2));
            if (Math.hypot(o.x - cx, o.y - cy) < o.r) {
                orbs.splice(i, 1);
                const res = interaction('CORE', t);
                if (res === 'hit') explodeOrb(o);
                else if (res === 'shield') {
                    audio.playShield();
                    t.shieldHealth = Math.max(0, t.shieldHealth - 10);
                    createParticles(o.x, o.y, '#22d3ee', 10);
                    fx('block', o.x, o.y);
                } else {
                    createParticles(o.x, o.y, '#f472b6', 10);
                    fx('counter', o.x, o.y);
                }
                hitOrb = true;
                break;
            }
        }
        if (hitOrb) continue;

        if (o.life <= 0) { orbs.splice(i, 1); explodeOrb(o); }
    }
}

function checkCombatCollisions(attacker, defender) {
    const isMutualGrab = (
        (attacker.isGrabDashing && defender.isGrabDashing) ||
        (attacker.isGrabDashing && defender.grabHolding !== null) ||
        (defender.isGrabDashing && attacker.grabHolding !== null)
    );

    if (isMutualGrab) {
        const colliding = (
            attacker.x - attacker.width/2 < defender.x + defender.width/2 &&
            attacker.x + attacker.width/2 > defender.x - defender.width/2 &&
            attacker.y - attacker.height/2 < defender.y + defender.height/2 &&
            attacker.y + attacker.height/2 > defender.y - defender.height/2
        );

        if (colliding || Math.hypot(attacker.x - defender.x, attacker.y - defender.y) < 70) {
            attacker.vx = 0;
            attacker.vy = 0;
            defender.vx = 0;
            defender.vy = 0;

            attacker.clashStunTimer = 120;
            defender.clashStunTimer = 120;

            attacker.isGrabDashing = false;
            defender.isGrabDashing = false;
            attacker.grabHolding = null;
            defender.grabHolding = null;
            attacker.grabbedBy = null;
            defender.grabbedBy = null;
            attacker.isRolling = false;
            defender.isRolling = false;

            const clashX = (attacker.x + defender.x) / 2;
            const clashY = (attacker.y + defender.y) / 2;

            shockwaves.push({
                x: clashX,
                y: clashY,
                radius: 10,
                maxRadius: STAGE.width * 1.15,
                expansionSpeed: 6.5,
                alpha: 1.0,
                color: '#38bdf8'
            });

            audio.playHit(true);
            S.screenShake = 18;
            createParticles(clashX, clashY, '#38bdf8', 35);
            createParticles(clashX, clashY, '#ffffff', 20);
            fx('clash', clashX, clashY);
            return;
        }
    }

    // ---- grab: beats a shield, loses to every other active move (except headbutt)
    if (attacker.isGrabDashing && !attacker.grabHolding && defender.invincibleTimer <= 0) {
        const dx = defender.x - attacker.x;
        const dy = defender.y - attacker.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const enlargedGrabHitboxRadius = 72;

        if (dist < enlargedGrabHitboxRadius) {
            const res = interaction('GRAB', defender);
            if (res !== 'hit') {
                attacker.isGrabDashing = false;
                handleBlocked(res, attacker, defender);
                return;
            }

            if (attacker.suplexPending) {                     // Down-F on the ground: carry them up and suplex
                attacker.beginSuplex(defender);
                createParticles(defender.x, defender.y, '#ef4444', 20);
                return;
            }

            defender.interrupt();
            defender.isShielding = false;
            attacker.isGrabDashing = false;
            attacker.grabHolding = defender;
            attacker.grabTimer = 90;
            defender.grabbedBy = attacker;
            defender.hitstun = 90;

            audio.playGrab();
            createParticles(defender.x, defender.y, '#ef4444', 20);
            fx('grab', defender.x, defender.y);
            return;
        }
    }

    // ---- swings, headbutt, spiral
    if (!attacker.activeHitbox || defender.invincibleTimer > 0) return;

    const hb = attacker.activeHitbox;
    const defLeft = defender.x - defender.width / 2;
    const defRight = defender.x + defender.width / 2;
    const defTop = defender.y - defender.height / 2;
    const defBottom = defender.y + defender.height / 2;

    const hbLeft = hb.x - hb.w / 2;
    const hbRight = hb.x + hb.w / 2;
    const hbTop = hb.y - hb.h / 2;
    const hbBottom = hb.y + hb.h / 2;

    if (hbLeft < defRight && hbRight > defLeft && hbTop < defBottom && hbBottom > defTop) {
        const res = interaction(hb.type || 'J', defender);
        if (hb.multi) {                                      // sword spin: hits everyone around you once, the swing carries on
            const set = attacker.swingHitSet || (attacker.swingHitSet = new Set());
            if (set.has(defender)) return;
            set.add(defender);
            if (res !== 'hit') { handleBlocked(res, attacker, defender); return; }
            launch(attacker, defender, hb);
            balloonPop(attacker, defender, hb);
            if (hb.fire) burnStick(attacker);
            return;
        }
        attacker.activeHitbox = null;
        attacker.swingHit = true;
        if (res !== 'hit') {
            handleBlocked(res, attacker, defender);
            return;
        }
        launch(attacker, defender, hb);
        balloonPop(attacker, defender, hb);
        if (hb.fire) burnStick(attacker);
    }
}

let fBadge = null;
let rosterKey = '';
function renderRoster() {
    let el = document.getElementById('rosterHud');
    if (!el) {
        el = document.createElement('div'); el.id = 'rosterHud';
        el.style.cssText = 'position:fixed;right:12px;top:64px;z-index:12;display:flex;flex-direction:column;gap:4px;pointer-events:none;font:700 12px system-ui,sans-serif;color:#e2e8f0';
        document.body.appendChild(el);
    }
    let tm = document.getElementById('matchTimer');
    if (!tm) {
        tm = document.createElement('div'); tm.id = 'matchTimer';
        tm.style.cssText = 'position:fixed;left:50%;top:44px;transform:translateX(-50%);z-index:13;pointer-events:none;font:800 22px system-ui,sans-serif;letter-spacing:.08em;color:#e2e8f0;background:rgba(8,12,24,.72);border:1px solid rgba(148,163,184,.35);padding:2px 14px;border-radius:12px;display:none';
        document.body.appendChild(tm);
    }
    const lbl = document.getElementById('aiDiffLabel');
    const aiPanel = lbl && lbl.closest('.glass-panel');
    if (aiPanel) { const v = S.match ? 'hidden' : ''; if (aiPanel.style.visibility !== v) aiPanel.style.visibility = v; }
    if (!S.match || S.gameState === 'start') { if (el.style.display !== 'none') el.style.display = 'none'; tm.style.display = 'none'; return; }
    el.style.display = 'flex';
    const timer = S.match.mode === 'timer';
    if (timer) {
        const sec = Math.max(0, Math.ceil((S.timeLeft || 0) / 60));
        const txt = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
        tm.style.display = 'block';
        if (tm.textContent !== txt) tm.textContent = txt;
        tm.style.color = sec <= 10 ? '#fb7185' : '#e2e8f0';
    } else tm.style.display = 'none';
    const rows = fighters.filter(f => f.active).map(f => {
        const pips = timer ? 'K ' + f.kills : (f.out ? 'OUT' : '●'.repeat(Math.max(0, f.stocks)));
        const nm = String(f.name).replace(/[<>&"]/g, '');
        return `<div style="display:flex;gap:8px;align-items:center;background:rgba(8,12,24,.72);border-left:4px solid ${f.color};padding:4px 8px;border-radius:8px;min-width:190px;opacity:${f.out ? .45 : 1}${f.slot === (S.mySlot || 0) ? ';outline:1px solid #fff6' : ''}"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nm}</span><span style="color:${f.damage > 120 ? '#fb7185' : f.damage > 60 ? '#fbbf24' : '#fff'}">${Math.floor(f.damage)}%</span><span style="color:${f.color};letter-spacing:1px">${pips}</span></div>`;
    }).join('');
    if (rows !== rosterKey) { rosterKey = rows; el.innerHTML = rows; }
}

// HUD writes are cached: touching the DOM every frame was a source of lag
const hudCache = {};
function hudText(id, v) { const k = 't' + id; if (hudCache[k] !== v) { hudCache[k] = v; document.getElementById(id).textContent = v; } }
function hudClass(id, v) { const k = 'c' + id; if (hudCache[k] !== v) { hudCache[k] = v; document.getElementById(id).className = v; } }
const dmgClass = (d) => d > 120 ? 'smash-font text-5xl font-bold tracking-tight text-rose-500 pulse-glow-red leading-none' : d > 60 ? 'smash-font text-5xl font-bold tracking-tight text-amber-400 leading-none' : 'smash-font text-5xl font-bold tracking-tight text-white leading-none';
function hudPips(id, n, cls) {
    const key = 'p' + id + ':' + n;
    if (hudCache['k' + id] === key) return;
    hudCache['k' + id] = key;
    const box = document.getElementById(id);
    box.innerHTML = Array.from({ length: n }, () => `<div class="${cls}"></div>`).join('');
}

function renderHUD() {
    const me = S.match ? (fighters[S.mySlot || 0] || p1) : p1;
    renderRoster();
    hudText('p1Damage', String(Math.floor(me.damage)));
    hudClass('p1Damage', dmgClass(me.damage));
    hudPips('p1Stocks', Math.max(0, me.stocks), 'w-3.5 h-3.5 rounded-full bg-cyan-400 border border-cyan-200 shadow-md shadow-cyan-500/50');

    // F-special status: charge meter while charging, otherwise how many air F moves are left
    const fAnchor = document.querySelector('#p1DashBadge, #p1FAnchor');
    if (!fBadge && fAnchor) {
        fBadge = document.createElement('span');
        fBadge.id = 'p1FBadge';
        fBadge.style.marginLeft = '6px';
        fAnchor.insertAdjacentElement('afterend', fBadge);
        fBadge.style.whiteSpace = 'nowrap';
    }
    if (fBadge) {
        let cls, txt, col;
        if (me.charging) { col = '#ddd6fe'; cls = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-950 text-violet-300 border border-violet-500/60'; txt = `CORE ${Math.min(100, Math.round(me.chargeFrames / CHARGE_MAX * 100))}%`; }
        else if (!me.grounded && me.airSpecials >= AIR_F_MAX) { col = '#64748b'; cls = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900 text-slate-500 border border-slate-700'; txt = 'AIR F: 0 LEFT'; }
        else { col = '#c4b5fd'; cls = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-950 text-violet-300 border border-violet-500/40'; txt = `AIR F: ${AIR_F_MAX - me.airSpecials}/${AIR_F_MAX}`; }
        const key = cls + txt + col;
        if (hudCache.fb !== key) { hudCache.fb = key; fBadge.className = cls; fBadge.textContent = txt; fBadge.style.color = col; }
    }

    const jk = 'j' + me.maxJumps + ':' + me.jumpsLeft;
    if (hudCache.jk !== jk) {
        hudCache.jk = jk;
        document.getElementById('p1JumpDots').innerHTML = Array.from({ length: me.maxJumps }, (_, i) => `<div class="w-2.5 h-2.5 rounded-full ${i < me.jumpsLeft ? 'bg-cyan-400' : 'bg-slate-700'}"></div>`).join('');
    }

    hudText('p2Damage', String(Math.floor(p2.damage)));
    hudClass('p2Damage', dmgClass(p2.damage));
    hudPips('p2Stocks', Math.max(0, S.gameMode === 'training' ? 3 : p2.stocks), 'w-3.5 h-3.5 rounded-full bg-rose-500 border border-rose-300 shadow-md shadow-rose-500/50');
}

function triggerDramaticZoom(winnerCharacter) {
    dramaticZoom.active = true;
    dramaticZoom.targetX = winnerCharacter.x;
    dramaticZoom.targetY = winnerCharacter.y;
    dramaticZoom.currentZoom = 1;
    dramaticZoom.progress = 0;
}

const TEAM_COLORS = { red: '#ef4444', blue: '#3b82f6', yellow: '#facc15', green: '#22c55e' };
const FFA_COLORS = ['#06b6d4', '#f43f5e', '#a3e635', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];
/** cfg (custom match): { players: [{slot, name, team}], teams: bool, startDamage, stocks, mySlot } */
function startMatchSequence(mode, cfg) {
    S.gameMode = mode;
    if (mode === 'lobby' && cfg) {
        const ic = cfg.items || {};
        const lim = clampN(+cfg.timeLimit || 5, 1, 10);
        S.match = {
            teams: !!cfg.teams, startDamage: clampN(+cfg.startDamage || 0, 0, 249), stocks: cfg.stocks || 3,
            mode: cfg.mode === 'timer' ? 'timer' : 'stock', timeLimit: lim,
            items: ic.on ? { on: true, types: (ic.types || []).filter(t => ITEM_TYPES.includes(t)), interval: clampN(+ic.interval || 15, 5, 60) } : { on: false, types: [], interval: 15 },
        };
        S.timeLeft = Math.round(lim * 3600);
        S.itemTimer = Math.round(S.match.items.interval * 30);
        S.mySlot = cfg.mySlot || 0;
        S.matchCfg = cfg;
        setArena(cfg.map === 'frontier' ? 'normal' : 'lobby');
    } else {
        S.match = null; S.mySlot = 0; S.matchCfg = null;
        if (S.arena !== 'normal') setArena('normal');
        for (let i = 2; i < fighters.length; i++) fighters[i].active = false;
        p1.active = p2.active = true; p1.team = p2.team = null; p1.out = p2.out = false; p2.diff = null; p2.isAI = true;
        for (const f of [p1, p2]) { f.startX = f.home.x; f.startY = f.home.y; f.color = f.home.color; f.name = f.home.name; }
    }
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverModal').classList.add('hidden');
    dramaticZoom.active = false;
    orbs.length = 0;
    items.length = 0; guestItems.clear(); inputBuf.a = null;

    if (S.match) {
        const n = cfg.players.length, span = STAGE.width * 0.7;
        fighters.forEach((f) => { f.active = false; f.out = false; f.team = null; });
        cfg.players.forEach((pl, i) => {
            // the local player is always drawn as p1 (slot 0 locally): swap slot 0 and my slot
            const f = fighters[pl.slot];
            f.char = charOf(pl.char).id; f.active = true; f.name = pl.name; f.team = S.match.teams ? pl.team : null; f.isAI = !!pl.bot; f.diff = pl.bot || null; f.shieldHold = 0;
            f.color = S.match.teams && pl.team ? TEAM_COLORS[pl.team] : FFA_COLORS[pl.slot % 8];
            f.superColor = null;
            f.startX = STAGE.x + STAGE.width * 0.15 + (n > 1 ? span * i / (n - 1) : span / 2);
            f.startY = STAGE.y - 120;
            f.reset(true); f.shieldHold = 0; f.remoteAim = null;
        });
    } else {
    p1.char = getMyChar();
    p2.char = S.online === 'host' ? (S.peerChar || DEFAULT_CHAR) : S.online === 'guest' ? DEFAULT_CHAR : getMyChar();   // bots wear the character you have equipped
    p1.reset(true);
    p2.reset(true);
    p2.shieldHold = 0;
    p2.isAI = !S.online;                                   // online: p2 is a person
    }
    p2.remoteAim = null;
    S.winnerRole = null;
    remote.helds = {};
    resetSnapshotState();
    for (const [, g] of guestOrbs) { const i = orbs.indexOf(g); if (i >= 0) orbs.splice(i, 1); }
    guestOrbs.clear();
    for (const f of fighters) { f._tx = undefined; f._ty = undefined; }

    const modeLabel = document.getElementById('modeDisplayLabel');
    const aiDiffLabel = document.getElementById('aiDiffLabel');
    const aiDescText = document.getElementById('aiDescText');

    if (S.gameMode === 'lobby') {
        modeLabel.textContent = S.match.teams ? 'CUSTOM MATCH • TEAMS' : 'CUSTOM MATCH • FREE FOR ALL';
        document.getElementById('trainingControlPanel').classList.add('hidden');
        document.getElementById('openTrainingPanelBtn').classList.add('hidden');
    } else if (S.gameMode === 'easy') {
        modeLabel.textContent = "MODE: EASY";
        aiDiffLabel.textContent = "Easy Bot";
        aiDescText.textContent = "Slower movement, passive attacks & defensive shield";
        document.getElementById('trainingControlPanel').classList.add('hidden');
        document.getElementById('openTrainingPanelBtn').classList.add('hidden');
    } else if (S.gameMode === 'medium') {
        modeLabel.textContent = "MODE: MEDIUM";
        aiDiffLabel.textContent = "Medium Bot";
        aiDescText.textContent = "Uses every move, but reacts slower and doesn't learn your habits";
        document.getElementById('trainingControlPanel').classList.add('hidden');
        document.getElementById('openTrainingPanelBtn').classList.add('hidden');
    } else if (S.gameMode === 'hard') {
        modeLabel.textContent = "MODE: HARD"
        aiDiffLabel.textContent = "Hard Bot";
        aiDescText.textContent = "Learns your habits • Core zoning • Ledge Guard & Counter-Rolls";
        document.getElementById('trainingControlPanel').classList.add('hidden');
        document.getElementById('openTrainingPanelBtn').classList.add('hidden');
    } else if (S.gameMode === 'online') {
        modeLabel.textContent = "MODE: ONLINE 1v1";
        aiDiffLabel.textContent = S.opponentName || 'Opponent';
        aiDescText.textContent = S.online === 'host' ? 'You are hosting: you are the blue fighter' : 'Connected to the host: you are the blue fighter';
        document.getElementById('trainingControlPanel').classList.add('hidden');
        document.getElementById('openTrainingPanelBtn').classList.add('hidden');
    } else if (S.gameMode === 'training') {
        modeLabel.textContent = "MODE: TRAINING";
        aiDiffLabel.textContent = "Training Dummy";
        aiDescText.textContent = "Stationary practice dummy with infinite stocks";
        document.getElementById('trainingControlPanel').classList.remove('hidden');
        document.getElementById('openTrainingPanelBtn').classList.add('hidden');
    }

    document.getElementById('gameHud').classList.remove('hidden');
    document.getElementById('aimMatrixHud').classList.remove('hidden');
    document.getElementById('inGameMenuContainer').classList.remove('hidden');

    S.gameState = 'countdown';
    const countdownScreen = document.getElementById('countdownScreen');
    const countdownText = document.getElementById('countdownText');
    countdownScreen.classList.remove('hidden');

    let count = 3;
    countdownText.textContent = count;

    const countdownInterval = setInterval(() => {
        count--;
        if (count > 0) {
            countdownText.textContent = count;
        } else if (count === 0) {
            countdownText.textContent = 'GO!';
        } else {
            clearInterval(countdownInterval);
            countdownScreen.classList.add('hidden');
            S.gameState = 'playing';
        }
    }, 1000);
}

const gameOverModal = document.getElementById('gameOverModal');
function endGame(winnerText, winnerRole = null) {
    S.gameState = 'gameover';
    S.winnerRole = winnerRole;
    document.getElementById('winnerText').textContent = winnerText;
    setTimeout(() => {
        gameOverModal.classList.remove('hidden');
    }, 800);
}

// ---------------------------------------------------------------------------
//  Fixed-timestep simulation (60 Hz)
// ---------------------------------------------------------------------------


const TEAM_NAMES = { red: 'RED', blue: 'BLUE', yellow: 'YELLOW', green: 'GREEN' };
/** custom match: the match ends when only one team (or one fighter, in a free-for-all) is still standing */
function checkMatchEnd() {
    if (!S.match || S.gameState !== 'playing') return;
    const live = fighters.filter(isAlive);
    const keyOf = (f) => S.match.teams && f.team ? 't:' + f.team : 'p:' + f.slot;
    if (new Set(live.map(keyOf)).size > 1) return;
    S.winnerSlots = live.map(f => f.slot);
    const w = live[0];
    S.winnerLabel = !w ? 'NOBODY' : (S.match.teams && w.team ? `${TEAM_NAMES[w.team]} TEAM` : String(w.name).toUpperCase());
    S.iWon = S.winnerSlots.includes(S.mySlot || 0);
    triggerDramaticZoom(w || p1);
    endGame(S.iWon ? 'YOU WIN!' : `${S.winnerLabel} WINS!`, 'lobby');
}

/** bots accelerate by themselves; give them their character's walk speed too */
function aiWalk(f) {
    const w = charOf(f.char).walk;
    if (w !== 1 && f.hitstun === 0 && f.grounded && !f.isShielding) f.vx *= 1 + (w - 1) * 0.12;
}

/** walking / shielding for one fighter from a held-input state ({left,right,shield,drop}) */
function drive(f, h) {
    const free = f.hitstun === 0 && f.dizzyTimer === 0 && f.clashStunTimer === 0 && !f.grabHolding &&
        !f.isRolling && f.freezeTimer === 0;
    if (free) {
        // you can always walk (even during the 0.7 s move lock) - except while diving
        const meleeCharging = f.attackHeld && f.attackTimer > 0;     // charging a melee: movement input is ignored (momentum carries on)
        const swinging = f.attackTimer > 0 && f.swing;                // the side you swing toward stays the side you swing toward
        if (!f.diving && !meleeCharging && !f.sx) {
            const spd = (f.fActive ? 6.75 : (f.spiralT > 0 ? 4.5 : 8.5)) * charOf(f.char).walk;   // charging a core: 1.5x the old 4.5
            if (h.left) { if (f.isHanging) f.isHanging = false; f.vx = -spd; if (!swinging) f.facing = -1; }
            if (h.right) { if (f.isHanging) f.isHanging = false; f.vx = spd; if (!swinging) f.facing = 1; }
        }
        f.isShielding = !!h.shield && f.canShield();
        if (h.drop) f.dropT = 12;
    } else {
        f.isShielding = false;
    }
}

// ============================================================================
//  Online play (host-authoritative). The host runs the whole simulation: its own
//  fighter is p1, the guest's fighter is p2 steered by `remote`. The guest runs no
//  simulation: it sends inputs and mirrors the host's snapshots, with itself as p1.
// ============================================================================
let netTick = 0;
const NOHELD = { left: false, right: false, shield: false, drop: false };
export const remote = { helds: {} };              // slot -> held inputs of each guest

/** an input event from the guest, applied to their fighter (host only) */
export function removeFighter(slot) {
    const f = fighters[slot];
    if (!f || !f.active || !S.match) return;
    f.dropHeld();
    f.out = true; f.stocks = 0; f.vx = f.vy = 0;
    checkMatchEnd();
}
export function applyRemote(ev, slot = 1) {
    if (S.online !== 'host') return;
    const f = fighters[slot];
    if (!f || !f.active) return;
    if (ev.t === 'held') { remote.helds[slot] = { left: !!ev.left, right: !!ev.right, shield: !!ev.shield, drop: !!ev.drop }; }
    if (ev.wx !== undefined) f.remoteAim = { x: ev.wx, y: ev.wy };
    if (ev.t !== 'act' || S.gameState !== 'playing' || f.out) return;
    if (!(remote.helds[slot] && remote.helds[slot].shield)) f.isShielding = false;   // shield was released before this action
    switch (ev.a) {
        case 'jump': f.jump(); break;
        case 'attack': f.attack(ev.dir, !!ev.hold); break;
        case 'attackUp': f.releaseAttack(); break;
        case 'grab': f.executeGrabDash(ev.wx, ev.wy); break;
        case 'roll': f.executeRoll(); break;
        case 'special': f.fPress(ev.dir); break;
        case 'specialUp': f.fRelease(ev.dir, ev.wx, ev.wy); break;
        case 'cancelF': f.cancelF(); break;
    }
}

const FKEYS = Object.keys(new Fighter(0, 0, '#000', 'k')).filter(k => !['color', 'name', 'isAI', 'startX', 'width', 'height', 'home', 'heldItem', 'lastHitBy', 'swingHitSet', '_acc', '_since', '_slowK', '_upd'].includes(k));
const REFS = ['grabHolding', 'grabbedBy', 'grabVictim', 'suplexTarget'];
const SWING_NAMES = Object.keys(SWING);
const r2 = (v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v;
const idxOf = (f) => fighters.indexOf(f);
let lastSent = Array.from({ length: 8 }, () => ({}));
let fullEvery = 0;

function packFighter(f) {
    const o = {};
    for (const k of FKEYS) {
        if (REFS.includes(k)) { o[k] = idxOf(f[k]); continue; }
        const v = f[k];
        if (k === 'swing') o[k] = v ? SWING_NAMES.find(n => SWING[n] === v) || null : null;
        else if (k === 'ghosts') o[k] = v.slice(-8).map(g => ({ x: r2(g.x), y: r2(g.y), alpha: r2(g.alpha), color: g.color }));
        else if (k === 'activeHitbox') o[k] = v ? { ...v, x: r2(v.x), y: r2(v.y) } : null;
        else if (k === 'cd' || k === 'activeMove' || k === 'sx') o[k] = v ? { ...v } : v;
        else if (typeof v === 'number') o[k] = r2(v);
        else o[k] = v;
    }
    return o;
}

/** a compact (delta-coded) description of the whole match for the guest */
export function snapshot() {
    const tick = fullEvery++;
    const fs = (S.match ? fighters : [p1, p2]).map((f, i) => {
        if (!f.active && S.match) return null;
        const full = (tick % 8) === (i % 8);                      // refresh one fighter per snapshot, so no single message is huge
        const cur = packFighter(f), out = {};
        for (const k in cur) {
            const v = cur[k], j = (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
            if (full || lastSent[i][k] !== j) { out[k] = v; lastSent[i][k] = j; }
        }
        return out;
    });
    const ev = outbox.splice(0, outbox.length);
    return {
        f: fs, m: S.match ? 1 : 0, gs: S.gameState, win: S.winnerRole || null,
        ws: S.winnerSlots || null, wl: S.winnerLabel || null, sh: Math.round(S.screenShake * 10) / 10,
        o: orbs.map(o => ({ id: o.id, x: r2(o.x), y: r2(o.y), vx: r2(o.vx), vy: r2(o.vy), r: r2(o.r), c: r2(o.charge), own: idxOf(o.owner) })),
        it: items.map(i => ({ id: i.id, t: i.type, x: r2(i.x), y: r2(i.y), vx: r2(i.vx), vy: r2(i.vy), st: i.st, len: i.len, act: i.act ? 1 : 0, rot: r2(i.rot), sp: r2(i.spin), h: i.hold })),
        tl: S.match && S.match.mode === 'timer' ? S.timeLeft : 0,
        ev,
    };
}
export function resetSnapshotState() { lastSent = Array.from({ length: 8 }, () => ({})); fullEvery = 0; outbox.length = 0; }

const guestOrbs = new Map();
const guestItems = new Map();
const guestFlip = (i) => i < 0 ? -1 : (S.match ? i : 1 - i);   // 1v1: host's p1 is the guest's p2 and vice versa; custom matches use absolute slots
const INTERP_MS = 85;                                 // the guest shows the world this far in the past: smooth even when packets arrive in bursts
function guestSmooth() {
    const rt = performance.now() - INTERP_MS;
    for (const f of (S.match ? fighters : [p1, p2])) {
        if (!f.active) continue;
        f.px = f.x; f.py = f.y;
        f._since2 = (f._since2 || 0) + 1;
        if (f._since2 === 1 && f._atChg && f.attackTimer > 0) f.attackTimer--;      // animation timer: tick it on the frame between two snapshots so attacks play smoothly
        const buf = f._buf;
        if (!buf || !buf.length) continue;
        while (buf.length > 2 && buf[1].t <= rt) buf.shift();   // drop samples we have passed
        const a = buf[0], b = buf[1];
        let x, y;
        if (!b) {                                         // starved: carry on with the last known velocity for a moment
            const fr = Math.min(8, Math.max(0, (rt - a.t) / 16.7));
            x = a.x + (f.vx || 0) * fr; y = a.y + (f.vy || 0) * fr;
        } else if (rt >= b.t) { x = b.x; y = b.y; }
        else if (rt <= a.t) { x = a.x; y = a.y; }
        else if (b.tp) { x = a.x; y = a.y; }               // a teleport (blink, respawn): hold, then jump
        else { const u = (rt - a.t) / (b.t - a.t); x = a.x + (b.x - a.x) * u; y = a.y + (b.y - a.y) * u; }
        if (Math.hypot(x - f.x, y - f.y) > 260) { f._teleported = true; } else f._teleported = false;
        f.x = x; f.y = y;
    }
    for (const o of orbs) { o.x += o.vx * 0.5; o.y += o.vy * 0.5; }
    for (const g of items) if (g.st !== 'held' && !g.act && g.st !== 'zone') { g.x += g.vx * 0.5; g.y += g.vy * 0.5; g.rot += (g.spin || 0) * 0.5; }
}
export function applySnapshot(s) {
    const mine = s.m ? fighters : [p2, p1];               // snapshot index -> local fighter
    s.f.forEach((d, i) => {
        const f = mine[i];
        if (!d || !f) return;
        f._since2 = 0; f._atChg = d.attackTimer !== undefined;
        for (const k in d) {
            const v = d[k];
            if (k === 'x') { if (f._tx === undefined) { f.x = v; } f._tx = v; }
            else if (k === 'y') { if (f._ty === undefined) { f.y = v; } f._ty = v; }
            else if (k === 'px' || k === 'py') continue;
            else if (k === 'swing') f.swing = v ? SWING[v] : null;
            else if (REFS.includes(k)) { const g = guestFlip(v); f[k] = g < 0 ? null : fighters[g]; }
            else if (k === 'facing') f.facing = v;
            else f[k] = v;
        }
        if (f._tx !== undefined) {
            const buf = f._buf || (f._buf = []);
            buf.push({ t: performance.now(), x: f._tx, y: f._ty, tp: !!d._teleported });
            if (buf.length > 24) buf.shift();
        }
    });
    // orbs, matched by id so the renderer keeps one object per projectile
    const seen = new Set();
    for (const o of s.o) {
        seen.add(o.id);
        const og = guestFlip(o.own);
        const own = og < 0 ? p1 : fighters[og];
        const color = o.c >= 1 ? (S.match ? '#a855f7' : (own === p1 ? '#a855f7' : '#fb923c')) : own.color;
        let g = guestOrbs.get(o.id);
        if (!g) { g = { id: o.id }; guestOrbs.set(o.id, g); orbs.push(g); }
        const had = g.x !== undefined, gx = g.x, gy = g.y;
        Object.assign(g, { x: o.x, y: o.y, vx: o.vx, vy: o.vy, r: o.r, charge: o.c, owner: own, color, life: 200 });
        if (had && Math.hypot(gx - o.x, gy - o.y) < 90) { g.x = gx + (o.x - gx) * 0.5; g.y = gy + (o.y - gy) * 0.5; }
    }
    for (const [id, g] of guestOrbs) if (!seen.has(id)) { guestOrbs.delete(id); const i = orbs.indexOf(g); if (i >= 0) orbs.splice(i, 1); }
    // items, matched by id
    const seenIt = new Set();
    for (const o of (s.it || [])) {
        seenIt.add(o.id);
        let g = guestItems.get(o.id);
        if (!g) { g = { id: o.id }; guestItems.set(o.id, g); items.push(g); }
        Object.assign(g, { type: o.t, x: o.x, y: o.y, vx: o.vx, vy: o.vy, st: o.st, len: o.len, act: !!o.act, rot: o.rot, spin: o.sp, hold: o.h, r: ITEM_R[o.t] });
    }
    for (const [id, g] of guestItems) if (!seenIt.has(id)) { guestItems.delete(id); const i = items.indexOf(g); if (i >= 0) items.splice(i, 1); }
    if (s.tl) S.timeLeft = s.tl;
    S.screenShake = Math.max(S.screenShake, s.sh || 0);
    // game state
    if (s.gs === 'gameover') {
        if (S.gameState !== 'gameover' && s.m) {
            S.winnerSlots = s.ws || []; S.winnerLabel = s.wl || 'NOBODY';
            S.iWon = S.winnerSlots.includes(S.mySlot);
            triggerDramaticZoom(fighters[S.winnerSlots[0]] || fighters[S.mySlot] || p1);
            endGame(S.winnerLabel === 'DRAW' ? 'DRAW!' : S.iWon ? 'YOU WIN!' : `${S.winnerLabel} WINS!`, 'lobby');
        } else if (S.gameState !== 'gameover') {
            const winner = s.win === 'host' ? p2 : p1;
            triggerDramaticZoom(winner);
            endGame(s.win === 'guest' ? 'YOU WIN!' : 'YOU LOSE!', s.win);
        }
    } else if (S.gameState !== 'countdown' || s.gs === 'playing') S.gameState = s.gs;
    // effects, sounds, particles the host produced since the last snapshot
    for (const e of s.ev) {
        if (e.k === 'f') fxEvents.push({ type: e.e[0], x: e.e[1], y: e.e[2], a: e.e[3], b: e.e[4] });
        else if (e.k === 'a') { try { audio[e.m](...e.a); } catch (err) { /* sound not available */ } }
        else if (e.k === 'p') createParticles(...e.e);
        else if (e.k === 'b') koBeams.push({ startX: e.e[0], startY: e.e[1], targetX: STAGE.x + STAGE.width / 2, targetY: STAGE.y, alpha: 1.0, width: 32 });
    }
}

export function step() {
    const bubble = false;                               // the clock bubble slows projectiles and items only, never fighters
    for (const f of fighters) {
        if (!f.active) continue;
        if (bubble) {                                       // clock bubble: fighters inside only advance 3 of every 10 frames
            const k = slowAt(f.x, f.y);
            f._slowK = k;
            if (k < 1) { f._acc += k; if (f._acc >= 1) { f._acc -= 1; f._upd = true; } else f._upd = false; }
            else { f._acc = 0; f._upd = true; }
        } else { f._slowK = 1; f._acc = 0; f._upd = true; }
        if (f._upd) { f.px = f.x; f.py = f.y; f._teleported = false; f._since = 0; } else f._since++;
        if (f.throwFxT > 0 && f._upd) f.throwFxT--;
    }

    if (S.online === 'guest') {
        guestSmooth();                                      // the host simulates; we only show what it sends
    } else if (S.gameState === 'playing' && S.match) {      // custom match: up to 8 fighters, steered by their players
        const live = fighters.filter(isAlive);
        flushBuffered();
        for (const f of live) {
            if (!f._upd) continue;
            if (f.isAI) { const foe = nearestOf(f, foesOf(f)); if (foe) f.updateAI(foe); aiWalk(f); f.update(); continue; }
            drive(f, f === p1 ? { left: isDown('left'), right: isDown('right'), shield: isDown('shield'), drop: isDown('drop') } : (remote.helds[f.slot] || NOHELD));
            f.update();
        }
        updateOrbs();
        updateItems();
        const live2 = fighters.filter(isAlive);
        for (const a of live2) for (const b of live2) {
            if (a !== b && !(S.match.teams && a.team && a.team === b.team)) checkCombatCollisions(a, b);
        }
        itemInteractions();
        if (S.match.mode === 'timer' && S.online !== 'guest' && S.gameState === 'playing' && --S.timeLeft <= 0) finishTimer();
    } else if (S.gameState === 'playing') {
        flushBuffered();
        drive(p1, { left: isDown('left'), right: isDown('right'), shield: isDown('shield'), drop: isDown('drop') });
        p1.update();
        if (S.online === 'host') drive(p2, remote.helds[1] || NOHELD);   // the guest's fighter, steered by their inputs
        else { p2.updateAI(p1); aiWalk(p2); }
        p2.update();

        updateOrbs();

        checkCombatCollisions(p1, p2);
        checkCombatCollisions(p2, p1);
    }
    if (S.online === 'host' && NETHOOK.send && (++netTick % 2) === 0) NETHOOK.send(snapshot());

    for (let i = shockwaves.length - 1; i >= 0; i--) {
        const sw = shockwaves[i];
        sw.radius += sw.expansionSpeed;

        const progress = sw.radius / sw.maxRadius;
        if (progress > 0.75) {
            sw.alpha -= 0.025;
        }

        if (sw.alpha <= 0 || sw.radius >= sw.maxRadius) {
            shockwaves.splice(i, 1);
        }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.z += p.vz;
        p.alpha -= 0.04;
        if (p.alpha <= 0) {
            particles.splice(i, 1);
        }
    }

    for (let i = koBeams.length - 1; i >= 0; i--) {
        const beam = koBeams[i];
        beam.alpha -= 0.02;
        if (beam.alpha <= 0) {
            koBeams.splice(i, 1);
        }
    }

    if (dramaticZoom.active) {
        dramaticZoom.progress += 0.02;
        dramaticZoom.currentZoom += (dramaticZoom.targetZoom - dramaticZoom.currentZoom) * 0.08;
    } else if (S.screenShake > 0) {
        S.screenShake *= 0.88;
        if (S.screenShake < 0.5) S.screenShake = 0;
    }
}

export { spawnItem };
export {
    WORLD, STAGE, BLAST_ZONES, dramaticZoom, keys, mouse, particles, p1, p2,
    Fighter, AIBot, updateAimMatrix, renderHUD, startMatchSequence, endGame, gameOverModal,
    CHARGE_MAX, triggerDramaticZoom,
};
