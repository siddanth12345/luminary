// Chat panel: right side of the screen during online matches. Open with the chat key (/ by default),
// Enter sends, Esc / empty Enter closes.
import { getChat, onChat, sendChat, chatEnabled, clearChat } from './net/chat.js';
import { S } from './core.js';
import { Online } from './net/online.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class ChatUI {
    constructor({ root }) {
        this.open = false;
        this.el = document.createElement('div'); this.el.className = 'lm-chat lm-hidden';
        this.el.innerHTML = `<div class="lm-chat-list" data-list></div>
            <div class="lm-chat-in lm-hidden" data-row><input data-input maxlength="50" placeholder="Say something (max 50 characters)" autocomplete="off" spellcheck="false"><button class="lm-btn lm-btn-sm" data-send>Send</button></div>`;
        root.appendChild(this.el);
        this.list = this.el.querySelector('[data-list]'); this.row = this.el.querySelector('[data-row]'); this.input = this.el.querySelector('[data-input]');
        this.el.addEventListener('mousedown', (e) => e.stopPropagation());
        this.input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); const t = this.input.value.trim(); if (t) sendChat(t); this.close(); }
            else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
        });
        this.el.querySelector('[data-send]').addEventListener('click', () => { const t = this.input.value.trim(); if (t) sendChat(t); this.close(); });
        onChat(() => this.render());
        setInterval(() => this.sync(), 300);
    }
    visible() { return chatEnabled() && !!Online.role && (S.gameState === 'playing' || S.gameState === 'countdown' || S.gameState === 'gameover'); }
    sync() {
        const v = this.visible();
        this.el.classList.toggle('lm-hidden', !v);
        if (!v && this.open) this.close();
        if (!Online.role && getChat().length) clearChat();
    }
    toggle() { if (!this.visible()) return; this.open ? this.close() : this.openChat(); }
    openChat() {
        this.open = true; window.__luminaryChat = true;
        this.row.classList.remove('lm-hidden'); this.el.classList.add('lm-chat-open');
        setTimeout(() => this.input.focus(), 0); this.render();
    }
    close() {
        this.open = false; window.__luminaryChat = false;
        this.input.value = ''; this.input.blur();
        this.row.classList.add('lm-hidden'); this.el.classList.remove('lm-chat-open');
    }
    render() {
        const msgs = getChat();
        this.list.innerHTML = msgs.length ? msgs.map(m => `<div class="lm-msg"><b>{${esc(m.name)}}</b>: ${esc(m.text)}</div>`).join('') : '<div class="lm-msg dim">Press the chat key to type…</div>';
        this.list.scrollTop = this.list.scrollHeight;
    }
}
