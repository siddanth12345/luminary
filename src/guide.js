// Guided tutorial: plays in a real training match. Each step watches the game state and advances
// by itself when you do what it asks. Backspace = previous step, Enter = skip, Esc = leave.
import { S, p1, orbs, startMatchSequence } from './core.js';
import { keyLabel } from './controls.js';
import { touchMode } from './layout.js';
import { items, spawnItem } from './core.js';
import { charOf } from './characters.js';

const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const K = (a) => `<kbd>${esc(keyLabel(a))}</kbd>`;

const KIND = { JAB: 'neutral', UP: 'up', DOWN: 'down', SIDE_LEFT: 'side', SIDE_RIGHT: 'side' };

/** each step: title, text(), init() -> fresh per-visit state, check(st) -> true when done, progress(st) -> optional "2 / 4" */
const STEPS = [
    {
        title: 'Walk',
        text: (m) => m ? `Touch the <b>left half</b> of the screen and drag left and right: a joystick appears under your thumb.` : `Walk left and right with ${K('left')} and ${K('right')}.`,
        init: () => ({ d: 0, x: p1.x }),
        check(st) { st.d += Math.abs(p1.x - st.x); st.x = p1.x; return st.d > 400; },
        progress: (st) => `${Math.min(100, Math.round(st.d / 4))}%`,
    },
    {
        title: 'Double jump',
        text: (m) => `${m ? 'Tap <b>Jump</b>' : 'Press ' + K('jump')} twice in a row. You have ${charOf(p1.char).jumps} jumps in the air (it depends on your character), and the ground refills them.`,
        init: () => ({}),
        check: () => !p1.grounded && p1.jumpsLeft <= p1.maxJumps - 2,
    },
    {
        title: 'Grab a ledge',
        text: (m) => `Walk off the edge of the stage and drift toward it to hang on the ledge. ${m ? 'Tap <b>Jump</b>' : K('jump')} jumps off again. (One fighter per ledge, and 3 s is the most you can hang.)`,
        init: () => ({}),
        check: () => p1.isHanging,
    },
    {
        title: 'Melee: all four aims',
        text: (m) => m ? `Use the aim grid: <b>tap the red centre</b> for the neutral sword spin, and <b>tap the side, up and down arrows</b> for those slashes.`
            : `Attack with ${K('attack')} while aiming <b>neutral</b> (small centre circle, or hold ${K('neutral')}: a sword spin that launches up), <b>side</b>, <b>up</b> and <b>down</b>. The aim matrix at the bottom shows your aim.`,
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
        title: 'Charge a melee',
        text: (m) => m ? `<b>Press and hold</b> a side, up or down arrow on the aim grid. You glow white while it charges (1.7 s) and glisten in your colour when full. Let go to swing for up to +30% damage and knockback.`
            : `<b>Press and hold</b> ${K('attack')} while aiming side, up or down (not neutral). You glow white while it charges (1.7 s) and glisten in your colour when full. Release for up to +30% damage and knockback.`,
        init: () => ({}),
        check: () => p1.meleeCharge >= 100,
        progress: () => `${Math.min(100, Math.round(p1.meleeCharge / 1.02))}%`,
    },
    {
        title: 'Grab (aimed)',
        text: (m) => m ? `Press the <b>Grab</b> button, <b>drag</b> toward where you want to grab and <b>release</b>. It snaps back to its spot. A grab only fires once it is aimed and released. It beats shield; nearly everything else beats it.`
            : `Aim with the mouse and press ${K('grab')} to grab toward your cursor. It beats shield; nearly everything else beats it.`,
        init: () => ({}),
        check: () => p1.isGrabDashing && !p1.suplexPending,
    },
    {
        title: 'Pick up an item',
        text: (m) => `A ball just dropped in. Walk to it and ${m ? '<b>aim a grab</b> at it' : 'grab it with ' + K('grab')}. Items are picked up and used with the grab (balloons use Jump).`,
        init: () => { spawnItem('BALL'); const b = items[items.length - 1]; b.x = p1.x + (p1.facing || 1) * 260; return {}; },
        check: () => !!p1.heldItem,
    },
    {
        title: 'Throw it',
        text: (m) => `Now ${m ? 'drag and release the <b>Grab</b> button' : 'aim and press ' + K('grab')} to throw it. The ball does 10 damage, bounces back off whoever it hits and can be thrown twice.`,
        init: () => ({ had: !!p1.heldItem }),
        check: (st) => st.had && !p1.heldItem,
    },
    {
        title: 'Shield',
        text: (m) => `Hold ${m ? 'the <b>Shield</b> button' : K('shield')} to shield. It counters everything except a grab.`,
        init: () => ({}),
        check: () => p1.isShielding,
    },
    {
        title: 'Shield roll',
        text: (m) => `While shielding, ${m ? 'push the joystick <b>left or right</b>' : '<b>scroll the mouse wheel</b> (or press ' + K('roll') + ')'} to roll. 2 s cooldown, and it stops at the ledge.`,
        init: () => ({}),
        check: () => p1.isRolling,
    },
    {
        title: 'CBG Core',
        text: (m) => m ? `<b>Hold the red centre</b> to charge a CBG Core. While it charges you can <b>drag the red button</b> to aim it, then release to fire.` : `Hold ${K('special')} to charge a CBG Core, then release. It flies straight along your aim (no homing).`,
        init: () => ({}),
        check: () => p1.specialKind === 'CORE',
    },
    {
        title: 'Full-charge Core',
        text: (m) => `Hold ${m ? 'the red centre' : K('special')} for about a second until the orb turns <b>purple</b>, then release. Bigger, stronger, bigger explosion.`,
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
        text: (m) => m ? `<b>Drag the red centre onto the side arrow</b> and release. You teleport and slash.` : `Aim to the <b>side</b>, then <b>tap</b> ${K('special')} (do not hold it). You teleport and slash.`,
        init: () => ({}),
        check: () => !!(p1.activeMove && p1.activeMove.type === 'BLINK'),
    },
    {
        title: 'Rising Spiral',
        text: (m) => `${m ? '<b>Drag the red centre onto the up arrow</b>' : 'Aim <b>up</b> and tap ' + K('special')}. A multi-hit rise that costs no jumps. If you miss the stage you get extra lag.`,
        init: () => ({}),
        check: () => p1.spiralT > 0,
    },
    {
        title: 'Suplex',
        text: (m) => `Stand on the ground within about half the stage of the dummy, ${m ? '<b>drag the red centre onto the down arrow</b>' : 'aim <b>down</b> and tap ' + K('special')}. It homes in, grabs, carries them up and slams them down.`,
        init: () => ({}),
        check: () => p1.suplexT > 0,
    },
    {
        title: 'Headbutt dive',
        text: (m) => `Jump, then ${m ? '<b>drag the red centre onto the down arrow</b>' : 'aim <b>down</b> and tap ' + K('special')} in the air. You dive with several hits, then slam the floor.`,
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
        set('.lm-g-text', s.text(touchMode()));
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
