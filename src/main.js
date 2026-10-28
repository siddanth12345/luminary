// Entry point: input, UI wiring and the fixed-timestep loop. Behaviour of every control is
// carried over 1:1 from the original single-file game.
import {
    S, audio, step, p1, p2, keys, mouse, dramaticZoom,
    updateAimMatrix, renderHUD, startMatchSequence, gameOverModal,
} from './core.js';
import { held, actionsFor } from './controls.js';
import { UI } from './ui.js';
import { View } from './render/view.js';
import { Online, leaveRoom, sendAct, sendHeld, requestRematch, joinRoom } from './net/online.js';
import { CustomUI } from './net/customUI.js';
import { PartyUI } from './net/partyUI.js';
import { Party, joinParty } from './net/party.js';
import { LobbyUI } from './net/lobbyUI.js';
import { Queue, joinQueue } from './net/queue.js';
import { ACC, initAccount, setProfileListener, recordResult } from './account.js';
import { AccountUI, Toasts } from './accountUI.js';
import { BorgsUI } from './borgsUI.js';
import { ChatUI } from './chatUI.js';
import { Inbox, startInbox, announceSplinter, acceptInvite, acceptRequest, declineRequest } from './net/inbox.js';

const $ = (id) => document.getElementById(id);
const view = new View($('gameCanvas'));
const ui = new UI({ $, closeMenu: () => $('menuDropdown').classList.add('hidden') });
const lobby = new LobbyUI({ root: $('luminary-root'), openBtn: $('onlineBtnStart') });
const toasts = new Toasts($('luminary-root'));
const chat = new ChatUI({ root: $('luminary-root') });
const borgsUI = new BorgsUI({ root: $('luminary-root'), toasts, onInviteSent: () => lobby.open('Invite sent. Waiting for your friend to join…') });
const custom = new CustomUI({ root: $('luminary-root'), openBtn: $('customBtnStart'), openBorgs: () => borgsUI.open('borgs') });
const partyUI = new PartyUI({ root: $('luminary-root'), openBtn: $('partyBtnStart'), toasts });
Inbox.joinParty = (code) => { partyUI.open(); return joinParty(code); };
Party.onGo = (m) => { if (Online.role) return; toasts.show({ text: m.kind === 'lobby' ? 'Your party is starting a custom match' : 'Your party is starting a 1v1', ttl: 4000 }); joinRoom(m.code); };
const accountUI = new AccountUI({ root: $('luminary-root'), startScreen: $('startScreen'), openBorgs: () => borgsUI.open('borgs'), onChange: () => ui.refreshLabels() });

// ---- accounts / inbox
Inbox.onRequest = (from) => toasts.show({ text: `${from} sent you a borg request`, ttl: 12000, actions: [
    { label: 'Accept', fn: () => acceptRequest({ id: (getReq(from) || {}).id, from }) }, { label: 'Later', ghost: true, fn: () => borgsUI.open('reqs') }] });
function getReq(from) { return (JSON.parse(localStorage.getItem('luminary-breq-' + (ACC.status === 'user' ? ACC.userId : 'guest')) || '{}').incoming || []).find(r => r.from === from); }
Inbox.onInvite = (inv) => toasts.show({ text: `${inv.from} invited you to ${inv.kind === 'party' ? 'a party' : inv.kind === 'lobby' ? 'a custom match' : 'a 1v1'}`, ttl: 20000, actions: [
    { label: 'Join', fn: () => { if (inv.kind === '1v1') lobby.open('Joining…'); else if (inv.kind === 'lobby') custom.open(); acceptInvite(inv); } }, { label: 'Decline', ghost: true }] });
setProfileListener(() => { startInbox(); ui.refreshLabels(); });
initAccount().then(() => { if (ACC.status === 'signedOut') accountUI.open('login'); startInbox(); });
window.addEventListener('pagehide', () => { announceSplinter(); });

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
    if (action === 'chat') { chat.toggle(); return; }
    if (window.__luminaryChat) return;                      // typing a chat message: no game input
    if (S.gameState !== 'playing') return;
    if (S.online === 'guest') {                                    // the host runs the match: forward the input
        const aim = { wx: mouse.worldX, wy: mouse.worldY, dir: mouse.direction };
        if (['jump', 'attack', 'dash', 'grab', 'roll', 'special'].includes(action)) sendAct(action, aim);
        return;
    }
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
    if (S.online === 'guest') {
        if (action === 'special' && S.gameState === 'playing') sendAct('specialUp', { wx: mouse.worldX, wy: mouse.worldY, dir: mouse.direction });
        return;
    }
    if (action === 'special') {
        if (S.gameState === 'playing') p1.fRelease(mouse.direction, mouse.worldX, mouse.worldY);
        else p1.cancelF();
    }
}

window.addEventListener('keydown', (e) => {
    audio.init();
    const acts = actionsFor(e.code);
    if (acts.includes('chat') && !window.__luminaryChat) e.preventDefault();
    if (acts.length) { if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault(); }
    if (e.repeat) return;
    held.add(e.code);
    for (const a of acts) doAction(a);
    if (S.online === 'guest') sendHeld();
});
window.addEventListener('keyup', (e) => {
    const was = held.has(e.code);
    held.delete(e.code);
    if (was) for (const a of actionsFor(e.code)) releaseAction(a);
    if (S.online === 'guest') sendHeld();
});
// losing focus while holding a key must not leave a charge (or a direction) stuck
window.addEventListener('blur', () => { p1.cancelF(); held.clear(); if (S.online === 'guest') { sendAct('cancelF'); sendHeld(); } });

let lastAimSent = 0;
window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    view.setPointer(e.clientX, e.clientY);   // pointer -> world position on the play plane
    updateAimMatrix();
    if (S.online === 'guest') {              // keep the host's copy of my aim fresh (throws, dashes, Core)
        const now = performance.now();
        if (now - lastAimSent > 50) { lastAimSent = now; sendHeld({ wx: mouse.worldX, wy: mouse.worldY }); }
    }
});

window.addEventListener('wheel', (e) => {
    audio.init();
    if (S.gameState !== 'playing') return;
    e.preventDefault();
    if (S.online === 'guest') { sendAct('roll'); return; }
    p1.executeRoll();                        // hold shield + scroll
}, { passive: false });

window.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('mousedown', (e) => {
    audio.init();
    if (inMenu(e)) return;
    const code = 'Mouse' + e.button;
    held.add(code);
    for (const a of actionsFor(code)) doAction(a);
    if (S.online === 'guest') sendHeld();
});
window.addEventListener('mouseup', (e) => {
    const code = 'Mouse' + e.button;
    const was = held.has(code);
    held.delete(code);
    if (was) for (const a of actionsFor(code)) releaseAction(a);
    if (S.online === 'guest') sendHeld();
});

// ------------------------------------------------------------------ menus
const menuDropdown = $('menuDropdown');
$('menuToggleBtn').addEventListener('click', (e) => { e.stopPropagation(); menuDropdown.classList.toggle('hidden'); });
window.addEventListener('click', () => { if (!menuDropdown.classList.contains('hidden')) menuDropdown.classList.add('hidden'); });
$('menuResumeBtn').addEventListener('click', () => menuDropdown.classList.add('hidden'));
$('menuTutorialBtn').addEventListener('click', () => { menuDropdown.classList.add('hidden'); ui.openTutorial(); });
$('menuControlsBtn').addEventListener('click', () => { menuDropdown.classList.add('hidden'); ui.openSettings(); });
$('menuRestartBtn').addEventListener('click', () => { menuDropdown.classList.add('hidden'); if (!S.online) startMatchSequence(S.gameMode); });

function backToMenu() {
    ui.guide.stop();
    if (S.online || Online.role) leaveRoom();
    for (const id of ['gameHud', 'aimMatrixHud', 'inGameMenuContainer', 'trainingControlPanel', 'openTrainingPanelBtn']) $(id).classList.add('hidden');
    dramaticZoom.active = false;
    S.gameState = 'start';
    $('startScreen').classList.remove('hidden');
}
$('menuQuitBtn').addEventListener('click', () => { menuDropdown.classList.add('hidden'); backToMenu(); });
$('exitBtn').addEventListener('click', () => { gameOverModal.classList.add('hidden'); backToMenu(); });
$('rematchBtn').addEventListener('click', () => { if (S.online) requestRematch(); else startMatchSequence(S.gameMode); });

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

let resultRecorded = false;
function onlineGameOver() {
    if (S.online && S.gameState === 'gameover' && S.winnerRole) {
        if (!resultRecorded) { resultRecorded = true; recordResult(S.winnerRole === 'lobby' ? !!S.iWon : S.winnerRole === S.online); $('requeueBtn').classList.toggle('hidden', !Online.viaQueue || Online.mode === 'lobby'); }
    } else if (S.gameState !== 'gameover') resultRecorded = false;
}
$('requeueBtn').addEventListener('click', () => { $('gameOverModal').classList.add('hidden'); const wasQueue = true; leaveRoom(); backToMenu(); lobby.open(); joinQueue(); });

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
    onlineGameOver();
    renderHUD();
    view.update(dt, window.__luminaryPaused ? 0 : acc / STEP);
    requestAnimationFrame(frame);
}

Online.onLeft = (msg) => { backToMenu(); lobby.open(msg); };
updateAimMatrix();
requestAnimationFrame(frame);

// handy for debugging / automated tests
window.__luminary = { S, p1, p2, view, step, keys, mouse, startMatchSequence };
