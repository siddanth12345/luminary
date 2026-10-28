// ============================================================================
//  THE LUMINARY - game core
//  All gameplay runs in the original 2D world space: x -> right, y -> down,
//  3800 x 2100. The 3D renderer only *reads* this state; the `fx(...)` hooks and
//  presentation fields (attackKind, specialKind, ...) never feed back in.
// ============================================================================
import { SoundEngine } from './audio.js';
import { isDown } from './controls.js';

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
export const orbs = [];                    // Luminary Core projectiles
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
    top: -160,
    bottom: 2300
};
STAGE.platforms = [];                       // soft (one-way) platforms: { x, y, w } with x = left edge, y = top surface

/** the normal 1v1 / bot arena, and the custom-match arena: stage + kill zone 2.5x bigger, with Battlefield-style platforms */
const ARENAS = {
    normal: {
        world: { width: 3800, height: 2100 },
        stage: { x: 1140, y: 1250, width: 1520, height: 90 },
        bz: { left: -380, right: 4180, top: -160, bottom: 2300 },
        platforms: () => [],
    },
    lobby: {
        world: { width: 9500, height: 5250 },
        stage: { x: 2850, y: 3125, width: 3800, height: 225 },
        bz: { left: -950, right: 10450, top: -400, bottom: 5750 },
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
const LOCK = 42;              // 0.7 s: after ANY move you can't start another one (you can still walk)
const JUMP_OK = 24;           // ...but you may jump once 0.3 s of that lock has passed (42 - 18)
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
const HOLD_TO_CORE = 30;      // F held < 0.5 s -> directional variant, >= 0.5 s -> Luminary Core charge
const CHARGE_MAX = 63;        // full charge after 63 frames (0.7x the old 1.5 s)

let dramaticZoom = {
    active: false,
    targetX: 0,
    targetY: 0,
    currentZoom: 1,
    targetZoom: 3.5,
    progress: 0
};

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
            labelElem.textContent = (forcedNeutral ? 'NEUTRAL (held)' : 'NEUTRAL') + '  •  J: Jab  •  hold F: Luminary Core';
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
    JAB:  { type: 'J', a: 3, b: 9,  w: 65, h: 58, damage: 6,  bkb: 8,  kbg: 1.2,  path: (k, f) => ({ x: f * (24 + 40 * k), y: -2 }),
            angle: (f) => f === 1 ? -Math.PI / 4 : Math.PI + Math.PI / 4 },
    UP:   { type: 'J', a: 4, b: 11, w: 75, h: 55, damage: 8,  bkb: 12, kbg: 1.25, path: arc(56, 10, 150),
            angle: () => -Math.PI / 2 },
    DOWN: { type: 'J', a: 4, b: 11, w: 75, h: 55, damage: 9,  bkb: 13, kbg: 1.25, path: arc(54, 25, -110),
            angle: (f, grounded) => grounded ? -Math.PI / 3 : Math.PI / 2 },
    SIDE_LEFT:  { type: 'J', a: 5, b: 12, w: 70, h: 62, damage: 10, bkb: 12, kbg: 1.25, path: arc(64, 70, -20),
            angle: () => Math.PI + Math.PI / 6 },
    SIDE_RIGHT: { type: 'J', a: 5, b: 12, w: 70, h: 62, damage: 10, bkb: 12, kbg: 1.25, path: arc(64, 70, -20),
            angle: () => -Math.PI / 6 },
    BLINK: { type: 'BLINK', a: 1, b: 9, w: 110, h: 72, damage: 11, bkb: 11, kbg: 1.2, path: (k, f) => ({ x: f * (30 + 70 * k), y: 0 }),
            angle: (f) => f === 1 ? -Math.PI / 5 : Math.PI + Math.PI / 5 },
};

// ----------------------------------------------------------------- counter matrix
//  Move types: J, DASH, GRAB (also the Suplex dash), CORE, BLINK, SPIRAL, HEADBUTT  (+ the SHIELD state)
//   * SHIELD   counters everything except GRAB
//   * GRAB     is countered by every other active move (except HEADBUTT, which grab beats) - and beats SHIELD
//   * HEADBUTT counters everything except GRAB and SHIELD
//   * J        counters everything except SHIELD
//   * CORE     counters every F move and GRAB (not DASH, not J)
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

        this.maxJumps = 4;
        this.jumpsLeft = 4;
        this.grounded = false;

        this.isHanging = false;
        this.hangSide = 0;

        this.canMouseDash = true;
        this.canGrab = true;

        this.isDashing = false;
        this.dashTimer = 0;
        this.dashHitConnected = false;

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
        this.spiralT = 0;
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
        this.damage = (fullReset && S.match) ? S.match.startDamage : 0;    // custom match: choose the starting damage
        this.jumpsLeft = this.maxJumps;
        this.isHanging = false;
        this.canMouseDash = true;
        this.canGrab = true;
        this.isDashing = false;
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
        }
    }

    // ------------------------------------------------------------ action gating
    /** true while the fighter may NOT start a new move */
    actionBlocked() {
        return this.actionLock > 0 || this.hitstun > 0 || this.dizzyTimer > 0 || this.clashStunTimer > 0 ||
            this.freezeTimer > 0 || this.isRolling || this.isHanging || !!this.grabbedBy || !!this.grabHolding ||
            this.isShielding || this.fActive || this.spiralT > 0 || this.suplexT > 0 || this.diving;
    }
    canShield() {
        return this.actionLock <= 0 && !this.fActive && this.spiralT === 0 && this.suplexT === 0 && !this.diving &&
            !this.isRolling && this.freezeTimer === 0;
    }
    setMove(type, frames) { this.activeMove = { type, t: frames }; }

    /** being hit / countered cancels whatever the fighter was doing */
    interrupt() {
        this.fActive = false; this.chargeFrames = 0; this.aiChargeGoal = 0;
        this.swing = null; this.attackTimer = 0; this.activeHitbox = null;
        this.releaseSuplexVictim();
        this.spiralT = 0; this.suplexT = 0; this.suplexPending = false; this.diving = false;
        this.specialKind = null; this.specialDur = 0; this.specialT = 0;
        this.activeMove = null; this.actionLock = 0; this.freezeTimer = 0;
        this.isDashing = false; this.isGrabDashing = false;
    }

    update() {
        if (this.dropT > 0) this.dropT--;
        if (this.damage >= 250) {
            this.takeKO();
            return;
        }

        if (this.invincibleTimer > 0) this.invincibleTimer--;
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
            this.vy = Math.min(this.vy + WORLD.gravity, WORLD.terminalVelocity);
            this.x += this.vx;
            this.y += this.vy;
            this.checkStageCollision();
            return;
        }

        if (this.dizzyTimer > 0) {
            this.dizzyTimer--;
            this.vx *= 0.8;
            this.vy = Math.min(this.vy + WORLD.gravity, WORLD.terminalVelocity);
            this.x += this.vx;
            this.y += this.vy;
            this.checkStageCollision();
            return;
        }

        if (this.freezeTimer > 0) {          // getting up after a headbutt (not a stun: no grey, no damage)
            this.freezeTimer--;
            this.vx = 0;
            this.vy = Math.min(this.vy + WORLD.gravity, WORLD.terminalVelocity);
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
            if (g.suplexT > 0) {                  // carried overhead during a suplex
                this.x = g.x + g.facing * 8;
                this.y = g.y - 46;
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
                const throwSpeed = 17.5;
                target.vx = (dx / dist) * throwSpeed;
                target.vy = (dy / dist) * throwSpeed;
                target.hitstun = 60;
                target.grounded = false;

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

        if (this.isDashing) {
            this.dashTimer--;
            this.ghosts.push({ x: this.x, y: this.y, alpha: 0.7, color: '#22d3ee' });
            if (this.dashTimer <= 0) {
                this.isDashing = false;
            }
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
            this.vy = Math.min(this.vy + WORLD.gravity, WORLD.terminalVelocity);
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
            this.attackTimer--;
            if (this.attackTimer === 0 && this.swing) {
                this.swing = null;
                this.activeHitbox = null;
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
        this.activeHitbox = {
            x: this.x + p.x, y: this.y + p.y, w: sw.w, h: sw.h,
            damage: sw.damage, bkb: sw.bkb, kbg: sw.kbg, angle: sw.angle(this.facing, this.grounded), type: sw.type,
        };
        if (sw.type === 'J') this.setMove('J', 2);            // J only counters while its swing is live
    }

    // ------------------------------------------------------------ F specials: per-frame state
    updateSpecials() {
        if (this.fActive) this.chargeFrames = Math.min(120, this.chargeFrames + 1);

        if (this.spiralT > 0) {                               // Rising Spiral: multi-hit while rising
            this.spiralT--;
            this.vy = -10.5;
            const n = 36 - this.spiralT;                      // 1..36
            if (n % 6 === 1) {
                const last = n >= 31;
                this.activeHitbox = {
                    x: this.x, y: this.y - 8, w: 132, h: 118, type: 'SPIRAL', ttl: 5,
                    damage: last ? 6 : 3, bkb: last ? 12 : 0, kbg: last ? 1.1 : 0,
                    angle: -Math.PI / 2 + this.facing * 0.35,
                    fixed: last ? null : { vx: this.facing * 1.5, vy: -10.5, hitstun: 14 },
                };
                fx('spiral', this.x, this.y);
            }
            if (this.spiralT === 0) this.endSpiral();
        }

        if (this.diving) {                                    // Air Headbutt dive
            this.diveT++;
            this.vx = 0;
            this.vy = 24;
            this.activeMove = { type: 'HEADBUTT', t: 3 };
            if (this.diveT % 6 === 1) {                       // consecutive hits on the way down (same box as Rising Spiral)
                this.activeHitbox = {
                    x: this.x, y: this.y + 12, w: 132, h: 118, type: 'HEADBUTT', ttl: 5,
                    damage: 2, bkb: 0, kbg: 0, angle: Math.PI / 2,
                    fixed: { vx: 0, vy: 18, hitstun: 14 },
                };
                fx('spiral', this.x, this.y);
            }
            if (this.diveT > 90 || this.y > STAGE.y + 260) {
                this.diving = false; this.specialKind = null; this.specialDur = 0; this.activeMove = null; this.activeHitbox = null;
            }
        }
    }

    endSpiral() {
        this.activeMove = null;
        const overStage = this.x > STAGE.x - 40 && this.x < STAGE.x + STAGE.width + 40 && this.y < STAGE.y;
        if (!overStage) this.actionLock = Math.max(this.actionLock, 96);   // missed the stage -> extra lag
    }

    diveImpact() {
        this.diving = false;
        this.vy = 0;
        const w = STAGE.width / 8;                            // 1/8 of the stage
        this.activeHitbox = {
            x: this.x, y: this.y + this.height / 2 - 30, w, h: 64, type: 'HEADBUTT', ttl: 8,
            damage: 15, bkb: 0, kbg: 0, angle: -Math.PI / 2, stun: STUN,
        };
        this.activeMove = { type: 'HEADBUTT', t: 10 };
        this.specialKind = null; this.specialDur = 0;
        this.freezeTimer = FREEZE;
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
    /** F released: held >= 0.5 s (or neutral aim) -> Luminary Core, otherwise the directional variant */
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

        if (!this.grounded) this.airSpecials++;
        this.cd[kind] = CD[kind];
        this.actionLock = LOCK;

        switch (kind) {
            case 'CORE': this.startCore(tx, ty, charge); break;
            case 'BLINK': this.startBlink(tx >= this.x ? 1 : -1); break;
            case 'SPIRAL': this.startSpiral(tx); break;
            case 'SUPLEX': this.startSuplex(tx); break;
            case 'HEADBUTT': this.startHeadbutt(); break;
        }
        return true;
    }

    startCore(tx, ty, charge) {
        let dx = tx - this.x, dy = ty - this.y;
        let len = Math.hypot(dx, dy);
        if (len < 1) { dx = this.facing; dy = 0; len = 1; }
        dx /= len; dy /= len;
        if (Math.abs(dx) > 0.2) this.facing = dx > 0 ? 1 : -1;
        const speed = (22.5 + (16.25 * 1.3 - 22.5) * charge) * 0.7;   // 0.7x of the previous speed (15.75 uncharged -> 14.8 full)
        const r = 12 + (62 * 0.8 * 0.8 - 12) * charge;        // min 12 (2x smaller), max 39.7 (0.8x the previous max)
        const full = charge >= 1;
        const color = full ? (this.superColor || (this === p1 ? '#a855f7' : '#fb923c')) : this.color;   // full charge: blue -> purple, red -> orange
        orbs.push({
            x: this.x + dx * (40 + r * 0.4), y: this.y + dy * (40 + r * 0.4),
            vx: dx * speed, vy: dy * speed, r, charge, owner: this, life: 260, color, id: ++orbSerial,
        });                                                   // flies straight along the aim: no homing
        this.setMove('CORE', 24);
        this.specialKind = 'CORE'; this.specialT = 0; this.specialDur = 24;
        audio.playDash();
        fx('core', this.x, this.y, charge, Math.atan2(dy, dx));
    }

    startBlink(d) {
        this.facing = d;
        const fromX = this.x, fromY = this.y;
        this.x = Math.min(WORLD.width - 20, Math.max(20, this.x + d * 220));
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
        this.swing = SWING.BLINK;
        this.swingHit = false;
        this.setMove('BLINK', 18);
        audio.playDash();
    }

    startSpiral(tx) {
        this.jumpsLeft = Math.max(0, this.jumpsLeft - SPIRAL_JUMP_COST);   // recovery that costs a couple of jumps
        this.grounded = false;
        this.y -= 4;
        this.vy = -10.5;
        if (tx !== undefined && Math.abs(tx - this.x) > 20) this.facing = tx > this.x ? 1 : -1;
        this.spiralT = 36;
        this.specialKind = 'SPIRAL'; this.specialT = 0; this.specialDur = 36;
        this.setMove('SPIRAL', 36);
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
        if (this.suplexPhase === 'rise') {
            this.vy = -15; this.vx = this.facing * 2.5;
            this.x += this.vx; this.y += this.vy;
            if (this.y < TOP_LIMIT) {                          // reached the top of the map: cancel
                this.endSuplex();
                this.actionLock = Math.max(this.actionLock, 60);
                return;
            }
            if (this.suplexN >= SUPLEX_RISE) { this.suplexPhase = 'slam'; this.suplexN = 0; }
        } else {
            this.vy = 26; this.vx = -this.facing * 2;
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
        fx('stomp', this.x, this.y + this.height / 2, STAGE.width / 8, 0);
        S.screenShake = Math.max(S.screenShake, 16);
        launch(this, d, {
            damage: 14, bkb: 7, kbg: 0.7,
            angle: this.facing === 1 ? Math.PI + Math.PI / 3 : -Math.PI / 3,   // thrown up and behind
        });
    }
    endSuplex() {
        this.releaseSuplexVictim();
        this.suplexT = 0;
        this.specialKind = null; this.specialDur = 0;
        this.vx = 0; this.vy = 0;
    }

    startHeadbutt() {
        this.diving = true;
        this.diveT = 0;
        this.diveHit = false;
        this.vx = 0;
        this.vy = 24;
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
        this.canMouseDash = true;
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
                    this.canMouseDash = true;
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
                    this.canMouseDash = true;
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
            this.freezeTimer > 0 || this.suplexT > 0 || this.diving || this.spiralT > 0 || this.grabbedBy || this.grabHolding) return false;
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
        if (this.hitstun > 0 || this.isShielding || this.dizzyTimer > 0 || this.clashStunTimer > 0 || this.grabbedBy || this.grabHolding || this.isRolling) return;
        if (this.freezeTimer > 0 || this.suplexT > 0 || this.diving || this.spiralT > 0) return;
        if (this.actionLock > JUMP_OK) return;                // 0.3 s after a move you may jump again

        if (this.isHanging) {
            this.isHanging = false;
            this.vy = -14.5;
            this.vx = this.hangSide * 7.5;
            this.jumpsLeft = this.maxJumps;
            this.canMouseDash = true;
            this.canGrab = true;
            audio.playJump();
            createParticles(this.x, this.y, '#38bdf8', 10);
            return;
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
    }

    executeGrabDash(targetWorldX, targetWorldY) {
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

    executeMouseDash(targetWorldX, targetWorldY) {
        if (!this.canMouseDash || this.actionBlocked()) return false;

        const dx = targetWorldX - this.x;
        const dy = targetWorldY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return false;

        const dashSpeed = 24;
        this.vx = (dx / dist) * dashSpeed;
        this.vy = (dy / dist) * dashSpeed;

        this.canMouseDash = false;
        this.isDashing = true;
        this.dashTimer = 16;
        this.dashHitConnected = false;
        this.actionLock = LOCK;
        this.setMove('DASH', 16);

        audio.playDash();
        createParticles(this.x, this.y, '#22d3ee', 16);
        return true;
    }

    /** The "J" attack (now on right click / the aim-matrix attack). The hitbox follows the animation. */
    attack(aimDirection) {
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
        this.activeHitbox = null;
        this.actionLock = LOCK;
        audio.playHit(false);
        return true;
    }

    takeKO() {
        if (S.gameMode === 'training' && this.isAI) {
            this.reset(false);
            return;
        }

        this.stocks--;
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
const MEM_KEYS = ['SHIELD', 'J', 'DASH', 'GRAB', 'CORE', 'BLINK', 'SPIRAL', 'SUPLEX', 'HEADBUTT'];
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
        if (!acted && this.actionTimer % 6 === 0) acted = this.executeMouseDash(tx, ty);
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
        if (this.suplexT > 0 || this.diving || this.isRolling) return;

        const isOverVoid = this.x < STAGE.x || this.x > STAGE.x + STAGE.width;
        if (isOverVoid) {
            this.recover();
            return;
        }

        const distToTargetX = target.x - this.x;
        const distToTargetY = target.y - this.y;
        const dist = Math.sqrt(distToTargetX * distToTargetX + distToTargetY * distToTargetY);

        // charging a Luminary Core: stand still, then fire it straight at where the target is heading
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

        // the player is on / over the edge: shoot a Luminary Core at them from range
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
                } else if (r < 0.3 + 0.4 * (habit('J') + habit('DASH'))) {
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
                if (dist < 180 && this.canMouseDash && Math.random() < 0.5 && this.executeMouseDash(target.x, target.y)) return;
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
        attacker.isDashing = false; defender.isDashing = false;
        attacker.vx = d * 6; defender.vx = -d * 6;
    }
}

/** apply damage + knockback / stun for a landed hit */
function launch(attacker, defender, hb) {
    defender.interrupt();
    defender.damage += hb.damage;

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
    const kbForce = (percentFactor * hb.kbg) + hb.bkb;

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
    const R = 80 + 90 * o.charge;
    const dmg = 4 + 16 * o.charge;                // min 4 (2x less damage), max 20
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
                damage: dmg, bkb: (10 + 8 * o.charge) / 2, kbg: 1.1 / 2,      // half the knockback
                angle: Math.atan2(t.y - o.y - 25, (t.x - o.x) || o.vx),
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
        o.x += o.vx;
        o.y += o.vy;
        o.life--;

        if (o.x < -600 || o.x > WORLD.width + 600 || o.y < -600 || o.y > WORLD.height + 600) { orbs.splice(i, 1); continue; }

        const sr = o.r * 0.35;          // the stage only stops the orb's core, so big orbs can skim along the floor
        if (o.x + sr > STAGE.x && o.x - sr < STAGE.x + STAGE.width && o.y + sr > STAGE.y && o.y - sr < STAGE.y + STAGE.height) {
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

    // ---- left-click dash attack
    if (attacker.isDashing && !attacker.dashHitConnected && defender.invincibleTimer <= 0) {
        const dashLeft = attacker.x - attacker.width;
        const dashRight = attacker.x + attacker.width;
        const dashTop = attacker.y - attacker.height;
        const dashBottom = attacker.y + attacker.height;

        const defLeft = defender.x - defender.width / 2;
        const defRight = defender.x + defender.width / 2;
        const defTop = defender.y - defender.height / 2;
        const defBottom = defender.y + defender.height / 2;

        if (dashLeft < defRight && dashRight > defLeft && dashTop < defBottom && dashBottom > defTop) {
            const res = interaction('DASH', defender);
            if (res !== 'hit') {
                attacker.dashHitConnected = true;
                handleBlocked(res, attacker, defender);
                return;
            }

            defender.interrupt();
            defender.damage += 10;
            const upwardKnockback = -18 - (defender.damage * 0.15);
            defender.vy = upwardKnockback;
            defender.vx = attacker.vx * 0.6;
            defender.hitstun = 60;
            defender.grounded = false;

            attacker.dashHitConnected = true;
            S.screenShake = 14;
            audio.playHit(true);
            createParticles(defender.x, defender.y, '#22d3ee', 20);
            fx('hit', defender.x, defender.y, 14, Math.atan2(defender.vy, defender.vx));
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
        attacker.activeHitbox = null;
        attacker.swingHit = true;
        if (res !== 'hit') {
            handleBlocked(res, attacker, defender);
            return;
        }
        launch(attacker, defender, hb);
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
    const lbl = document.getElementById('aiDiffLabel');
    const aiPanel = lbl && lbl.closest('.glass-panel');
    if (aiPanel) aiPanel.style.visibility = S.match ? 'hidden' : '';
    if (!S.match || S.gameState === 'start') { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    const rows = fighters.filter(f => f.active).map(f => {
        const pips = f.out ? 'OUT' : '●'.repeat(Math.max(0, f.stocks));
        const nm = String(f.name).replace(/[<>&"]/g, '');
        return `<div style="display:flex;gap:8px;align-items:center;background:rgba(8,12,24,.72);border-left:4px solid ${f.color};padding:4px 8px;border-radius:8px;min-width:190px;opacity:${f.out ? .45 : 1}${f.slot === (S.mySlot || 0) ? ';outline:1px solid #fff6' : ''}"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nm}</span><span style="color:${f.damage > 120 ? '#fb7185' : f.damage > 60 ? '#fbbf24' : '#fff'}">${Math.floor(f.damage)}%</span><span style="color:${f.color};letter-spacing:1px">${pips}</span></div>`;
    }).join('');
    if (rows !== rosterKey) { rosterKey = rows; el.innerHTML = rows; }
}

function renderHUD() {
    const me = S.match ? (fighters[S.mySlot || 0] || p1) : p1;
    renderRoster();
    document.getElementById('p1Damage').textContent = Math.floor(me.damage);
    const p1DamageElem = document.getElementById('p1Damage');
    if (me.damage > 120) p1DamageElem.className = "smash-font text-5xl font-bold tracking-tight text-rose-500 pulse-glow-red leading-none";
    else if (me.damage > 60) p1DamageElem.className = "smash-font text-5xl font-bold tracking-tight text-amber-400 leading-none";
    else p1DamageElem.className = "smash-font text-5xl font-bold tracking-tight text-white leading-none";

    const p1StocksContainer = document.getElementById('p1Stocks');
    p1StocksContainer.innerHTML = '';
    for (let i = 0; i < me.stocks; i++) {
        const pip = document.createElement('div');
        pip.className = 'w-3.5 h-3.5 rounded-full bg-cyan-400 border border-cyan-200 shadow-md shadow-cyan-500/50';
        p1StocksContainer.appendChild(pip);
    }

    const dashBadge = document.getElementById('p1DashBadge');
    if (me.canMouseDash) {
        dashBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-500/50';
        dashBadge.textContent = 'DASH READY';
    } else {
        dashBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900 text-slate-500 border border-slate-700';
        dashBadge.textContent = 'DASH USED';
    }

    // F-special status: charge meter while charging, otherwise how many air F moves are left
    if (!fBadge && dashBadge.parentElement) {
        fBadge = document.createElement('span');
        fBadge.id = 'p1FBadge';
        fBadge.style.marginLeft = '6px';
        dashBadge.insertAdjacentElement('afterend', fBadge);
    }
    if (fBadge) {
        fBadge.style.color = me.charging ? '#ddd6fe' : (!me.grounded && me.airSpecials >= AIR_F_MAX ? '#64748b' : '#c4b5fd');
        fBadge.style.whiteSpace = 'nowrap';
        if (me.charging) {
            fBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-950 text-violet-300 border border-violet-500/60';
            fBadge.textContent = `CORE ${Math.min(100, Math.round(me.chargeFrames / CHARGE_MAX * 100))}%`;
        } else if (!me.grounded && me.airSpecials >= AIR_F_MAX) {
            fBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900 text-slate-500 border border-slate-700';
            fBadge.textContent = 'AIR F: 0 LEFT';
        } else {
            fBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-950 text-violet-300 border border-violet-500/40';
            fBadge.textContent = `AIR F: ${AIR_F_MAX - me.airSpecials}/${AIR_F_MAX}`;
        }
    }

    const jumpContainer = document.getElementById('p1JumpDots');
    jumpContainer.innerHTML = '';
    for (let i = 0; i < me.maxJumps; i++) {
        const dot = document.createElement('div');
        dot.className = `w-2.5 h-2.5 rounded-full ${i < me.jumpsLeft ? 'bg-cyan-400' : 'bg-slate-700'}`;
        jumpContainer.appendChild(dot);
    }

    document.getElementById('p2Damage').textContent = Math.floor(p2.damage);
    const p2DamageElem = document.getElementById('p2Damage');
    if (p2.damage > 120) p2DamageElem.className = "smash-font text-5xl font-bold tracking-tight text-rose-500 pulse-glow-red leading-none";
    else if (p2.damage > 60) p2DamageElem.className = "smash-font text-5xl font-bold tracking-tight text-amber-400 leading-none";
    else p2DamageElem.className = "smash-font text-5xl font-bold tracking-tight text-white leading-none";

    const p2StocksContainer = document.getElementById('p2Stocks');
    p2StocksContainer.innerHTML = '';
    const botStocksDisplay = S.gameMode === 'training' ? 3 : p2.stocks;
    for (let i = 0; i < botStocksDisplay; i++) {
        const pip = document.createElement('div');
        pip.className = 'w-3.5 h-3.5 rounded-full bg-rose-500 border border-rose-300 shadow-md shadow-rose-500/50';
        p2StocksContainer.appendChild(pip);
    }
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
        S.match = { teams: !!cfg.teams, startDamage: cfg.startDamage || 0, stocks: cfg.stocks || 3 };
        S.mySlot = cfg.mySlot || 0;
        S.matchCfg = cfg;
        setArena('lobby');
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

    if (S.match) {
        const n = cfg.players.length, span = STAGE.width * 0.7;
        fighters.forEach((f) => { f.active = false; f.out = false; f.team = null; });
        cfg.players.forEach((pl, i) => {
            // the local player is always drawn as p1 (slot 0 locally): swap slot 0 and my slot
            const f = fighters[pl.slot];
            f.active = true; f.name = pl.name; f.team = S.match.teams ? pl.team : null; f.isAI = !!pl.bot; f.diff = pl.bot || null; f.shieldHold = 0;
            f.color = S.match.teams && pl.team ? TEAM_COLORS[pl.team] : FFA_COLORS[pl.slot % 8];
            f.superColor = null;
            f.startX = STAGE.x + STAGE.width * 0.15 + (n > 1 ? span * i / (n - 1) : span / 2);
            f.startY = STAGE.y - 120;
            f.reset(true); f.shieldHold = 0; f.remoteAim = null;
        });
    } else {
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

/** walking / shielding for one fighter from a held-input state ({left,right,shield,drop}) */
function drive(f, h) {
    const free = f.hitstun === 0 && f.dizzyTimer === 0 && f.clashStunTimer === 0 && !f.grabHolding &&
        !f.isRolling && f.freezeTimer === 0;
    if (free) {
        // you can always walk (even during the 0.7 s move lock) - except while diving
        if (!f.diving) {
            const spd = f.fActive ? 6.75 : (f.spiralT > 0 ? 4.5 : 8.5);   // charging a core: 1.5x the old 4.5
            if (h.left) { if (f.isHanging) f.isHanging = false; f.vx = -spd; f.facing = -1; }
            if (h.right) { if (f.isHanging) f.isHanging = false; f.vx = spd; f.facing = 1; }
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
        case 'attack': f.attack(ev.dir); break;
        case 'dash': f.executeMouseDash(ev.wx, ev.wy); break;
        case 'grab': f.executeGrabDash(ev.wx, ev.wy); break;
        case 'roll': f.executeRoll(); break;
        case 'special': f.fPress(ev.dir); break;
        case 'specialUp': f.fRelease(ev.dir, ev.wx, ev.wy); break;
        case 'cancelF': f.cancelF(); break;
    }
}

const FKEYS = Object.keys(new Fighter(0, 0, '#000', 'k')).filter(k => !['color', 'name', 'isAI', 'startX', 'width', 'height', 'home'].includes(k));
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
        else if (k === 'cd' || k === 'activeMove') o[k] = v ? { ...v } : v;
        else if (typeof v === 'number') o[k] = r2(v);
        else o[k] = v;
    }
    return o;
}

/** a compact (delta-coded) description of the whole match for the guest */
export function snapshot() {
    const full = (fullEvery++ % 60) === 0;
    const fs = (S.match ? fighters : [p1, p2]).map((f, i) => {
        if (!f.active && S.match) return null;
        const cur = packFighter(f), out = {};
        for (const k in cur) {
            const j = JSON.stringify(cur[k]);
            if (full || lastSent[i][k] !== j) { out[k] = cur[k]; lastSent[i][k] = j; }
        }
        return out;
    });
    const ev = outbox.splice(0, outbox.length);
    return {
        f: fs, m: S.match ? 1 : 0, gs: S.gameState, win: S.winnerRole || null,
        ws: S.winnerSlots || null, wl: S.winnerLabel || null, sh: Math.round(S.screenShake * 10) / 10,
        o: orbs.map(o => ({ id: o.id, x: r2(o.x), y: r2(o.y), vx: r2(o.vx), vy: r2(o.vy), r: r2(o.r), c: r2(o.charge), own: idxOf(o.owner) })),
        ev,
    };
}
export function resetSnapshotState() { lastSent = Array.from({ length: 8 }, () => ({})); fullEvery = 0; outbox.length = 0; }

const guestOrbs = new Map();
const guestFlip = (i) => i < 0 ? -1 : (S.match ? i : 1 - i);   // 1v1: host's p1 is the guest's p2 and vice versa; custom matches use absolute slots
function guestSmooth() {
    for (const f of (S.match ? fighters : [p1, p2])) {
        if (!f.active) continue;
        f.px = f.x; f.py = f.y;
        if (f._tx === undefined) continue;
        const d = Math.hypot(f._tx - f.x, f._ty - f.y);
        if (d > 260 || f._snap) { f.x = f._tx; f.y = f._ty; f._snap = false; f._teleported = true; }
        else { f.x += (f._tx - f.x) * 0.45; f.y += (f._ty - f.y) * 0.45; }
    }
    for (const o of orbs) { o.x += o.vx * 0.5; o.y += o.vy * 0.5; }
}
export function applySnapshot(s) {
    const mine = s.m ? fighters : [p2, p1];               // snapshot index -> local fighter
    s.f.forEach((d, i) => {
        const f = mine[i];
        if (!d || !f) return;
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
        if (d._teleported) f._snap = true;
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
        Object.assign(g, { x: o.x, y: o.y, vx: o.vx, vy: o.vy, r: o.r, charge: o.c, owner: own, color, life: 200 });
    }
    for (const [id, g] of guestOrbs) if (!seen.has(id)) { guestOrbs.delete(id); const i = orbs.indexOf(g); if (i >= 0) orbs.splice(i, 1); }
    S.screenShake = Math.max(S.screenShake, s.sh || 0);
    // game state
    if (s.gs === 'gameover') {
        if (S.gameState !== 'gameover' && s.m) {
            S.winnerSlots = s.ws || []; S.winnerLabel = s.wl || 'NOBODY';
            S.iWon = S.winnerSlots.includes(S.mySlot);
            triggerDramaticZoom(fighters[S.winnerSlots[0]] || fighters[S.mySlot] || p1);
            endGame(S.iWon ? 'YOU WIN!' : `${S.winnerLabel} WINS!`, 'lobby');
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
    for (const f of fighters) {
        if (!f.active) continue;
        f.px = f.x; f.py = f.y;
        f._teleported = false;
        if (f.throwFxT > 0) f.throwFxT--;
    }

    if (S.online === 'guest') {
        guestSmooth();                                      // the host simulates; we only show what it sends
    } else if (S.gameState === 'playing' && S.match) {      // custom match: up to 8 fighters, steered by their players
        const live = fighters.filter(isAlive);
        for (const f of live) {
            if (f.isAI) { const foe = nearestOf(f, foesOf(f)); if (foe) f.updateAI(foe); f.update(); continue; }
            drive(f, f === p1 ? { left: isDown('left'), right: isDown('right'), shield: isDown('shield'), drop: isDown('drop') } : (remote.helds[f.slot] || NOHELD));
            f.update();
        }
        updateOrbs();
        for (const a of fighters.filter(isAlive)) for (const b of fighters.filter(isAlive)) {
            if (a !== b && !(S.match.teams && a.team && a.team === b.team)) checkCombatCollisions(a, b);
        }
    } else if (S.gameState === 'playing') {
        drive(p1, { left: isDown('left'), right: isDown('right'), shield: isDown('shield'), drop: isDown('drop') });
        p1.update();
        if (S.online === 'host') drive(p2, remote.helds[1] || NOHELD);   // the guest's fighter, steered by their inputs
        else p2.updateAI(p1);
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

export {
    WORLD, STAGE, BLAST_ZONES, dramaticZoom, keys, mouse, particles, p1, p2,
    Fighter, AIBot, updateAimMatrix, renderHUD, startMatchSequence, endGame, gameOverModal,
    CHARGE_MAX, triggerDramaticZoom,
};
