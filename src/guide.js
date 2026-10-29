// Guided tutorial: plays in a real training match. Each step watches the game state and advances
// by itself when you do what it asks. Backspace = previous step, Enter = skip, Esc = leave.
import { S, p1, orbs, startMatchSequence } from './core.js';
import { keyLabel } from './controls.js';

const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const K = (a) => `<kbd>${esc(keyLabel(a))}</kbd>`;

const KIND = { JAB: 'neutral', UP: 'up', DOWN: 'down', SIDE_LEFT: 'side', SIDE_RIGHT: 'side' };

/** each step: title, text(), init() -> fresh per-visit state, check(st) -> true when done, progress(st) -> optional "2 / 4" */
const STEPS = [
    {
        title: 'Walk',
        text: () => `Walk left and right with ${K('left')} and ${K('right')}.`,
        init: () => ({ d: 0, x: p1.x }),
        check(st) { st.d += Math.abs(p1.x - st.x); st.x = p1.x; return st.d > 400; },
        progress: (st) => `${Math.min(100, Math.round(st.d / 4))}%`,
    },
    {
        title: 'Double jump',
        text: () => `Press ${K('jump')} twice in a row. You have 4 jumps in the air, and the ground refills them.`,
        init: () => ({}),
        check: () => !p1.grounded && p1.jumpsLeft <= p1.maxJumps - 2,
    },
    {
        title: 'Grab a ledge',
        text: () => `Walk off the edge of the stage and drift toward it to hang on the ledge. ${K('jump')} jumps off again. (One fighter per ledge, and 3 s is the most you can hang.)`,
        init: () => ({}),
        check: () => p1.isHanging,
    },
    {
        title: 'J attack: all four aims',
        text: () => `Slash with ${K('attack')} while aiming <b>neutral</b> (small centre circle, or hold ${K('neutral')}), <b>side</b>, <b>up</b> and <b>down</b>. The aim matrix at the bottom shows what you are pointing at.`,
        init: () => ({ got: new Set(), serial: p1.attackSerial }),
        check(st) {
            if (p1.attackSerial !== st.serial) {
                st.serial = p1.attackSerial;
                if (!(p1.activeMove && p1.activeMove.type === 'BLINK') && KIND[p1.attackKind]) st.got.add(KIND[p1.attackKind]);
            }
            return st.got.size >= 4;
        },
        progress: (st) => `${st.got.size} / 4 (${[...st.got].join(', ') || 'none yet'})`,
    },
    {
        title: 'Dash-grab',
        text: () => `Press ${K('grab')} to dash-grab. Grab beats shield, but nearly every other move beats a grab.`,
        init: () => ({}),
        check: () => p1.isGrabDashing && !p1.suplexPending,
    },
    {
        title: 'Shield',
        text: () => `Hold ${K('shield')} to shield. It counters everything except a grab.`,
        init: () => ({}),
        check: () => p1.isShielding,
    },
    {
        title: 'Shield roll',
        text: () => `While shielding, <b>scroll the mouse wheel</b> (or press ${K('roll')}) to roll toward your cursor. 2 s cooldown, and it stops at the ledge.`,
        init: () => ({}),
        check: () => p1.isRolling,
    },
    {
        title: 'Luminary Core',
        text: () => `Hold ${K('special')} to charge a Luminary Core, then release. It flies straight along your aim (no homing).`,
        init: () => ({}),
        check: () => p1.specialKind === 'CORE',
    },
    {
        title: 'Full-charge Core',
        text: () => `Hold ${K('special')} for about a second until the orb turns <b>purple</b>, then release. Bigger, stronger, bigger explosion.`,
        init: () => ({ seen: new WeakSet(orbs.filter(o => o.owner === p1)) }),
        check(st) {
            for (const o of orbs) {
                if (o.owner !== p1 || st.seen.has(o)) continue;
                st.seen.add(o);
                if (o.charge >= 1) return true;
            }
            return false;
        },
    },
    {
        title: 'Blink Slash',
        text: () => `Aim to the <b>side</b>, then <b>tap</b> ${K('special')} (do not hold it). You teleport and slash.`,
        init: () => ({}),
        check: () => !!(p1.activeMove && p1.activeMove.type === 'BLINK'),
    },
    {
        title: 'Rising Spiral',
        text: () => `Aim <b>up</b> and tap ${K('special')}. A multi-hit rise that costs no jumps. If you miss the stage you get extra lag.`,
        init: () => ({}),
        check: () => p1.spiralT > 0,
    },
    {
        title: 'Suplex',
        text: () => `Stand on the ground within about half the stage of the dummy, aim <b>down</b> and tap ${K('special')}. It homes in, grabs, carries them up and slams them down.`,
        init: () => ({}),
        check: () => p1.suplexT > 0,
    },
    {
        title: 'Headbutt dive',
        text: () => `Jump, aim <b>down</b> and tap ${K('special')} in the air. You dive with several hits, then slam the floor.`,
        init: () => ({}),
        check: () => p1.diving,
    },
];

export class Guide {
    constructor({ root, isBlocked }) {
        this.isBlocked = isBlocked || (() => false);
        this.active = false;
        this.i = 0;
        this.st = null;
        this.doneAt = 0;
        this.finished = false;

        this.el = document.createElement('div');
        this.el.className = 'lm-guide lm-hidden';
        this.el.innerHTML = `
            <div class="lm-g-top"><span class="lm-g-step"></span><span class="lm-g-bar"><i></i></span><button class="lm-g-x" data-g-exit aria-label="Exit tutorial">✕</button></div>
            <div class="lm-g-title"></div>
            <div class="lm-g-text"></div>
            <div class="lm-g-prog"></div>
            <div class="lm-g-keys"><kbd>Backspace</kbd> back <span>·</span> <kbd>Enter</kbd> skip <span>·</span> <kbd>Esc</kbd> exit</div>`;
        root.appendChild(this.el);
        this.el.querySelector('[data-g-exit]').addEventListener('click', (e) => { e.stopPropagation(); this.stop(); });

        window.addEventListener('keydown', (e) => {
            if (!this.active || this.isBlocked()) return;
            if (e.code === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) this.go(this.i - 1); }
            else if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) this.go(this.i + 1); }
            else if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.stop(); }
        }, true);
    }

    start() {
        this.active = true;
        this.finished = false;
        this.i = 0;
        this.st = null;
        this.el.classList.remove('lm-hidden');
        startMatchSequence('training');          // a real training match: you, plus a dummy to hit
        this.render();
    }
    stop() {
        this.active = false;
        this.el.classList.add('lm-hidden');
    }

    go(i) {
        if (i < 0) i = 0;
        this.doneAt = 0;
        if (i >= STEPS.length) { this.finished = true; this.i = STEPS.length; }
        else { this.finished = false; this.i = i; }
        this.st = null;
        this.render();
    }

    render() {
        const bar = this.el.querySelector('.lm-g-bar i');
        const set = (sel, html) => { this.el.querySelector(sel).innerHTML = html; };
        if (this.finished) {
            set('.lm-g-step', 'DONE');
            bar.style.width = '100%';
            set('.lm-g-title', 'You know everything');
            set('.lm-g-text', `Keep practising on the dummy, or press ${'<kbd>Enter</kbd>'} to close this. Reopen the tutorial any time with ${K('tutorial')}.`);
            set('.lm-g-prog', '');
            this.el.classList.remove('ok');
            return;
        }
        const s = STEPS[this.i];
        set('.lm-g-step', `STEP ${this.i + 1} / ${STEPS.length}`);
        bar.style.width = `${(this.i / STEPS.length) * 100}%`;
        set('.lm-g-title', esc(s.title));
        set('.lm-g-text', s.text());
        set('.lm-g-prog', '');
        this.el.classList.remove('ok');
    }

    /** called every frame by main.js */
    tick() {
        if (!this.active) return;
        if (this.finished) return;
        if (S.gameState !== 'playing') return;      // countdown / menus: nothing to watch yet
        const s = STEPS[this.i];
        if (this.doneAt) {
            if (performance.now() - this.doneAt > 750) this.go(this.i + 1);
            return;
        }
        if (!this.st) this.st = s.init();
        if (s.check(this.st)) {
            this.doneAt = performance.now();
            this.el.classList.add('ok');
            this.el.querySelector('.lm-g-prog').textContent = '✓ Nice!';
        } else if (s.progress) {
            this.el.querySelector('.lm-g-prog').textContent = s.progress(this.st);
        }
    }
}

// the tutorial key labels are rebuilt when a step is rendered, so a rebinding shows up on the next step
