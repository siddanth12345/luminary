// Entry point: input, UI wiring and the fixed-timestep loop. Behaviour of every control is
// carried over 1:1 from the original single-file game.
import {
    S, audio, step, p1, p2, keys, mouse, dramaticZoom,
    updateAimMatrix, renderHUD, startMatchSequence, gameOverModal,
} from './core.js';
import { View } from './render/view.js';

const $ = (id) => document.getElementById(id);
const view = new View($('gameCanvas'));

// ------------------------------------------------------------------ input
window.addEventListener('keydown', (e) => {
    audio.init();
    keys[e.key] = true;
    if (S.gameState !== 'playing') return;

    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); p1.jump(); }
    if (e.key === 'q' || e.key === 'Q') p1.executeGrabDash(mouse.worldX, mouse.worldY);
    // F = special moves. Hold F: Luminary Core charge. A quick tap does the variant for the aim direction.
    if ((e.key === 'f' || e.key === 'F') && !e.repeat) p1.fPress(mouse.direction);
    // (the J key no longer does anything: the J attack lives on right click)
    if (e.key === 'h' || e.key === 'H') toggleControlsModal();
});
window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
    if (e.key === 'f' || e.key === 'F') {
        if (S.gameState === 'playing') p1.fRelease(mouse.direction, mouse.worldX, mouse.worldY);
        else p1.cancelF();
    }
});
// losing focus while holding F must not leave the charge stuck
window.addEventListener('blur', () => { p1.cancelF(); for (const k in keys) keys[k] = false; });

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
    p1.executeRoll();
}, { passive: false });

window.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('mousedown', (e) => {
    audio.init();
    if (S.gameState !== 'playing') return;
    if (e.button === 2) p1.attack(mouse.direction);                       // right click = the J attack
    else if (e.button === 0) p1.executeMouseDash(mouse.worldX, mouse.worldY);
});

// ------------------------------------------------------------------ menus
const menuDropdown = $('menuDropdown');
$('menuToggleBtn').addEventListener('click', (e) => { e.stopPropagation(); menuDropdown.classList.toggle('hidden'); });
window.addEventListener('click', () => { if (!menuDropdown.classList.contains('hidden')) menuDropdown.classList.add('hidden'); });
$('menuResumeBtn').addEventListener('click', () => menuDropdown.classList.add('hidden'));
$('menuRestartBtn').addEventListener('click', () => { menuDropdown.classList.add('hidden'); startMatchSequence(S.gameMode); });

function backToMenu() {
    for (const id of ['gameHud', 'aimMatrixHud', 'inGameMenuContainer', 'trainingControlPanel', 'openTrainingPanelBtn']) $(id).classList.add('hidden');
    dramaticZoom.active = false;
    S.gameState = 'start';
    $('startScreen').classList.remove('hidden');
}
$('menuQuitBtn').addEventListener('click', () => { menuDropdown.classList.add('hidden'); backToMenu(); });
$('exitBtn').addEventListener('click', () => { gameOverModal.classList.add('hidden'); backToMenu(); });
$('rematchBtn').addEventListener('click', () => startMatchSequence(S.gameMode));

const controlsModal = $('controlsModal');
function toggleControlsModal() { controlsModal.classList.toggle('hidden'); }
$('toggleControlsBtn').addEventListener('click', toggleControlsModal);
$('closeControlsBtn').addEventListener('click', toggleControlsModal);
$('startPlayBtn').addEventListener('click', toggleControlsModal);

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
    renderHUD();
    view.update(dt, window.__luminaryPaused ? 0 : acc / STEP);
    requestAnimationFrame(frame);
}

updateAimMatrix();
requestAnimationFrame(frame);

// handy for debugging / automated tests
window.__luminary = { S, p1, p2, view, step, keys, mouse, startMatchSequence };
