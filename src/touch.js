// Mobile controls. Left half of the screen = dynamic joystick. Right side = the aim grid
// (red centre + four black buttons), jump and shield buttons. Everything funnels into the
// same doAction / releaseAction path as the keyboard, so online guests work too.
//
//   red centre   tap = sword spin (neutral melee) | hold 0.4 s = neutral F (Core, then drag to aim it) | drag onto a black button = that F move
//   black buttons tap = melee up / left / right / down, hold = charge
//   grab         drag to aim, release to fire the grab (or throw / use an item); springs back
//   shield       hold = shield | joystick left/right while shielding = roll
import { S, mouse, fighters, p1 } from './core.js';
import { virtual } from './controls.js';
import { getLayout, touchMode, onLayout } from './layout.js';

export const MATRIX_BASE = 230;
export const matrixAuto = () => Math.max(150, Math.min(MATRIX_BASE, Math.min(window.innerWidth, window.innerHeight) * 0.56));
export const MATRIX_MIN = 130, MATRIX_MAX = 320;
/** the aim grid's size in px: the saved size (layout editor) or an automatic one that fits the screen */
export const matrixSize = (cfg) => { const s = cfg && cfg.matrix && cfg.matrix.s; return s ? Math.min(MATRIX_MAX, Math.max(MATRIX_MIN, s)) : matrixAuto(); };

const DIRS = { UP: [0, -1], DOWN: [0, 1], SIDE_LEFT: [-1, 0], SIDE_RIGHT: [1, 0] };
const HOLD_MS = 400;

/** build the control elements inside `host`; returns refs. Used by the game and by the layout editor. */
export function buildControls(host) {
    host.insertAdjacentHTML('beforeend', `
        <div class="tz-matrix" data-k="matrix">
            <div class="tz-hit" data-hit></div>
            <div class="tz-ring"></div>
            <button class="tz-b tz-dir" data-dir="UP" aria-label="Up attack"><svg viewBox="0 0 24 24" class="tz-ic"><path d="M12 19V6M6 11l6-6 6 6" /></svg></button>
            <button class="tz-b tz-dir" data-dir="SIDE_LEFT" aria-label="Left attack"><svg viewBox="0 0 24 24" class="tz-ic"><path d="M19 12H6M11 6l-6 6 6 6" /></svg></button>
            <button class="tz-b tz-dir" data-dir="SIDE_RIGHT" aria-label="Right attack"><svg viewBox="0 0 24 24" class="tz-ic"><path d="M5 12h13M13 6l6 6-6 6" /></svg></button>
            <button class="tz-b tz-dir" data-dir="DOWN" aria-label="Down attack"><svg viewBox="0 0 24 24" class="tz-ic"><path d="M12 5v13M6 13l6 6 6-6" /></svg></button>
            <button class="tz-b tz-main" data-main aria-label="Neutral attack (sword spin)"><svg viewBox="0 0 24 24" class="tz-ic"><path d="M12 3a9 9 0 1 0 9 9" /><path d="M21 4v6h-6" /></svg><small>hold F</small><i class="tz-aim"></i></button>
        </div>
        <button class="tz-b tz-round tz-jump" data-k="jump"><svg viewBox="0 0 24 24" class="tz-ic"><path d="M6 14l6-6 6 6" /><path d="M6 20l6-6 6 6" /></svg><span>JUMP</span></button>
        <button class="tz-b tz-round tz-grab" data-k="grab"><svg viewBox="0 0 24 24" class="tz-ic"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 10V5a1.5 1.5 0 0 1 3 0v6M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 6-5.5 6S6.5 18 6 15l-1.4-3.2a1.5 1.5 0 0 1 2.6-1.4L8 12" /></svg><span>GRAB</span><small>drag · release</small><i class="tz-aim"></i></button>
        <button class="tz-b tz-round tz-shield" data-k="shield"><svg viewBox="0 0 24 24" class="tz-ic"><path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6l7-3z" /></svg><span>SHIELD</span></button>`);
    const q = (s) => host.querySelector(s);
    return { matrix: q('[data-k="matrix"]'), jump: q('[data-k="jump"]'), grab: q('[data-k="grab"]'), shield: q('[data-k="shield"]'), host };
}

/** place the controls according to a layout (fractions of the host size) */
export function positionControls(refs, cfg, w = window.innerWidth, h = window.innerHeight) {
    const M = matrixSize(cfg);
    const place = (el, c, size) => {
        el.style.width = el.style.height = size + 'px';
        const x = Math.min(w - size / 2, Math.max(size / 2, c.x * w)), y = Math.min(h - size / 2, Math.max(size / 2, c.y * h));
        el.style.left = (x - size / 2) + 'px'; el.style.top = (y - size / 2) + 'px';
    };
    place(refs.matrix, cfg.matrix, M);
    for (const k of ['jump', 'grab', 'shield']) place(refs[k], cfg[k], cfg[k].s);
    // grid internals
    const sub = refs.matrix, d = M * 0.22, off = M * 0.33, c = M / 2;
    const put = (el, dx, dy, dd) => { el.style.width = el.style.height = dd + 'px'; el.style.left = (c + dx - dd / 2) + 'px'; el.style.top = (c + dy - dd / 2) + 'px'; };
    for (const b of sub.querySelectorAll('.tz-dir')) { const v = DIRS[b.dataset.dir]; put(b, v[0] * off, v[1] * off, d * 1.25); }
    put(sub.querySelector('.tz-main'), 0, 0, M * 0.26);
    return { M, off, d, lim: M * 0.37 };
}

export class TouchControls {
    constructor({ root, doAction, releaseAction, cancelF, heldChanged }) {
        this.api = { doAction, releaseAction, cancelF, heldChanged };
        this.on = false;
        this.hud = document.createElement('div');
        this.hud.className = 'tz-hud';
        this.hud.style.display = 'none';
        this.hud.innerHTML = `<div class="tz-zone" data-zone></div><div class="tz-joybase" data-base><i data-stick></i></div>`;
        root.appendChild(this.hud);
        this.refs = buildControls(this.hud);
        this.zone = this.hud.querySelector('[data-zone]');
        this.base = this.hud.querySelector('[data-base]');
        this.stick = this.hud.querySelector('[data-stick]');
        this.joy = null; this.joyVec = null; this.dirX = 0;
        this.geo = null;
        this.wire();
        const apply = () => this.apply();
        window.addEventListener('resize', apply);
        onLayout(apply);
        this.apply();
    }

    me() { return S.match ? (fighters[S.mySlot || 0] || p1) : p1; }

    apply() {
        const active = touchMode();
        if (active !== this.on) {
            this.on = active;
            mouse.touchMode = active;
            document.body.classList.toggle('touch-ui', active);
            if (!active) this.releaseAll();
        }
        this.geo = positionControls(this.refs, getLayout().mobile);
    }

    /** called every frame: show only during a match, keep a sensible default aim */
    tick() {
        const show = this.on && (S.gameState === 'playing' || S.gameState === 'countdown');
        this.hud.style.display = show ? 'block' : 'none';
        if (!show && (this.joy || virtual.shield)) this.releaseAll();
        if (this.on) { const m = this.me(); if (!this.pressedAim) { mouse.worldX = m.x + this.facingVec(m)[0] * 400; mouse.worldY = m.y + this.facingVec(m)[1] * 400; } }
    }

    releaseAll() {
        this.joy = null; this.joyVec = null; this.base.style.display = 'none';
        virtual.left = virtual.right = virtual.shield = virtual.drop = false;
        this.api.heldChanged();
    }

    facingVec(m) { return this.joyVec ? this.joyVec : [m.facing || 1, 0]; }
    /** set the aim for the next action; `dir` is the matrix direction, vector gives Core / dash / grab targets */
    setAim(dir, vec) {
        const m = this.me();
        let v = vec;
        if (!v) v = dir && DIRS[dir] ? DIRS[dir] : this.facingVec(m);
        mouse.direction = dir || 'NEUTRAL';
        mouse.worldX = m.x + v[0] * 500; mouse.worldY = m.y + v[1] * 500;
    }
    act(name, dir, vec) { this.pressedAim = true; this.setAim(dir, vec); this.api.doAction(name); this.pressedAim = false; }

    wire() {
        const R = 58;
        // ---------------------------------------------------------- dynamic joystick (left half)
        const z = this.zone;
        z.addEventListener('pointerdown', (e) => {
            if (this.joy) return;
            e.preventDefault(); z.setPointerCapture(e.pointerId);
            this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
            this.base.style.display = 'block';
            this.base.style.left = e.clientX + 'px'; this.base.style.top = e.clientY + 'px';
            this.stick.style.transform = 'translate(-50%,-50%)';
        });
        z.addEventListener('pointermove', (e) => {
            if (!this.joy || e.pointerId !== this.joy.id) return;
            let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
            const len = Math.hypot(dx, dy);
            if (len > R) { this.joy.ox += dx - dx * R / len; this.joy.oy += dy - dy * R / len; dx = dx * R / len; dy = dy * R / len; }   // the base follows the finger
            this.base.style.left = this.joy.ox + 'px'; this.base.style.top = this.joy.oy + 'px';
            this.stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            const mag = Math.hypot(dx, dy);
            this.joyVec = mag > 14 ? [dx / mag, dy / mag] : null;
            const dirX = dx < -16 ? -1 : dx > 16 ? 1 : 0;
            if (virtual.shield) {                                   // moving while shielding = roll
                if (dirX && dirX !== this.dirX) { const m = this.me(); this.pressedAim = true; mouse.worldX = m.x + dirX * 300; mouse.worldY = m.y; this.api.doAction('roll'); this.pressedAim = false; }
                virtual.left = virtual.right = false;
            } else { virtual.left = dirX < 0; virtual.right = dirX > 0; }
            this.dirX = dirX;
            virtual.drop = dy > 46;
            this.api.heldChanged();
        });
        const joyEnd = (e) => {
            if (!this.joy || e.pointerId !== this.joy.id) return;
            this.joy = null; this.joyVec = null; this.dirX = 0; this.base.style.display = 'none';
            virtual.left = virtual.right = virtual.drop = false; this.api.heldChanged();
        };
        z.addEventListener('pointerup', joyEnd); z.addEventListener('pointercancel', joyEnd);

        // ---------------------------------------------------------- outer circle: touching it presses the NEAREST arrow (melee, hold = charge)
        const mx = this.refs.matrix, hit = mx.querySelector('[data-hit]'), ring = mx.querySelector('.tz-ring');
        const nearest = (e) => {
            const r = mx.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
            return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'SIDE_LEFT' : 'SIDE_RIGHT') : (dy < 0 ? 'UP' : 'DOWN');
        };
        let arrow = null;
        const arrowEl = (d) => mx.querySelector(`.tz-dir[data-dir="${d}"]`);
        for (const el of [hit, ring]) {
            el.addEventListener('pointerdown', (e) => {
                if (arrow) return;
                e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId);
                const dir = nearest(e); arrow = { id: e.pointerId, dir, el };
                arrowEl(dir).classList.add('down');
                this.act('attack', dir);
            });
            const up = (e) => { if (!arrow || e.pointerId !== arrow.id) return; arrowEl(arrow.dir).classList.remove('down'); arrow = null; this.api.releaseAction('attack'); };
            el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
        }

        // ---------------------------------------------------------- red centre: jab (spin) / neutral F / directional F; while charging a Core, drag to AIM it
        const main = this.refs.matrix.querySelector('.tz-main');
        const aimEl = this.refs.matrix.querySelector('.tz-aim');
        let g = null;
        const dirButton = (d) => this.refs.matrix.querySelector(`.tz-dir[data-dir="${d}"]`);
        const clearSel = () => { for (const b of this.refs.matrix.querySelectorAll('.tz-dir')) b.classList.remove('sel'); };
        const showAim = (v) => { mouse.touchAim = v || null; if (!aimEl) return; if (!v) { aimEl.classList.remove('on'); return; } aimEl.classList.add('on'); aimEl.style.transform = `translateY(-50%) rotate(${Math.atan2(v[1], v[0])}rad)`; };
        main.addEventListener('pointerdown', (e) => {
            if (g) return;
            e.preventDefault(); e.stopPropagation(); main.setPointerCapture(e.pointerId);
            g = { id: e.pointerId, sx: e.clientX, sy: e.clientY, sel: null, charging: false, timer: 0, aim: null };
            main.classList.add('down');
            g.timer = setTimeout(() => {
                if (!g || g.sel) return;
                g.charging = true; main.classList.add('charging');
                this.act('special', 'NEUTRAL');                       // start charging the neutral F (Core)
                clearSel(); showAim(g.aim);
            }, HOLD_MS);
        });
        main.addEventListener('pointermove', (e) => {
            if (!g || e.pointerId !== g.id) return;
            const dx = e.clientX - g.sx, dy = e.clientY - g.sy, len = Math.hypot(dx, dy);
            const lim = this.geo.lim;                                 // the button can't leave the grid
            const k = len > lim ? lim / len : 1;
            main.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
            if (g.charging) {                                         // the Core is charging: dragging only aims it (never switches move)
                if (len > 10) { g.aim = [dx / len, dy / len]; showAim(g.aim); }
                else { g.aim = null; showAim(null); }
                const near = len > this.geo.d * 0.45 ? (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'SIDE_LEFT' : 'SIDE_RIGHT') : (dy < 0 ? 'UP' : 'DOWN')) : null;
                clearSel(); if (near) dirButton(near).classList.add('sel');          // the closest arrow glows while the Core charges too
                return;
            }
            let sel = null;
            if (len > this.geo.d * 0.45) sel = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'SIDE_LEFT' : 'SIDE_RIGHT') : (dy < 0 ? 'UP' : 'DOWN');
            if (sel !== g.sel) { g.sel = sel; clearSel(); if (sel) dirButton(sel).classList.add('sel'); }
            if (len > 10) g.aim = [dx / len, dy / len]; else g.aim = null;
            mouse.touchAim = g.aim;                                   // the dotted guide shows what the grid is aiming
        });
        const mainEnd = (e) => {
            if (!g || e.pointerId !== g.id) return;
            clearTimeout(g.timer);
            const s = g; g = null;
            main.classList.remove('down', 'charging'); main.style.transform = ''; clearSel(); showAim(null); mouse.touchAim = null;
            if (e.type === 'pointercancel') { if (s.charging) this.api.cancelF(); return; }
            if (s.sel) { this.act('special', s.sel); this.api.releaseAction('special'); }          // directional F move
            else if (s.charging) {                                                                  // release the Core where it was aimed
                this.pressedAim = true; this.setAim('NEUTRAL', s.aim || null); this.api.releaseAction('special'); this.pressedAim = false;
            } else this.act('attack', 'NEUTRAL');                                                  // quick tap: sword spin
        };
        main.addEventListener('pointerup', mainEnd); main.addEventListener('pointercancel', mainEnd);

        // ---------------------------------------------------------- jump
        this.refs.jump.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.refs.jump.classList.add('down'); this.act('jump'); });
        const unj = () => this.refs.jump.classList.remove('down');
        this.refs.jump.addEventListener('pointerup', unj); this.refs.jump.addEventListener('pointercancel', unj);

        // ---------------------------------------------------------- grab: drag to AIM, release to throw the grab (or use / throw an item). It springs back when let go.
        const gb = this.refs.grab, gAim = gb.querySelector('.tz-aim');
        let gg = null;
        const gShow = (v) => { mouse.touchAim = v || null; if (!v) { gAim.classList.remove('on'); return; } gAim.classList.add('on'); gAim.style.transform = `translateY(-50%) rotate(${Math.atan2(v[1], v[0])}rad)`; };
        gb.addEventListener('pointerdown', (e) => {
            if (gg) return;
            e.preventDefault(); e.stopPropagation(); gb.setPointerCapture(e.pointerId);
            gg = { id: e.pointerId, sx: e.clientX, sy: e.clientY, aim: null };
            gb.classList.add('down');
        });
        gb.addEventListener('pointermove', (e) => {
            if (!gg || e.pointerId !== gg.id) return;
            const dx = e.clientX - gg.sx, dy = e.clientY - gg.sy, len = Math.hypot(dx, dy);
            const k = len > 38 ? 38 / len : 1;
            gb.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
            gg.aim = len > 16 ? [dx / len, dy / len] : null;
            gShow(gg.aim);
        });
        const gEnd = (e) => {
            if (!gg || e.pointerId !== gg.id) return;
            const s = gg; gg = null;
            gb.classList.remove('down'); gb.style.transform = ''; gShow(null);
            if (e.type === 'pointercancel' || !s.aim) return;           // a grab only fires when it was aimed, then released
            this.act('grab', 'NEUTRAL', s.aim);
        };
        gb.addEventListener('pointerup', gEnd); gb.addEventListener('pointercancel', gEnd);

        // ---------------------------------------------------------- shield: hold (no drag); joystick left / right while shielding = roll
        const sh = this.refs.shield;
        let sg = null;
        sh.addEventListener('pointerdown', (e) => {
            if (sg) return;
            e.preventDefault(); e.stopPropagation(); sh.setPointerCapture(e.pointerId);
            sg = { id: e.pointerId };
            sh.classList.add('down');
            virtual.shield = true; virtual.left = virtual.right = false; this.dirX = 0;
            this.api.heldChanged();
        });
        const shEnd = (e) => {
            if (!sg || (e && e.pointerId !== sg.id)) return;
            sg = null; sh.classList.remove('down');
            virtual.shield = false; this.api.heldChanged();
        };
        sh.addEventListener('pointerup', shEnd); sh.addEventListener('pointercancel', shEnd);

        // keep the page from scrolling / zooming while playing
        this.hud.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    }
}
