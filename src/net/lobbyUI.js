// "Play online" dialog: create a room (shows a 4-letter code) or join one.
import { Online, hostRoom, joinRoom, leaveRoom, hasRealtime } from './online.js';

const NAME_KEY = 'luminary.name';
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class LobbyUI {
    constructor({ root, openBtn }) {
        this.el = document.createElement('div');
        this.el.className = 'lm-modal lm-hidden';
        this.el.innerHTML = `
            <div class="lm-panel lm-panel-sm" role="dialog" aria-label="Play online">
                <div class="lm-head"><h2>Play online</h2><button class="lm-x" data-close aria-label="Close">✕</button></div>
                <div class="lm-body">
                    <label class="lm-field"><span>Your name</span><input data-name maxlength="16" autocomplete="off" spellcheck="false"></label>
                    <div class="lm-online-split">
                        <div class="lm-card"><h4>Host a match</h4>
                            <p>Get a 4-letter code and send it to a friend. You run the match.</p>
                            <button class="lm-btn" data-host>Create room</button>
                            <div class="lm-code lm-hidden" data-codebox><span>ROOM CODE</span><b data-code></b></div></div>
                        <div class="lm-card"><h4>Join a match</h4>
                            <p>Enter the code your friend gave you.</p>
                            <div class="lm-joinrow"><input data-join-code maxlength="4" placeholder="ABCD" autocomplete="off" spellcheck="false"><button class="lm-btn" data-join>Join</button></div></div>
                    </div>
                    <p class="lm-status" data-status></p>
                    <p class="lm-note" data-mode></p>
                </div>
                <div class="lm-foot"><span></span><button class="lm-btn lm-btn-ghost" data-close>Close</button></div>
            </div>`;
        root.appendChild(this.el);
        this.q = (s) => this.el.querySelector(s);
        const nameEl = this.q('[data-name]');
        try { nameEl.value = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* no storage */ }
        nameEl.placeholder = 'Player';

        const saveName = () => {
            const n = (nameEl.value || '').trim() || 'Player';
            Online.name = n.slice(0, 16);
            try { localStorage.setItem(NAME_KEY, nameEl.value.trim()); } catch (e) { /* ignore */ }
        };
        nameEl.addEventListener('input', saveName); saveName();

        this.el.addEventListener('click', (e) => {
            if (e.target === this.el || e.target.closest('[data-close]')) this.close();
        });
        this.q('[data-host]').addEventListener('click', () => { saveName(); hostRoom(); });
        const join = () => { saveName(); joinRoom(this.q('[data-join-code]').value); };
        this.q('[data-join]').addEventListener('click', join);
        this.q('[data-join-code]').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
        this.q('[data-join-code]').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') join(); });
        nameEl.addEventListener('keydown', (e) => e.stopPropagation());   // typing a name must not trigger game keys

        Online.onChange = () => this.render();
        if (openBtn) openBtn.addEventListener('click', (e) => { e.stopPropagation(); this.open(); });
    }

    open(note = '') {
        this.el.classList.remove('lm-hidden');
        this.note = note;
        this.render();
    }
    close() {
        this.el.classList.add('lm-hidden');
        if (Online.status === 'waiting' || Online.status === 'joining') leaveRoom();
    }
    isOpen() { return !this.el.classList.contains('lm-hidden'); }

    render() {
        if (!this.isOpen()) return;
        const box = this.q('[data-codebox]');
        const waiting = Online.role === 'host' && (Online.status === 'waiting');
        box.classList.toggle('lm-hidden', !(waiting || (Online.role === 'host' && Online.status === 'connected')));
        this.q('[data-code]').textContent = Online.code;
        this.q('[data-status]').textContent = Online.note || this.note || '';
        this.q('[data-status]').className = 'lm-status' + (Online.status === 'closed' ? ' bad' : '');
        this.q('[data-mode]').textContent = hasRealtime()
            ? 'Connected through the online server.'
            : 'No online server is set up in src/net/config.js yet, so rooms only work between two tabs or windows of this same browser (test mode).';
        if (Online.status === 'connected') {            // match is starting: get out of the way
            this.el.classList.add('lm-hidden');
        }
    }
}
