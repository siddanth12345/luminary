// Entry point: input, UI wiring and the fixed-timestep loop. Behaviour of every control is
// carried over 1:1 from the original single-file game.
import {
    S, audio, step, p1, p2, fighters, keys, mouse, dramaticZoom,
    updateAimMatrix, renderHUD, startMatchSequence, gameOverModal, bufferInput, inputBuf,
} from './core.js';
import { held, actionsFor } from './controls.js';
import { TouchControls } from './touch.js';
import { LayoutEditor } from './layoutUI.js';
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
import { Inbox, startInbox, announceSplinter, acceptInvite, acceptRequest, declineRequest, sendBorgRequest } from './net/inbox.js';
import { isBorg, isSelf, getRequests, onBorgs } from './friends.js';

const $ = (id) => document.getElementById(id);
const view = new View($('gameCanvas'));
const ui = new UI({ $, closeMenu: () => $('menuDropdown').classList.add('hidden') });
const touch = new TouchControls({
    root: $('luminary-root'), doAction: (a) => doAction(a), releaseAction: (a) => releaseAction(a),
    cancelF: () => { p1.cancelF(); if (S.online === 'guest') sendAct('cancelF'); },
    heldChanged: () => { if (S.online === 'guest') sendHeld(); },
});
ui.layoutEditor = new LayoutEditor({ root: document.body });
const lobby = new LobbyUI({ root: $('luminary-root'), openBtn: $('onlineBtnStart') });
const toasts = new Toasts($('luminary-root'));
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

let wantFs = false;                 // the player turned fullscreen on: if Safari drops it by itself, re-enter on the next touch
const inFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function enterFs() {
    try {
        const el = document.documentElement;
        const fn = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!fn) return;
        const p = fn.call(el, { navigationUI: 'hide' });
        if (p && p.catch) p.catch(() => {});
    } catch (e) { /* fullscreen not allowed here (some embeds block it) */ }
}
function toggleFullscreen() {
    try {
        if (inFs()) { wantFs = false; (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
        wantFs = true; enterFs();
    } catch (e) { /* ignore */ }
}
// Safari leaves fullscreen on some swipes (e.g. sliding a button upward). Tell it we did not mean that:
// touch gestures on the game never scroll / pinch / pull, and if it still drops out we re-enter on the next tap.
document.addEventListener('fullscreenchange', () => { if (!inFs() && wantFs && S.gameState !== 'start') wantFs = true; });
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => {
    if (e.target && e.target.closest && e.target.closest('.lm-modal, #startScreen, #menuDropdown, .le-screen, input, textarea')) return;   // menus may scroll
    e.preventDefault();
}, { passive: false });
document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && wantFs && !inFs()) enterFs(); }, true);

function doAction(action) {
    if (action === 'tutorial') { ui.toggleTutorial(); return; }
    if (action === 'fullscreen') { toggleFullscreen(); return; }
    if (S.gameState !== 'playing') return;
    if (S.online === 'guest') {                                    // the host runs the match: forward the input
        const aim = { wx: mouse.worldX, wy: mouse.worldY, dir: mouse.direction };
        if (action === 'attack') aim.hold = true;
        if (['jump', 'attack', 'grab', 'roll', 'special'].includes(action)) sendAct(action, aim);
        return;
    }
    switch (action) {
        case 'jump': if (!p1.jump()) bufferInput('jump'); break;
        case 'attack': if (!p1.attack(mouse.direction, true)) bufferInput('attack', { dir: mouse.direction, hold: true }); break;
        case 'grab': if (!p1.executeGrabDash(mouse.worldX, mouse.worldY)) bufferInput('grab', { wx: mouse.worldX, wy: mouse.worldY }); break;
        case 'roll': p1.executeRoll(); break;                       // only works while shielding
        case 'special': p1.fPress(mouse.direction); break;          // hold = Luminary Core, tap = variant for the aim
    }
}
function releaseAction(action) {
    if (action === 'attack') { inputBuf.hold = false; if (S.online === 'guest') sendAct('attackUp'); else p1.releaseAttack(); return; }
    if (S.online === 'guest') {
        if (action === 'special' && S.gameState === 'playing') sendAct('specialUp', { wx: mouse.worldX, wy: mouse.worldY, dir: mouse.direction });
        return;
    }
    if (action === 'special') {
        if (S.gameState === 'playing') p1.fRelease(mouse.direction, mouse.worldX, mouse.worldY);
        else p1.cancelF();
    }
}

// ---- in-game menu: Esc toggles it instantly; it lists the players in the match with an add-borg button
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderMenuPlayers() {
    const box = $('menuPlayers'); if (!box) return;
    const list = fighters.filter(f => f.active);
    if (S.gameState === 'start' || !list.length) { box.innerHTML = ''; return; }
    const outgoing = getRequests().outgoing.map(r => String(r.to).toLowerCase());
    const humans = list.filter(f => !f.isAI).length;
    const rows = list.map(f => {
        const bot = f.isAI;
        const me = S.match ? f.slot === (S.mySlot || 0) : f === p1;
        const nm = esc(f.name);
        let btn = '';
        if (!bot && !me) {
            if (isBorg(f.name)) btn = '<span class="lm-mp-tag">borg</span>';
            else if (outgoing.includes(String(f.name).toLowerCase())) btn = '<span class="lm-mp-tag">sent</span>';
            else btn = `<button class="lm-mp-add" data-addborg="${nm}" title="Send a borg request">+ Borg</button>`;
        }
        return `<div class="lm-mp-row"><span class="lm-mp-dot" style="background:${f.color}"></span><span class="lm-mp-name">${nm}${me ? ' (you)' : ''}${bot ? ' · CPU' : ''}</span>${btn}</div>`;
    }).join('');
    box.innerHTML = `<div class="lm-mp-head">Players <b>${list.length}${S.match ? ' / 8' : ''}</b>${list.length !== humans ? ` <i>${humans} human</i>` : ''}</div>${rows}`;
}
$('menuPlayers').addEventListener('click', async (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-addborg]'); if (!b) return;
    b.disabled = true;
    const r = await sendBorgRequest(b.dataset.addborg);
    toasts.show({ text: r.msg, ttl: 4000 });
    renderMenuPlayers();
});
onBorgs(() => { if (!$('menuDropdown').classList.contains('hidden')) renderMenuPlayers(); });
function toggleGameMenu() {
    const dd = $('menuDropdown');
    if (dd.classList.contains('hidden')) { renderMenuPlayers(); dd.classList.remove('hidden'); } else dd.classList.add('hidden');
}
window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.repeat) return;
    if (!['playing', 'countdown'].includes(S.gameState)) return;
    if (document.querySelector('.lm-modal:not(.lm-hidden)') || ui.guide.active) return;   // a dialog / the tutorial owns Esc
    e.preventDefault();
    toggleGameMenu();
});

window.addEventListener('keydown', (e) => {
    audio.init();
    const acts = actionsFor(e.code);
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
window.addEventListener('blur', () => { p1.cancelF(); p1.releaseAttack(); held.clear(); if (S.online === 'guest') { sendAct('cancelF'); sendHeld(); } });

let lastAimSent = 0;
window.addEventListener('mousemove', (e) => {
    if (mouse.touchMode) return;
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
    if (S.gameState !== 'playing' || mouse.touchMode) return;
    e.preventDefault();
    if (S.online === 'guest') { sendAct('roll'); return; }
    p1.executeRoll();                        // hold shield + scroll
}, { passive: false });

window.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('mousedown', (e) => {
    audio.init();
    if (inMenu(e) || mouse.touchMode) return;
    const code = 'Mouse' + e.button;
    held.add(code);
    for (const a of actionsFor(code)) doAction(a);
    if (S.online === 'guest') sendHeld();
});
window.addEventListener('mouseup', (e) => {
    if (mouse.touchMode) return;
    const code = 'Mouse' + e.button;
    const was = held.has(code);
    held.delete(code);
    if (was) for (const a of actionsFor(code)) releaseAction(a);
    if (S.online === 'guest') sendHeld();
});

// ------------------------------------------------------------------ menus
const menuDropdown = $('menuDropdown');
$('menuToggleBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleGameMenu(); });
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

for (const [id, mode] of [['easyModeBtn', 'easy'], ['mediumModeBtn', 'medium'], ['hardModeBtn', 'hard'], ['trainingModeBtn', 'training']]) {
    $(id).addEventListener('click', () => { audio.init(); startMatchSequence(mode); if (mode === 'training' && mouse.touchMode) $('closeTrainingPanelBtn').click(); });
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
        while (acc >= STEP && n < 3) { step(); acc -= STEP; n++; }
        if (n === 3) acc = 0;
    }
    ui.guide.tick();
    touch.tick();
    onlineGameOver();
    renderHUD();
    view.update(dt, window.__luminaryPaused ? 0 : acc / STEP);
    requestAnimationFrame(frame);
}

Online.onLeft = (msg) => { backToMenu(); lobby.open(msg); };
updateAimMatrix();
requestAnimationFrame(frame);

// handy for debugging / automated tests
window.__luminary = { S, p1, p2, view, step, keys, mouse, startMatchSequence, touch };
