// Entry point: input, UI wiring and the fixed-timestep loop. Behaviour of every control is
// carried over 1:1 from the original single-file game.
import {
    S, audio, step, p1, p2, keys, mouse, dramaticZoom,
    updateAimMatrix, renderHUD, startMatchSequence, gameOverModal,
} from './core.js';
import { held, actionsFor } from './controls.js';
import { UI } from './ui.js';
import { View } from './render/view.js';

const $ = (id) => document.getElementById(id);
const view = new View($('gameCanvas'));
const ui = new UI({ $, closeMenu: () => $('menuDropdown').classList.add('hidden') });

// ------------------------------------------------------------------ input
// Every gameplay control goes through src/controls.js, so each one can be rebound in the
// Controls menu (start screen and pause menu).
const inMenu = (e) => !!(e.target && e.target.closest && e.target.closest('button, a, input, select, .lm-modal, #menuDropdown'));

function toggleFullscreen() {
    try {
        if (document.fullscreenElement) { document.exitFullscreen(); return; }
        const el = document.documentElement;
        const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        if (p && p.catch) p.catch(() => {});
    } catch (e) { /* fullscreen not allowed here (some embeds block it) */ }
}

function doAction(action) {
    if (action === 'tutorial') { ui.toggleTutorial(); return; }
    if (action === 'fullscreen') { toggleFullscreen(); return; }
    if (S.gameState !== 'playing') return;
    switch (action) {
        case 'jump': p1.jump(); break;
        case 'attack': p1.attack(mouse.direction); break;
        case 'dash': p1.executeMouseDash(mouse.worldX, mouse.worldY); break;
        case 'grab': p1.executeGrabDash(mouse.worldX, mouse.worldY); break;
        case 'roll': p1.executeRoll(); break;                       // only works while shielding
        case 'special': p1.fPress(mouse.direction); break;          // hold = Luminary Core, tap = variant for the aim
    }
}
function releaseAction(action) {
    if (action === 'special') {
        if (S.gameState === 'playing') p1.fRelease(mouse.direction, mouse.worldX, mouse.worldY);
        else p1.cancelF();
    }
}

window.addEventListener('keydown', (e) => {
    audio.init();
    const acts = actionsFor(e.code);
    if (acts.length) { if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault(); }
    if (e.repeat) return;
    held.add(e.code);
    for (const a of acts) doAction(a);
});
window.addEventListener('keyup', (e) => {
    const was = held.has(e.code);
    held.delete(e.code);
    if (was) for (const a of actionsFor(e.code)) releaseAction(a);
});
// losing focus while holding a key must not leave a charge (or a direction) stuck
window.addEventListener('blur', () => { p1.cancelF(); held.clear(); });

window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    view.setPointer(e.clientX, e.clientY);   // pointer -> world position on the play plane
    updateAimMatrix();
});

window.addEventListener('wheel', (e) => {
    audio.init();
    if (S.gameState !== 'playing') return;
    e.preventDefault();
    p1.executeRoll();                        // hold shield + scroll
}, { passive: false });

window.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('mousedown', (e) => {
    audio.init();
    if (inMenu(e)) return;
    const code = 'Mouse' + e.button;
    held.add(code);
    for (const a of actionsFor(code)) doAction(a);
});
window.addEventListener('mouseup', (e) => {
    const code = 'Mouse' + e.button;
    const was = held.has(code);
    held.delete(code);
    if (was) for (const a of actionsFor(code)) releaseAction(a);
});

// ------------------------------------------------------------------ menus
const menuDropdown = $('menuDropdown');
$('menuToggleBtn').addEventListener('click', (e) => { e.stopPropagation(); menuDropdown.classList.toggle('hidden'); });
window.addEventListener('click', () => { if (!menuDropdown.classList.contains('hidden')) menuDropdown.classList.add('hidden'); });
$('menuResumeBtn').addEventListener('click', () => menuDropdown.classList.add('hidden'));
$('menuTutorialBtn').addEventListener('click', () => { menuDropdown.classList.add('hidden'); ui.openTutorial(); });
$('menuControlsBtn').addEventListener('click', () => { menuDropdown.classList.add('hidden'); ui.openSettings(); });
$('menuRestartBtn').addEventListener('click', () => { menuDropdown.classList.add('hidden'); startMatchSequence(S.gameMode); });

function backToMenu() {
    ui.guide.stop();
    for (const id of ['gameHud', 'aimMatrixHud', 'inGameMenuContainer', 'trainingControlPanel', 'openTrainingPanelBtn']) $(id).classList.add('hidden');
    dramaticZoom.active = false;
    S.gameState = 'start';
    $('startScreen').classList.remove('hidden');
}
$('menuQuitBtn').addEventListener('click', () => { menuDropdown.classList.add('hidden'); backToMenu(); });
$('exitBtn').addEventListener('click', () => { gameOverModal.classList.add('hidden'); backToMenu(); });
$('rematchBtn').addEventListener('click', () => startMatchSequence(S.gameMode));

const trainingPanel = $('trainingControlPanel');
const openTrainingBtn = $('openTrainingPanelBtn');
$('closeTrainingPanelBtn').addEventListener('click', () => { trainingPanel.classList.add('hidden'); openTrainingBtn.classList.remove('hidden'); });
openTrainingBtn.addEventListener('click', () => { trainingPanel.classList.remove('hidden'); openTrainingBtn.classList.add('hidden'); });

for (const [id, mode] of [['easyModeBtn', 'easy'], ['hardModeBtn', 'hard'], ['trainingModeBtn', 'training']]) {
    $(id).addEventListener('click', () => { audio.init(); startMatchSequence(mode); });
}

// ------------------------------------------------------------------ loop
// The original stepped its simulation once per animation frame (60 Hz displays). A fixed
// 60 Hz accumulator keeps the exact same feel on any refresh rate; rendering interpolates.
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();

function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!window.__luminaryPaused) {
        acc += dt;
        let n = 0;
        while (acc >= STEP && n < 6) { step(); acc -= STEP; n++; }
        if (n === 6) acc = 0;
    }
    ui.guide.tick();
    renderHUD();
    view.update(dt, window.__luminaryPaused ? 0 : acc / STEP);
    requestAnimationFrame(frame);
}

updateAimMatrix();
requestAnimationFrame(frame);

// handy for debugging / automated tests
window.__luminary = { S, p1, p2, view, step, keys, mouse, startMatchSequence };
