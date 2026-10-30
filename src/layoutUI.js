// Full-screen mobile layout editor. It opens as its own screen on top of everything (not a box):
// drag a control to move it, tap a button to resize it, then Save or Cancel.
import { copyLayout, saveLayout, DEFAULT_LAYOUT } from './layout.js';
import { buildControls, positionControls, matrixSize, MATRIX_MIN, MATRIX_MAX } from './touch.js';

const SIZED = ['matrix', 'jump', 'grab', 'shield'];
const NAMES = { matrix: 'Aim grid (scales around its middle)', jump: 'Jump', grab: 'Grab (drag to aim)', shield: 'Shield' };

export class LayoutEditor {
    constructor({ root }) {
        this.root = root;
        this.el = document.createElement('div');
        this.el.className = 'le-screen';
        this.el.hidden = true;
        this.el.innerHTML = `
            <div class="le-bar">
                <button class="le-btn le-ghost" data-cancel>Cancel</button>
                <div class="le-title">Edit mobile layout<small>Drag a control to move it. Tap a button (the red centre for the grid) to resize it.</small></div>
                <button class="le-btn le-ghost" data-reset>Reset</button>
                <button class="le-btn" data-save>Save</button>
            </div>
            <div class="le-stage" data-stage>
                <div class="le-zone"><span>Dynamic joystick area<br><small>(the whole left side)</small></span></div>
                <div class="le-menu">MENU</div>
            </div>
            <div class="le-size" data-size hidden>
                <label><span data-sizelabel>Size</span><input type="range" min="44" max="150" step="2" data-slider></label>
                <b data-sizeval></b>
            </div>`;
        root.appendChild(this.el);
        this.stage = this.el.querySelector('[data-stage]');
        this.refs = buildControls(this.stage);
        this.sel = null; this.cfg = null; this.drag = null; this.onClose = null;

        const stop = (e) => e.stopPropagation();
        this.el.addEventListener('keydown', stop);
        this.el.querySelector('[data-cancel]').addEventListener('click', () => this.close(false));
        this.el.querySelector('[data-save]').addEventListener('click', () => this.close(true));
        this.el.querySelector('[data-reset]').addEventListener('click', () => { this.cfg = JSON.parse(JSON.stringify(DEFAULT_LAYOUT)).mobile; this.sel = null; this.layout(); });
        this.slider = this.el.querySelector('[data-slider]');
        this.slider.addEventListener('input', () => { if (this.sel) { this.cfg[this.sel].s = +this.slider.value; this.layout(); } });
        window.addEventListener('resize', () => { if (!this.el.hidden) this.layout(); });

        // the grid's inner buttons are inert in the editor: the whole control drags as one
        for (const k of ['matrix', 'jump', 'grab', 'shield']) {
            const el = this.refs[k];
            el.classList.add('le-ctl');
            el.addEventListener('pointerdown', (e) => this.down(k, e), true);
        }
        this.stage.addEventListener('pointermove', (e) => this.move(e));
        this.stage.addEventListener('pointerup', (e) => this.up(e));
        this.stage.addEventListener('pointercancel', (e) => this.up(e));
        this.stage.addEventListener('pointerdown', (e) => { if (e.target === this.stage || e.target.closest('.le-zone')) { this.sel = null; this.layout(); } });
    }

    open(onClose) {
        this.onClose = onClose || null;
        this.cfg = copyLayout().mobile;
        this.sel = null;
        this.el.hidden = false;
        document.body.classList.add('le-open');
        this.layout();
    }
    close(save) {
        if (save) { const cur = copyLayout(); cur.mobile = this.cfg; saveLayout(cur); }
        this.el.hidden = true;
        document.body.classList.remove('le-open');
        if (this.onClose) this.onClose(save);
    }

    layout() {
        const w = this.stage.clientWidth, h = this.stage.clientHeight;
        positionControls(this.refs, this.cfg, w, h);
        for (const k of ['matrix', ...SIZED]) this.refs[k].classList.toggle('le-sel', this.sel === k);
        const sz = this.el.querySelector('[data-size]');
        const sized = this.sel && SIZED.includes(this.sel);
        sz.hidden = !this.sel;
        if (this.sel) {
            this.el.querySelector('[data-sizelabel]').textContent = NAMES[this.sel];
            this.slider.hidden = !sized; this.slider.parentElement.classList.toggle('le-noslider', !sized);
            const isM = this.sel === 'matrix', cur = isM ? matrixSize(this.cfg) : this.cfg[this.sel].s;
            this.slider.min = isM ? MATRIX_MIN : 44; this.slider.max = isM ? MATRIX_MAX : 150;
            this.slider.value = cur; this.el.querySelector('[data-sizeval]').textContent = Math.round(cur) + ' px';
        }
    }

    down(k, e) {
        e.preventDefault(); e.stopPropagation();
        const r = this.stage.getBoundingClientRect();
        const c = this.cfg[k];
        this.drag = { k, id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: c.x, oy: c.y, moved: false, w: r.width, h: r.height };
        this.stage.setPointerCapture(e.pointerId);
    }
    move(e) {
        const d = this.drag; if (!d || e.pointerId !== d.id) return;
        const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
        if (!d.moved && Math.hypot(dx, dy) < 6) return;
        d.moved = true;
        const half = (d.k === 'matrix' ? matrixSize(this.cfg) : this.cfg[d.k].s) / 2;
        const c = this.cfg[d.k];
        c.x = Math.min(1 - half / d.w, Math.max(half / d.w, d.ox + dx / d.w));
        c.y = Math.min(1 - half / d.h, Math.max(half / d.h, d.oy + dy / d.h));
        this.sel = d.k;
        this.layout();
    }
    up(e) {
        const d = this.drag; if (!d || e.pointerId !== d.id) return;
        this.drag = null;
        if (!d.moved) { this.sel = d.k; this.layout(); }    // a tap selects (and shows the size slider)
    }
}
