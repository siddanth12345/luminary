// Party panel: leader invites borgs, sees members, kicks, and launches a 1v1 or custom match together.
import { Party, PARTY_MAX, createParty, joinParty, leaveParty, kickFromParty, partyGo } from './party.js';
import { getBorgs, isOnlineName } from '../friends.js';
import { inviteToParty } from './inbox.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class PartyUI {
    constructor({ root, openBtn, toasts }) {
        this.toasts = toasts; this.msg = ''; this.joinCode = '';
        this.el = document.createElement('div'); this.el.className = 'lm-modal lm-hidden';
        this.el.innerHTML = `<div class="lm-panel lm-panel-sm" role="dialog" aria-label="Party"><div class="lm-head"><h2>Party</h2><button class="lm-x" data-close aria-label="Close">✕</button></div><div class="lm-body" data-body></div></div>`;
        root.appendChild(this.el);
        this.body = this.el.querySelector('[data-body]');
        this.el.addEventListener('click', (e) => this.onClick(e));
        this.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && e.target.matches('[data-pcode]')) joinParty(this.joinCode); });
        this.el.addEventListener('input', (e) => { if (e.target.matches('[data-pcode]')) { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); this.joinCode = e.target.value; } });
        const prev = Party.onChange;
        Party.onChange = () => { prev(); if (this.isOpen()) this.render(); };
        if (openBtn) openBtn.addEventListener('click', (e) => { e.stopPropagation(); this.open(); });
    }
    isOpen() { return !this.el.classList.contains('lm-hidden'); }
    open() { this.msg = ''; this.el.classList.remove('lm-hidden'); this.render(); }
    close() { this.el.classList.add('lm-hidden'); }
    async onClick(e) {
        if (e.target === this.el || e.target.closest('[data-close]')) return this.close();
        const b = e.target.closest('[data-a]'); if (!b) return;
        const a = b.dataset.a;
        if (a === 'create') await createParty();
        else if (a === 'join') await joinParty(this.joinCode);
        else if (a === 'leave') leaveParty(true);
        else if (a === 'kick') kickFromParty(b.dataset.id);
        else if (a === 'invite') { const r = await inviteToParty(b.dataset.name, Party.code); this.msg = r.msg; }
        else if (a === 'go') { const r = await partyGo(b.dataset.kind); this.msg = r.msg; if (r.ok) this.close(); }
        this.render();
    }
    render() {
        const leader = Party.role === 'leader';
        if (!Party.role) {
            this.body.innerHTML = `<p class="lm-note">A party keeps you and up to <b>${PARTY_MAX - 1}</b> borgs together. The leader launches a 1v1 or a custom match and everyone joins.</p>
              <button class="lm-btn" data-a="create">Create a party</button>
              <div class="lm-joinrow" style="margin-top:12px"><input data-pcode maxlength="4" placeholder="CODE" value="${esc(this.joinCode)}" autocomplete="off" spellcheck="false"><button class="lm-btn lm-btn-ghost" data-a="join">Join party</button></div>
              <p class="lm-status${/no |lost|full|removed|disband|letters|could/i.test(Party.note) ? ' bad' : ''}">${esc(Party.note || this.msg)}</p>`;
            return;
        }
        const mem = Party.members.map((m, i) => `<div class="lm-prow"><b>${esc(m.name)}</b>${i === 0 ? '<i>leader</i>' : ''}<span class="lm-sp"></span>${leader && i > 0 ? `<button class="lm-btn lm-btn-ghost lm-mini" data-a="kick" data-id="${esc(m.id)}">Kick</button>` : ''}</div>`).join('');
        const inParty = new Set(Party.members.map(m => m.name.toLowerCase()));
        const inv = leader ? getBorgs().filter(b => isOnlineName(b.name) && !inParty.has(b.name.toLowerCase())).map(b => `<div class="lm-prow"><span class="lm-dot" style="background:#22c55e"></span><b>${esc(b.name)}</b><span class="lm-sp"></span><button class="lm-btn lm-mini" data-a="invite" data-name="${esc(b.name)}"${Party.members.length >= PARTY_MAX ? ' disabled' : ''}>Invite</button></div>`).join('') || '<p class="lm-note">No borgs online to invite.</p>' : '';
        this.body.innerHTML = `<div class="lm-codebar"><div class="lm-code"><span>PARTY CODE</span><b>${esc(Party.code)}</b></div></div>
            <div class="lm-card"><h4>Members ${Party.members.length} / ${PARTY_MAX}</h4>${mem}</div>
            ${leader ? `<div class="lm-card"><h4>Invite borgs</h4>${inv}</div>
              <div class="lm-foot2"><button class="lm-btn" data-a="go" data-kind="1v1">Play 1v1</button><button class="lm-btn" data-a="go" data-kind="lobby">Custom match</button><button class="lm-btn lm-btn-ghost" data-a="leave">Disband</button></div>`
              : `<p class="lm-note">Waiting for the leader to start a match.</p><div class="lm-foot2"><button class="lm-btn lm-btn-ghost" data-a="leave">Leave party</button></div>`}
            <p class="lm-status${/needs|only|first|Leave|could/i.test(this.msg) ? ' bad' : ''}">${esc(this.msg || Party.note)}</p>`;
    }
}
