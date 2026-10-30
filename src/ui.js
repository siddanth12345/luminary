// Tutorial + controls settings. Both are plain DOM modals built here; styles live in ui/style.css (.lm-*).
import { S } from './core.js';
import { Guide } from './guide.js';
import { getLayout, setMode } from './layout.js';
import { getGfx, setGfx } from './gfx.js';
import { ACTIONS, bindings, keyLabel, codeName, setBinding, resetBindings } from './controls.js';

const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** pages are functions so key names always show the player's current bindings */
const PAGES = [
    {
        title: 'The Goal',
        html: (k) => `
            <div class="lm-guidecta"><div><b>Want to learn by doing?</b><br><span>Play the tutorial inside the map: every step asks you to do one thing, and moves on by itself when you do it. <kbd>Backspace</kbd> goes back a step, <kbd>Enter</kbd> skips one, <kbd>${k('fullscreen')}</kbd> toggles fullscreen.</span></div>
                <button class="lm-btn" data-start-guide>▶ Start guided tutorial</button></div>
            <p class="lm-lead">Knock the bot off the stage. Reach <b>250%</b> damage and you are KO'd instantly. Everyone has 3 stocks (custom matches can use a 1 to 10 minute kill timer instead).</p>
            <div class="lm-grid">
                <div class="lm-card"><h4>Aim matrix</h4>
                    <p>Your mouse is measured <b>from your fighter</b>. Inside the small centre circle it reads <b>NEUTRAL</b>; outside it reads <b>UP / DOWN / SIDE</b>. The matrix at the bottom of the screen shows what you are aiming. Hold <kbd>${k('neutral')}</kbd> to force NEUTRAL without moving the mouse.</p></div>
                <div class="lm-card"><h4>Camera</h4>
                    <p>The camera frames both fighters and zooms in when you are close, out when you are far apart (never past the whole map).</p></div>
                <div class="lm-card"><h4>Damage</h4>
                    <p>The higher your %, the farther every hit launches you. Moves have been tuned to be low-damage: jabs 6, slashes 8 to 10, Suplex 14, Headbutt 2 per dive hit and 15 for the slam, Core 4 to 20.</p></div>
                <div class="lm-card"><h4>Practice</h4>
                    <p>Pick <b>Training Mode</b> on the start screen for a dummy that takes knockback in every direction and never fights back.</p></div>
            </div>`,
    },
    {
        title: 'Move & Ledges',
        html: (k) => `
            <div class="lm-grid">
                <div class="lm-card"><h4>Walk &amp; jump</h4>
                    <p><kbd>${k('left')}</kbd> / <kbd>${k('right')}</kbd> walk. <kbd>${k('jump')}</kbd> jumps (you have <b>3 to 5 jumps</b> depending on your character, refilled on the ground or a ledge).</p></div>
                <div class="lm-card"><h4>Move lag</h4>
                    <p>After <b>any</b> move you wait <b>0.7 s</b> before the next one. You can always walk, and you can jump again after <b>0.3 s</b>.</p></div>
                <div class="lm-card"><h4>Ledges</h4>
                    <p>Drift near the stage edge and you grab the ledge (a big magnet, with brief invincibility). <kbd>${k('jump')}</kbd> jumps off it.</p></div>
                <div class="lm-card"><h4>Ledge rules</h4>
                    <ul><li>One fighter per ledge: if someone grabs a ledge you are on, <b>you are kicked off</b> and can't grab a ledge for <b>3 s</b>.</li>
                    <li>Stay on a ledge for <b>3 s</b> and you are kicked off for <b>4 s</b>.</li></ul></div>
            </div>`,
    },
    {
        title: 'Attacks',
        html: (k) => `
            <div class="lm-grid">
                <div class="lm-card"><h4>Melee · PC <kbd>${k('attack')}</kbd> · Mobile: aim grid</h4>
                    <p>A slash chosen by your aim (PC: mouse position; mobile: which arrow you tap). The hitbox is only live during the swing. <b>Hold</b> a side, up or down melee to charge it (1.7 s, you glow white, then glisten): up to +30% damage and knockback on release.</p>
                    <table class="lm-table"><tr><th>Aim</th><th>Move</th></tr>
                        <tr><td>Neutral</td><td>Sword spin all the way around (ground or air), knocks up only; can't be charged</td></tr><tr><td>Side</td><td>Side slash</td></tr>
                        <tr><td>Up</td><td>Up slash</td></tr><tr><td>Down</td><td>Down strike (launches on the ground, spikes in the air)</td></tr></table></div>
                <div class="lm-card"><h4>Grab · PC <kbd>${k('grab')}</kbd> · Mobile: Grab button</h4>
                    <p>PC: aim with the mouse, press grab. Mobile: <b>drag the Grab button</b> toward your target and <b>release</b> (it snaps back; a grab only fires once aimed and released). Grab <b>beats shield</b>, loses to nearly everything else, and its knockback is 0.7x a melee and grows with damage. It also picks up and throws items.</p></div>
                <div class="lm-card"><h4>Items (custom matches)</h4>
                    <p>Grab an item to pick it up or use it. <b>Ball</b>: throw for 10 damage, bounces back, 2 throws. <b>Strawberry</b>: heals 30%. <b>Balloon</b>: 7 jumps (Jump); a melee hit pops it and floats the victim for 2 s. <b>Firestick</b>: 5x melee reach, shrinks 0.5 per hit; thrown like a spear it pins its victim for 15 damage until it lands. <b>Clock</b>: throw it, and after 1 s a bubble slows orbs and items inside to 0.3x for 15 s (never the fighters).</p></div>
            </div>`,
    },
    {
        title: 'F Specials',
        html: (k) => `
            <p class="lm-lead"><kbd>${k('special')}</kbd> is your special. <b>Hold it</b> (mobile: hold the red centre, and you can drag it to aim while it charges) (or aim neutral) and you charge a CBG Core. <b>Tap it</b> (released within 0.5 s) with your aim off-centre and you get a variant for that direction.</p>
            <table class="lm-table lm-wide">
                <tr><th>Aim</th><th>Move</th><th>What it does</th></tr>
                <tr><td>Neutral / hold</td><td><b>CBG Core</b></td><td>Charge up to 1.05 s. Release fires a slowish orb in a straight line at your cursor (no homing). Full charge: bigger orb, more damage, bigger explosion, and it turns <b>purple</b> (blue fighter) or <b>orange</b> (red fighter). Walk at 1.5x speed while charging.</td></tr>
                <tr><td>Side</td><td><b>Blink Slash</b></td><td>Teleport 220 units and slash. Great for edgeguarding.</td></tr>
                <tr><td>Up</td><td><b>Rising Spiral</b></td><td>Multi-hit rise for recovery. Costs no jumps. Extra lag if you miss the stage.</td></tr>
                <tr><td>Down, on the ground</td><td><b>Suplex</b></td><td>A grab move: dash forward (it <b>homes in</b> on an opponent within 0.45 of the stage length; with nobody in range it is a blank dash), and if you catch them you carry them up and slam them down for 14 damage. It is a grab, so everything that beats a grab beats it (and it beats shields). Reaching the top of the map cancels it. No cooldown or get-up afterwards.</td></tr>
                <tr><td>Down, in the air</td><td><b>Headbutt</b></td><td>Dive down hitting several times on the way (2 damage each, same size as the Spiral), then slam the floor for 15 damage and a stun wave 1/8 of the stage wide.</td></tr>
            </table>
            <div class="lm-grid">
                <div class="lm-card"><h4>Air limit</h4><p>Only <b>2 F moves in the air</b>. Touch the ground to get them back (the ledge does not). The HUD shows <i>AIR F</i>.</p></div>
                <div class="lm-card"><h4>Cooldowns &amp; recovery</h4><p>Core, Blink, Spiral and Headbutt each have their own cooldown (the Suplex has none). After a Headbutt you stay frozen for 0.3 s while you get up (not a stun, no damage).</p></div>
            </div>`,
    },
    {
        title: 'Shield & Roll',
        html: (k) => `
            <div class="lm-grid">
                <div class="lm-card"><h4>Shield · hold <kbd>${k('shield')}</kbd></h4>
                    <p>Blocks and <b>counters everything except a grab</b>: whoever hit it is stunned for 0.5 s. It drains while held and breaks (you get dizzy) when empty, and each blocked hit costs shield.</p></div>
                <div class="lm-card"><h4>Roll · shield + scroll wheel (or <kbd>${k('roll')}</kbd>)</h4>
                    <p>Only possible <b>while shielding</b>. A fast, invincible roll toward your cursor, <b>2 s cooldown</b>. It can't carry you over the void: it stops at the ledge.</p></div>
                <div class="lm-card"><h4>Stun &amp; freeze</h4>
                    <p><b>Stun</b> (0.5 s): you can't act or move. Caused by the Headbutt's floor slam, and by running into a counter.</p>
                    <p><b>Freeze</b> (0.3 s): the get-up after a Headbutt.</p></div>
            </div>`,
    },
    {
        title: 'Counters',
        html: () => `
            <p class="lm-lead">When two moves meet, the one that <b>counters</b> the other wins and the loser is stunned. If both counter each other they clash and bounce apart.</p>
            <table class="lm-table lm-wide">
                <tr><th>Move</th><th>Counters</th><th>Loses to</th></tr>
                <tr><td><b>Shield</b></td><td>Everything except Grab</td><td>Grab</td></tr>
                <tr><td><b>Grab / Suplex</b></td><td>Shield, Headbutt</td><td>Every other active move</td></tr>
                <tr><td><b>Headbutt</b></td><td>Everything except Grab and Shield</td><td>Grab, Shield (clashes with J and Core)</td></tr>
                <tr><td><b>J attack</b></td><td>Everything except Shield</td><td>Shield (clashes with Headbutt and J)</td></tr>
                <tr><td><b>Core</b></td><td>Blink, Spiral, Headbutt, Grab (and the Suplex)</td><td>Shield, J, Headbutt</td></tr>
                <tr><td><b>Blink, Spiral</b></td><td>Grab</td><td>Shield, J, Headbutt (and Core, for the F moves)</td></tr>
            </table>
            <p class="lm-note">A move only counters while it is "live": a J attack during its swing, a Core while it is being cast, and so on.</p>`,
    },
    {
        title: 'The Bots',
        html: () => `
            <div class="lm-grid">
                <div class="lm-card"><h4>Easy</h4><p>Slow, defensive, shields a lot and throws the odd small Core.</p></div>
                <div class="lm-card"><h4>Medium</h4><p>Between Easy and Hard: it uses every move, but reacts more slowly, shields and counters less often, and does not learn your habits. In custom matches you can add Easy, Medium or Hard CPUs.</p></div>
                <div class="lm-card"><h4>Hard</h4><p>Uses every move under the same rules you do. It fires Cores when you are on or near an edge, shields incoming Cores, grabs shielders, counters your attacks, and rolls out of combos.</p></div>
                <div class="lm-card"><h4>It learns</h4><p>The Hard bot watches which moves you favour and remembers it between matches in this browser, then leans toward whatever beats your habits.</p></div>
                <div class="lm-card"><h4>Training</h4><p>An idle dummy with infinite stocks and normal physics. Good for practising counters and combos.</p></div>
            </div>`,
    },
    {
        title: 'Mobile Controls',
        html: () => `
            <div class="lm-grid">
                <div class="lm-card"><h4>Move</h4><p>Touch anywhere on the <b>left half</b> of the screen: a joystick appears under your thumb. Left / right walks, pushing down drops through platforms.</p></div>
                <div class="lm-card"><h4>Aim grid</h4><p><b>Tap the red centre</b> for the sword spin. <b>Tap an arrow</b> for the up / side / down melee, or <b>hold</b> it to charge. <b>Hold the red centre 0.4 s</b> for the neutral F (CBG Core), or <b>drag it onto an arrow</b> for that F move (Spiral, Blink, Suplex / Headbutt).</p></div>
                <div class="lm-card"><h4>Shield &amp; grab</h4><p>Hold <b>Shield</b> (it does not drag). While shielding, move the joystick left or right to roll. Use the separate <b>Grab</b> button to grab: drag to aim, release to fire.</p></div>
                <div class="lm-card"><h4>Jump</h4><p>Tap <b>Jump</b> (up to four in the air).</p></div>
                <div class="lm-card"><h4>Your layout</h4><p>Open <b>Settings</b> and choose <b>Edit layout</b> to move the buttons and change their size. You can also force PC or Mobile controls there.</p></div>
            </div>`,
    },
    {
        title: 'Your Controls',
        html: (k) => `
            <table class="lm-table lm-wide lm-keys">
                ${ACTIONS.map(a => `<tr><td>${esc(a.label)}</td><td><kbd>${esc(k(a.id))}</kbd></td></tr>`).join('')}
                <tr><td>Roll (alternative)</td><td><kbd>Shield + Scroll</kbd></td></tr>
            </table>
            <p class="lm-note">Everything above can be changed in <b>Settings</b> (start screen or pause menu).</p>
            <button class="lm-btn lm-btn-ghost" data-open-settings>Open settings…</button>`,
    },
];

export class UI {
    constructor({ $, closeMenu }) {
        this.$ = $;
        this.closeMenu = closeMenu;
        this.page = 0;
        this.capturing = null;
        this.pausedByUI = false;
        const root = $('luminary-root');

        this.guide = new Guide({ root, isBlocked: () => this.isOpen() });

        this.tut = document.createElement('div');
        this.tut.className = 'lm-modal lm-hidden';
        this.tut.innerHTML = `
            <div class="lm-panel" role="dialog" aria-label="How to play">
                <div class="lm-head"><h2>How to play</h2><button class="lm-x" data-close aria-label="Close">✕</button></div>
                <div class="lm-tabs" role="tablist"></div>
                <div class="lm-body"></div>
                <div class="lm-foot">
                    <button class="lm-btn lm-btn-ghost" data-prev>← Back</button>
                    <span class="lm-count"></span>
                    <button class="lm-btn" data-next>Next →</button>
                </div>
            </div>`;
        root.appendChild(this.tut);

        this.set = document.createElement('div');
        this.set.className = 'lm-modal lm-hidden';
        this.set.innerHTML = `
            <div class="lm-panel lm-panel-sm" role="dialog" aria-label="Settings">
                <div class="lm-head"><h2>Settings</h2><button class="lm-x" data-close aria-label="Close">✕</button></div>
                <p class="lm-note lm-hint">PC controls: click a control, then press the key or mouse button you want. Esc cancels. Binding something that is already used swaps the two.</p>
                <div class="lm-body lm-rows"></div>
                <div class="lm-foot">
                    <button class="lm-btn lm-btn-ghost" data-reset>Reset PC controls</button>
                    <button class="lm-btn" data-close>Done</button>
                </div>
            </div>`;
        root.appendChild(this.set);

        // modal wiring
        for (const m of [this.tut, this.set]) {
            m.addEventListener('click', (e) => {
                if (e.target === m || e.target.closest('[data-close]')) this.closeAll();
            });
        }
        this.tut.querySelector('[data-prev]').addEventListener('click', () => this.go(this.page - 1));
        this.tut.querySelector('[data-next]').addEventListener('click', () => this.go(this.page + 1));
        this.tut.addEventListener('click', (e) => {
            if (e.target.closest('[data-open-settings]')) { this.closeAll(); this.openSettings(); }
            if (e.target.closest('[data-start-guide]')) { this.closeAll(); this.closeMenu(); $('startScreen').classList.add('hidden'); this.guide.start(); }
        });
        this.set.querySelector('[data-reset]').addEventListener('click', () => { resetBindings(); this.renderSettings(); this.refreshLabels(); });

        // buttons that already exist in index.html
        const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); };
        on('tutorialBtnStart', () => this.openTutorial());
        on('settingsBtnStart', () => this.openSettings());
        on('toggleControlsBtn', () => this.toggleTutorial());

        // key / mouse capture for rebinding (capture phase: it runs before the game's own handlers)
        window.addEventListener('keydown', (e) => {
            if (this.capturing) { e.preventDefault(); e.stopImmediatePropagation(); this.finishCapture(e.code); return; }
            if (e.code === 'Escape' && this.isOpen()) { e.preventDefault(); this.closeAll(); }
        }, true);
        window.addEventListener('mousedown', (e) => {
            if (!this.capturing || performance.now() < this.capturing.armedAt) return;
            e.preventDefault(); e.stopImmediatePropagation();
            this.finishCapture('Mouse' + e.button);
            if (e.button === 0) {          // only a left press is followed by a click that must not hit a button underneath
                const swallow = (ev) => { ev.stopImmediatePropagation(); ev.preventDefault(); window.removeEventListener('click', swallow, true); };
                window.addEventListener('click', swallow, true);
                setTimeout(() => window.removeEventListener('click', swallow, true), 400);
            }
        }, true);

        this.refreshLabels();
    }

    isOpen() { return !this.tut.classList.contains('lm-hidden') || !this.set.classList.contains('lm-hidden'); }

    /** keep the game frozen while a menu is open mid-match */
    pause() { if (S.gameState === 'playing' && !S.online && !window.__luminaryPaused) { window.__luminaryPaused = true; this.pausedByUI = true; } }
    resume() { if (this.pausedByUI) { window.__luminaryPaused = false; this.pausedByUI = false; } }

    closeAll() {
        this.cancelCapture();
        this.tut.classList.add('lm-hidden');
        this.set.classList.add('lm-hidden');
        this.resume();
    }
    openTutorial() { this.closeMenu(); this.set.classList.add('lm-hidden'); this.pause(); this.tut.classList.remove('lm-hidden'); this.renderTutorial(); }
    toggleTutorial() { if (!this.tut.classList.contains('lm-hidden')) this.closeAll(); else this.openTutorial(); }
    openSettings() { this.closeMenu(); this.tut.classList.add('lm-hidden'); this.pause(); this.set.classList.remove('lm-hidden'); this.renderSettings(); }

    go(i) { this.page = Math.max(0, Math.min(PAGES.length - 1, i)); this.renderTutorial(); }
    renderTutorial() {
        const tabs = this.tut.querySelector('.lm-tabs');
        tabs.innerHTML = PAGES.map((p, i) => `<button role="tab" class="lm-tab${i === this.page ? ' on' : ''}" data-i="${i}">${esc(p.title)}</button>`).join('');
        tabs.querySelectorAll('.lm-tab').forEach(b => b.addEventListener('click', () => this.go(+b.dataset.i)));
        this.tut.querySelector('.lm-body').innerHTML = `<h3 class="lm-title">${esc(PAGES[this.page].title)}</h3>` + PAGES[this.page].html(keyLabel);
        this.tut.querySelector('.lm-count').textContent = `${this.page + 1} / ${PAGES.length}`;
        this.tut.querySelector('[data-prev]').disabled = this.page === 0;
        this.tut.querySelector('[data-next]').disabled = this.page === PAGES.length - 1;
        this.tut.querySelector('.lm-body').scrollTop = 0;
    }

    renderSettings() {
        const rows = this.set.querySelector('.lm-rows');
        const L = getLayout();
        const gfx = getGfx();
        let group = '', html = `<h4 class="lm-group">Layout</h4>
            <div class="lm-row"><span>Control layout<small class="lm-sub">Auto uses touch controls on phones and tablets</small></span>
              <span class="lm-seg">${[['auto', 'Auto'], ['pc', 'PC'], ['mobile', 'Mobile']].map(([m, t]) => `<button class="lm-segb${L.mode === m ? ' on' : ''}" data-mode="${m}">${t}</button>`).join('')}</span></div>
            <div class="lm-row"><span>Mobile button layout<small class="lm-sub">Move the grid, jump and shield buttons and resize them</small></span><button class="lm-key" data-edit-layout>Edit layout…</button></div>
            <div class="lm-row"><span>Graphics quality<small class="lm-sub">Auto adapts to your device. High is sharpest (phones look pixelated on Low)</small></span>
              <span class="lm-seg">${[['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']].map(([m, t]) => `<button class="lm-segb${gfx === m ? ' on' : ''}" data-gfx="${m}">${t}</button>`).join('')}</span></div>
            <div class="lm-row"><span>Fullscreen</span><button class="lm-key" data-fs>Toggle</button></div>
            <h4 class="lm-group">PC controls (keyboard &amp; mouse)</h4>`;
        group = 'PC';
        for (const a of ACTIONS) {
            if (a.group !== group) { group = a.group; html += `<h4 class="lm-group">${esc(group)}</h4>`; }
            html += `<div class="lm-row"><span>${esc(a.label)}</span><button class="lm-key" data-action="${a.id}">${esc(codeName(bindings[a.id]))}</button></div>`;
        }
        html += `<div class="lm-row"><span>Roll (alternative)</span><span class="lm-fixed">Shield + Scroll wheel</span></div>`;
        rows.innerHTML = html;
        rows.querySelectorAll('.lm-key[data-action]').forEach(b => b.addEventListener('click', () => this.startCapture(b.dataset.action, b)));
        rows.querySelectorAll('[data-gfx]').forEach(b => b.addEventListener('click', () => { setGfx(b.dataset.gfx); this.renderSettings(); }));
        rows.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { setMode(b.dataset.mode); this.renderSettings(); }));
        const fs = rows.querySelector('[data-fs]');
        if (fs) fs.addEventListener('click', () => { try { if (document.fullscreenElement) document.exitFullscreen(); else { const p = document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } } catch (e) { /* not allowed here */ } });
        const ed = rows.querySelector('[data-edit-layout]');
        if (ed) ed.addEventListener('click', () => {
            if (!this.layoutEditor) return;
            this.set.classList.add('lm-hidden');                       // the editor is its own full screen on top
            this.layoutEditor.open(() => { this.set.classList.remove('lm-hidden'); this.renderSettings(); });
        });
    }

    startCapture(action, btn) {
        this.cancelCapture();
        this.capturing = { action, btn, armedAt: performance.now() + 150 };
        btn.classList.add('listening');
        btn.textContent = 'Press a key or click…';
    }
    cancelCapture() {
        if (!this.capturing) return;
        this.capturing.btn.classList.remove('listening');
        this.capturing = null;
        this.renderSettings();
    }
    finishCapture(code) {
        if (!this.capturing) return;
        if (code === 'Escape') { this.cancelCapture(); return; }
        setBinding(this.capturing.action, code);
        this.capturing = null;
        this.renderSettings();
        this.refreshLabels();
    }

    /** on-screen hints that name a key */
    refreshLabels() {
        const btn = this.$('toggleControlsBtn');
        if (btn) btn.textContent = `Press '${keyLabel('tutorial')}' for Tutorial`;
    }
}
