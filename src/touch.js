// Mobile controls. Left half of the screen = dynamic joystick. Right side = the aim grid
// (red centre + four black buttons), jump and shield buttons. Everything funnels into the
// same doAction / releaseAction path as the keyboard, so online guests work too.
//
//   red centre   tap = jab (neutral J) | hold 0.4 s = neutral F (Core) | drag onto a black button = that F move
//   black buttons tap = J attack up / left / right / down
//   shield       hold = shield | drag in a direction = dash-grab that way | joystick left/right while shielding = roll
import { S, mouse, fighters, p1 } from './core.js';
import { virtual } from './controls.js';
import { getLayout, touchMode, onLayout } from './layout.js';

export const MATRIX_BASE = 230;
export const matrixSize = () => Math.max(150, Math.min(MATRIX_BASE, Math.min(window.innerWidth, window.innerHeight) * 0.56));

const DIRS = { UP: [0, -1], DOWN: [0, 1], SIDE_LEFT: [-1, 0], SIDE_RIGHT: [1, 0] };
const HOLD_MS = 400;

/** build the control elements inside `host`; returns refs. Used by the game and by the layout editor. */
export function buildControls(host) {
    host.insertAdjacentHTML('beforeend', `
        <div class="tz-matrix" data-k="matrix">
            <div class="tz-ring"></div>
            <button class="tz-b tz-dir" data-dir="UP" aria-label="Up attack">↑</button>
            <button class="tz-b tz-dir" data-dir="SIDE_LEFT" aria-label="Left attack">←</button>
            <button class="tz-b tz-dir" data-dir="SIDE_RIGHT" aria-label="Right attack">→</button>
            <button class="tz-b tz-dir" data-dir="DOWN" aria-label="Down attack">↓</button>
            <button class="tz-b tz-main" data-main aria-label="Neutral attack">J<small>hold F</small></button>
        </div>
        <button class="tz-b tz-round tz-jump" data-k="jump">JUMP</button>
        <button class="tz-b tz-round tz-shield" data-k="shield">SHIELD</button>`);
    const q = (s) => host.querySelector(s);
    return { matrix: q('[data-k="matrix"]'), jump: q('[data-k="jump"]'), shield: q('[data-k="shield"]'), host };
}

/** place the controls according to a layout (fractions of the host size) */
export function positionControls(refs, cfg, w = window.innerWidth, h = window.innerHeight) {
    const M = matrixSize();
    const place = (el, c, size) => {
        el.style.width = el.style.height = size + 'px';
        const x = Math.min(w - size / 2, Math.max(size / 2, c.x * w)), y = Math.min(h - size / 2, Math.max(size / 2, c.y * h));
        el.style.left = (x - size / 2) + 'px'; el.style.top = (y - size / 2) + 'px';
    };
    place(refs.matrix, cfg.matrix, M);
    for (const k of ['jump', 'shield']) place(refs[k], cfg[k], cfg[k].s);
    // grid internals
    const sub = refs.matrix, d = M * 0.22, off = M * 0.31, c = M / 2;
    const put = (el, dx, dy, dd) => { el.style.width = el.style.height = dd + 'px'; el.style.left = (c + dx - dd / 2) + 'px'; el.style.top = (c + dy - dd / 2) + 'px'; };
    for (const b of sub.querySelectorAll('.tz-dir')) { const v = DIRS[b.dataset.dir]; put(b, v[0] * off, v[1] * off, d); }
    put(sub.querySelector('.tz-main'), 0, 0, M * 0.26);
    return { M, off, d };
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

        // ---------------------------------------------------------- black direction buttons: J attack
        for (const b of this.refs.matrix.querySelectorAll('.tz-dir')) {
            b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('down'); this.act('attack', b.dataset.dir); });
            const up = () => b.classList.remove('down');
            b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
        }

        // ---------------------------------------------------------- red centre: jab / neutral F / directional F
        const main = this.refs.matrix.querySelector('.tz-main');
        let g = null;
        const dirButton = (d) => this.refs.matrix.querySelector(`.tz-dir[data-dir="${d}"]`);
        const clearSel = () => { for (const b of this.refs.matrix.querySelectorAll('.tz-dir')) b.classList.remove('sel'); };
        main.addEventListener('pointerdown', (e) => {
            if (g) return;
            e.preventDefault(); e.stopPropagation(); main.setPointerCapture(e.pointerId);
            g = { id: e.pointerId, sx: e.clientX, sy: e.clientY, sel: null, charging: false, timer: 0 };
            main.classList.add('down');
            g.timer = setTimeout(() => {
                if (!g || g.sel) return;
                g.charging = true; main.classList.add('charging');
                this.act('special', 'NEUTRAL');                       // start charging the neutral F (Core)
            }, HOLD_MS);
        });
        main.addEventListener('pointermove', (e) => {
            if (!g || e.pointerId !== g.id) return;
            const dx = e.clientX - g.sx, dy = e.clientY - g.sy, len = Math.hypot(dx, dy);
            const lim = this.geo.off;
            const k = len > lim ? lim / len : 1;
            main.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
            let sel = null;
            if (len > this.geo.d * 0.45) sel = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'SIDE_LEFT' : 'SIDE_RIGHT') : (dy < 0 ? 'UP' : 'DOWN');
            if (sel !== g.sel) {
                g.sel = sel; clearSel(); if (sel) dirButton(sel).classList.add('sel');
                if (sel && g.charging) { g.charging = false; main.classList.remove('charging'); this.api.cancelF(); }
            }
        });
        const mainEnd = (e) => {
            if (!g || e.pointerId !== g.id) return;
            clearTimeout(g.timer);
            const s = g; g = null;
            main.classList.remove('down', 'charging'); main.style.transform = ''; clearSel();
            if (e.type === 'pointercancel') { if (s.charging) this.api.cancelF(); return; }
            if (s.sel) { this.act('special', s.sel); this.api.releaseAction('special'); }          // directional F move
            else if (s.charging) { this.pressedAim = true; this.setAim('NEUTRAL'); this.api.releaseAction('special'); this.pressedAim = false; }   // release the Core
            else this.act('attack', 'NEUTRAL');                                                    // quick tap: jab
        };
        main.addEventListener('pointerup', mainEnd); main.addEventListener('pointercancel', mainEnd);

        // ---------------------------------------------------------- jump
        this.refs.jump.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.refs.jump.classList.add('down'); this.act('jump'); });
        const unj = () => this.refs.jump.classList.remove('down');
        this.refs.jump.addEventListener('pointerup', unj); this.refs.jump.addEventListener('pointercancel', unj);

        // ---------------------------------------------------------- shield: hold, drag = grab, joystick move = roll
        const sh = this.refs.shield;
        let sg = null;
        sh.addEventListener('pointerdown', (e) => {
            if (sg) return;
            e.preventDefault(); e.stopPropagation(); sh.setPointerCapture(e.pointerId);
            sg = { id: e.pointerId, sx: e.clientX, sy: e.clientY, grabbed: false };
            sh.classList.add('down');
            virtual.shield = true; virtual.left = virtual.right = false; this.dirX = 0;
            this.api.heldChanged();
        });
        sh.addEventListener('pointermove', (e) => {
            if (!sg || e.pointerId !== sg.id) return;
            const dx = e.clientX - sg.sx, dy = e.clientY - sg.sy, len = Math.hypot(dx, dy);
            const k = len > 34 ? 34 / len : 1;
            sh.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
            if (!sg.grabbed && len > 44) {                                  // dragged: dash-grab that way
                sg.grabbed = true;
                virtual.shield = false; this.api.heldChanged();
                const dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? [-1, 0] : [1, 0]) : (dy < 0 ? [0, -1] : [0, 1]);
                this.me().isShielding = false;                              // drop the shield this instant so the grab can start
                this.act('grab', 'NEUTRAL', dir);
            }
        });
        const shEnd = () => {
            if (!sg) return;
            sg = null; sh.classList.remove('down'); sh.style.transform = '';
            virtual.shield = false; this.api.heldChanged();
        };
        sh.addEventListener('pointerup', shEnd); sh.addEventListener('pointercancel', shEnd);

        // keep the page from scrolling / zooming while playing
        this.hud.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    }
}
