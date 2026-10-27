// The Borgs panel (friends): list with online dots, requests, and "add a borg by exact username".
import { getBorgs, getRequests, onBorgs, removeBorg, isOnlineName, MAX_BORGS, markSplinteredFrom, removeIncoming } from './friends.js';
import { ACC, displayName } from './account.js';
import { sendBorgRequest, acceptRequest, declineRequest, cancelRequest, inviteBorg, inviteToLobby } from './net/inbox.js';
import { Online } from './net/online.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class BorgsUI {
    constructor({ root, toasts, onInviteSent }) {
        this.toasts = toasts; this.tab = 'borgs'; this.onInviteSent = onInviteSent || (() => {});
        this.el = document.createElement('div'); this.el.className = 'lm-modal lm-hidden';
        this.el.innerHTML = `
            <div class="lm-panel lm-panel-sm" role="dialog" aria-label="Borgs">
                <div class="lm-head"><h2>Borgs</h2><button class="lm-x" data-close aria-label="Close">✕</button></div>
                <div class="lm-tabs"><button class="lm-tab" data-tab="borgs">My borgs</button><button class="lm-tab" data-tab="reqs">Requests</button><button class="lm-tab" data-tab="add">Add a borg</button></div>
                <div class="lm-body" data-body></div>
            </div>`;
        root.appendChild(this.el);
        this.body = this.el.querySelector('[data-body]');
        this.el.addEventListener('click', (e) => {
            if (e.target === this.el || e.target.closest('[data-close]')) return this.close();
            const t = e.target.closest('[data-tab]'); if (t) { this.tab = t.dataset.tab; this.render(); return; }
            const b = e.target.closest('[data-act]'); if (b) this.act(b.dataset.act, b.dataset.name, b.dataset.id);
        });
        this.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && e.target.matches('[data-addname]')) this.send(); });
        onBorgs(() => { if (this.isOpen()) this.render(); });
    }
    isOpen() { return !this.el.classList.contains('lm-hidden'); }
    open(tab) { this._msg = null; if (tab) this.tab = tab; this.el.classList.remove('lm-hidden'); this.render(); }
    close() { this.el.classList.add('lm-hidden'); }

    say(msg, bad) { this._msg = { msg, bad }; const s = this.el.querySelector('[data-msg]'); if (s) { s.textContent = msg; s.className = 'lm-status' + (bad ? ' bad' : ''); } else this.toasts.show({ text: msg }); }

    async act(a, name, id) {
        const { incoming, outgoing } = getRequests();
        if (a === 'remove') { removeBorg(name); return; }
        if (a === 'invite') { const r = await inviteBorg(name, '1v1'); this.say(r.msg, !r.ok); if (r.ok) { this.close(); this.onInviteSent(); } return; }
        if (a === 'lobbyinvite') { const r = await inviteToLobby(name); this.say(r.msg, !r.ok); return; }
        if (a === 'accept') { const r = await acceptRequest(incoming.find(x => x.id === id) || { id, from: name }); this.say(r.msg, !r.ok); return; }
        if (a === 'decline') declineRequest({ id });
        if (a === 'dismiss') removeIncoming(id);
        if (a === 'cancel') cancelRequest({ id });
    }
    async send() {
        const inp = this.el.querySelector('[data-addname]'); if (!inp) return;
        const r = await sendBorgRequest(inp.value); this.say(r.msg, !r.ok); if (r.ok) inp.value = '';
    }

    render() {
        this.el.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === this.tab));
        const { incoming, outgoing } = getRequests(), bs = getBorgs();
        const pend = incoming.filter(r => !r.splintered).length;
        this.el.querySelector('[data-tab="reqs"]').textContent = 'Requests' + (pend ? ` (${pend})` : '');
        let h = '';
        if (this.tab === 'borgs') {
            if (!bs.length) h = '<p class="lm-note">No borgs yet. Add someone by their exact username in the "Add a borg" tab.</p>';
            const lobbyHost = Online.role === 'host' && Online.mode === 'lobby';
            h += bs.slice().sort((a, b) => isOnlineName(b.name) - isOnlineName(a.name) || a.name.localeCompare(b.name)).map(b => {
                const on = isOnlineName(b.name);
                return `<div class="lm-row"><span class="lm-dot${on ? ' on' : ''}"></span><span class="lm-bname">${esc(b.name)}${b.splintered ? ' <i>(left)</i>' : ''}</span>
                    ${on && !b.splintered ? `<button class="lm-btn lm-btn-sm" data-act="${lobbyHost ? 'lobbyinvite' : 'invite'}" data-name="${esc(b.name)}">${lobbyHost ? 'Invite to lobby' : 'Invite to 1v1'}</button>` : ''}
                    <button class="lm-btn lm-btn-sm lm-btn-ghost" data-act="remove" data-name="${esc(b.name)}">Remove</button></div>`;
            }).join('');
            h += `<p class="lm-note">${bs.length} / ${MAX_BORGS} borgs. A green dot means they are online right now.</p>`;
        } else if (this.tab === 'reqs') {
            h += '<h4 class="lm-group">Incoming</h4>' + (incoming.length ? incoming.map(r => r.splintered
                ? `<div class="lm-row"><span class="lm-bname">${esc(r.from)} <i>(left)</i></span><button class="lm-btn lm-btn-sm lm-btn-ghost" data-act="dismiss" data-id="${r.id}">Dismiss</button></div>`
                : `<div class="lm-row"><span class="lm-bname">${esc(r.from)}</span><button class="lm-btn lm-btn-sm" data-act="accept" data-id="${r.id}" data-name="${esc(r.from)}">Accept</button><button class="lm-btn lm-btn-sm lm-btn-ghost" data-act="decline" data-id="${r.id}">Decline</button></div>`).join('') : '<p class="lm-note">Nothing waiting.</p>');
            h += '<h4 class="lm-group">Sent</h4>' + (outgoing.length ? outgoing.map(r => `<div class="lm-row"><span class="lm-bname">${esc(r.to)}</span><button class="lm-btn lm-btn-sm lm-btn-ghost" data-act="cancel" data-id="${r.id}">Cancel</button></div>`).join('') : '<p class="lm-note">Nothing sent.</p>');
        } else {
            h = `<p class="lm-note">Type their exact username (or a guest name like guest482913) and send a borg request. They have to accept it.</p>
                <div class="lm-joinrow lm-addrow"><input data-addname maxlength="20" placeholder="username" autocomplete="off" spellcheck="false"><button class="lm-btn" data-act="send">Send request</button></div>
                <p class="lm-note">Your name is <b>${esc(displayName())}</b>${ACC.status === 'guest' ? ' (guests only exist while this tab is open)' : ''}.</p>`;
        }
        h += '<p class="lm-status" data-msg></p>';
        const keep = this.el.querySelector('[data-addname]') ? this.el.querySelector('[data-addname]').value : '';
        this.body.innerHTML = h;
        const inp = this.el.querySelector('[data-addname]'); if (inp) inp.value = keep;
        if (this._msg) { const m = this.el.querySelector('[data-msg]'); m.textContent = this._msg.msg; m.className = 'lm-status' + (this._msg.bad ? ' bad' : ''); }
        const sendBtn = this.el.querySelector('[data-act="send"]'); if (sendBtn) sendBtn.addEventListener('click', (e) => { e.stopPropagation(); this.send(); });
    }
}
