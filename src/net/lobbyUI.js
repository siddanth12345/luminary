// "Play online" dialog: quick match (queue), host a 1v1 room by code, join by code.
import { Online, hostRoom, joinRoom, leaveRoom, hasRealtime } from './online.js';
import { Queue, joinQueue, leaveQueue } from './queue.js';
import { displayName } from '../account.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class LobbyUI {
    constructor({ root, openBtn }) {
        this.el = document.createElement('div');
        this.el.className = 'lm-modal lm-hidden';
        this.el.innerHTML = `
            <div class="lm-panel" role="dialog" aria-label="Play online">
                <div class="lm-head"><h2>Play online</h2><button class="lm-x" data-close aria-label="Close">✕</button></div>
                <div class="lm-body">
                    <p class="lm-note" data-who></p>
                    <div class="lm-online-split lm-split3">
                        <div class="lm-card"><h4>Quick match</h4>
                            <p>Get paired with the next player searching. 1v1, 3 stocks.</p>
                            <button class="lm-btn" data-queue>Find a match</button></div>
                        <div class="lm-card"><h4>Host a 1v1</h4>
                            <p>Get a 4-letter code and send it to a friend.</p>
                            <button class="lm-btn" data-host>Create room</button>
                            <div class="lm-code lm-hidden" data-codebox><span>ROOM CODE</span><b data-code></b></div></div>
                        <div class="lm-card"><h4>Join a room</h4>
                            <p>Enter a code from a friend.</p>
                            <div class="lm-joinrow"><input data-join-code maxlength="4" placeholder="ABCD" autocomplete="off" spellcheck="false"><button class="lm-btn" data-join>Join</button></div></div>
                    </div>
                    <p class="lm-status" data-status></p>
                    <p class="lm-note" data-mode></p>
                </div>
                <div class="lm-foot"><span></span><button class="lm-btn lm-btn-ghost" data-close>Close</button></div>
            </div>`;
        root.appendChild(this.el);
        this.q = (s) => this.el.querySelector(s);

        this.el.addEventListener('click', (e) => { if (e.target === this.el || e.target.closest('[data-close]')) this.close(); });
        this.q('[data-queue]').addEventListener('click', () => { if (Queue.active) { leaveQueue(); this.render(); } else joinQueue(); });
        this.q('[data-host]').addEventListener('click', () => { leaveQueue(); hostRoom(); });
        const join = () => { leaveQueue(); joinRoom(this.q('[data-join-code]').value); };
        this.q('[data-join]').addEventListener('click', join);
        this.q('[data-join-code]').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
        this.q('[data-join-code]').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') join(); });

        Online.onChange = () => this.render();
        Queue.onChange = () => this.render();
        if (openBtn) openBtn.addEventListener('click', (e) => { e.stopPropagation(); this.open(); });
    }

    open(note = '') { this.el.classList.remove('lm-hidden'); this.note = note; this.render(); }
    close() {
        this.el.classList.add('lm-hidden');
        if (Queue.active) leaveQueue();
        if (Online.status === 'waiting' || Online.status === 'joining') leaveRoom();
    }
    isOpen() { return !this.el.classList.contains('lm-hidden'); }

    render() {
        if (!this.isOpen()) return;
        this.q('[data-who]').innerHTML = `Playing as <b>${esc(displayName())}</b>`;
        const hosting = Online.role === 'host' && (Online.status === 'waiting' || Online.status === 'connected');
        this.q('[data-codebox]').classList.toggle('lm-hidden', !hosting);
        this.q('[data-code]').textContent = Online.code;
        this.q('[data-queue]').textContent = Queue.active ? 'Cancel search' : 'Find a match';
        let status = Online.note || this.note || '';
        if (Queue.active) status = Queue.waiting ? 'Opponent found, connecting…' : 'Searching for an opponent…';
        this.q('[data-status]').textContent = status;
        this.q('[data-status]').className = 'lm-status' + (Online.status === 'closed' ? ' bad' : '');
        this.q('[data-mode]').textContent = hasRealtime()
            ? 'Connected through the online server.'
            : 'This page cannot reach the internet (the sandboxed preview blocks network connections), so matches only work between tabs of this same browser. Open the GitHub Pages link or the downloaded game for real online play.';
        if (Online.status === 'connected') this.el.classList.add('lm-hidden');   // the match is starting
    }
}
