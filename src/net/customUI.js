// Custom match: create / join a lobby (up to 8 players), pick FFA or teams, starting damage and stocks.
import { S } from '../core.js';
import { Online, hostRoom, joinRoom, leaveRoom, setLobbySetting, setMemberTeam, kickMember, beginLobbyMatch } from './online.js';
import { Party } from './party.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TEAMS = { red: '#ef4444', blue: '#3b82f6', yellow: '#facc15', green: '#22c55e' };

export class CustomUI {
    constructor({ root, openBtn, openBorgs }) {
        this.openBorgs = openBorgs || (() => {});
        this.el = document.createElement('div');
        this.el.className = 'lm-modal lm-hidden';
        this.el.innerHTML = `<div class="lm-panel" role="dialog" aria-label="Custom match">
            <div class="lm-head"><h2>Custom match</h2><button class="lm-x" data-close aria-label="Close">✕</button></div>
            <div class="lm-body" data-body></div></div>`;
        root.appendChild(this.el);
        this.body = this.el.querySelector('[data-body]');
        this.joinCode = '';
        this.el.addEventListener('click', (e) => this.onClick(e));
        this.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && e.target.matches('[data-code-in]')) this.join(); });
        this.el.addEventListener('input', (e) => {
            if (e.target.matches('[data-code-in]')) { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); this.joinCode = e.target.value; }
        });
        this.el.addEventListener('change', (e) => {
            if (e.target.matches('[data-dmg]')) setLobbySetting('startDamage', Math.max(0, Math.min(300, parseInt(e.target.value, 10) || 0)));
            if (e.target.matches('[data-stocks]')) setLobbySetting('stocks', Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 3)));
        });
        const prev = Online.onChange;
        Online.onChange = () => { prev(); this.sync(); };
        if (openBtn) openBtn.addEventListener('click', (e) => { e.stopPropagation(); this.open(); });
    }
    inLobby() { return Online.mode === 'lobby' && !!Online.role && Online.status === 'connected' && !Online.lobby.started; }
    isOpen() { return !this.el.classList.contains('lm-hidden'); }
    open() { this.el.classList.remove('lm-hidden'); this.msg = ''; this.render(); }
    hide() { this.el.classList.add('lm-hidden'); }
    sync() {
        if (this.inLobby() && !this.isOpen()) { this.el.classList.remove('lm-hidden'); }
        if (!this.inLobby() && this.isOpen() && (Online.lobby.started || S.online)) this.hide();   // the match began
        if (this.isOpen()) this.render();
    }

    async create() { this.msg = 'Opening lobby…'; this.render(); const ok = await hostRoom(undefined, 'lobby'); if (!ok) { this.msg = Online.note || 'Could not open a lobby'; this.render(); } }
    async join() { this.msg = 'Joining…'; this.render(); const ok = await joinRoom(this.joinCode); if (ok === false) { this.msg = Online.note || 'Could not join'; this.render(); } }

    onClick(e) {
        if (e.target === this.el) return this.hide();
        if (e.target.closest('[data-close]')) { if (this.inLobby()) leaveRoom(); this.hide(); return; }
        const b = e.target.closest('[data-a]'); if (!b) return;
        const a = b.dataset.a;
        if (a === 'create') this.create();
        else if (a === 'join') this.join();
        else if (a === 'leave') { leaveRoom(); this.msg = ''; this.render(); }
        else if (a === 'start') { if (!beginLobbyMatch()) { this.msg = Online.note; this.render(); } }
        else if (a === 'mode') setLobbySetting('teams', b.dataset.v === 'teams');
        else if (a === 'team') setMemberTeam(+b.dataset.slot, b.dataset.team);
        else if (a === 'kick') kickMember(+b.dataset.slot);
        else if (a === 'borgs') this.openBorgs();
        else if (a === 'party') {
            if (Party.role === 'leader' && Party.t) { for (let i = 0; i < 3; i++) setTimeout(() => Party.t && Party.t.send({ t: 'go', kind: 'lobby', code: Online.code }), i * 300); this.msg = 'Party invited.'; }
            else this.msg = 'Create a party (Party button) and invite borgs first.';
            this.render();
        } else if (a === 'copy') { try { navigator.clipboard.writeText(Online.code); this.msg = 'Code copied.'; } catch (err) { /* blocked */ } this.render(); }
    }

    render() {
        if (!this.isOpen()) return;
        const keepFocus = this.body.querySelector('[data-code-in]') === document.activeElement;
        if (!this.inLobby()) {
            this.body.innerHTML = `
                <p class="lm-note">Up to <b>8 players</b>, a <b>2.5x bigger</b> stage and kill zone with Battlefield-style platforms. Free-for-all or red / blue / yellow / green teams.</p>
                <div class="lm-online-split">
                    <div class="lm-card"><h4>Create a lobby</h4><p>You host. Share the 4-letter code, invite borgs or bring your party.</p><button class="lm-btn" data-a="create">Create lobby</button></div>
                    <div class="lm-card"><h4>Join with a code</h4><div class="lm-joinrow"><input data-code-in maxlength="4" placeholder="ABCD" value="${esc(this.joinCode)}" autocomplete="off" spellcheck="false"><button class="lm-btn" data-a="join">Join</button></div></div>
                </div>
                <p class="lm-status${/could|no |full|lost|already|removed/i.test(this.msg || Online.note) ? ' bad' : ''}">${esc(this.msg || (Online.status === 'closed' ? Online.note : ''))}</p>`;
            if (keepFocus) this.body.querySelector('[data-code-in]').focus();
            return;
        }
        const L = Online.lobby, host = Online.role === 'host', st = L.settings, me = Online.slot;
        const rows = L.members.slice().sort((a, b) => a.slot - b.slot).map((m) => {
            const mine = m.slot === me;
            const chips = st.teams ? Object.keys(TEAMS).map(t => `<button class="lm-chip${m.team === t ? ' on' : ''}" style="--c:${TEAMS[t]}" title="${t}" ${(host || mine) ? `data-a="team" data-slot="${m.slot}" data-team="${t}"` : 'disabled'}></button>`).join('') : '';
            return `<div class="lm-prow"><span class="lm-dot" style="background:${st.teams ? TEAMS[m.team] : '#64748b'}"></span><b>${esc(m.name)}</b>${m.slot === 0 ? '<i>host</i>' : ''}${mine ? '<i>you</i>' : ''}<span class="lm-sp"></span>${chips}${host && m.slot !== 0 ? `<button class="lm-btn lm-btn-ghost lm-mini" data-a="kick" data-slot="${m.slot}">Kick</button>` : ''}</div>`;
        }).join('');
        const ctl = host ? `
            <div class="lm-card"><h4>Match settings</h4>
              <div class="lm-setrow"><span>Mode</span><span><button class="lm-btn ${st.teams ? 'lm-btn-ghost' : ''} lm-mini" data-a="mode" data-v="ffa">Free for all</button> <button class="lm-btn ${st.teams ? '' : 'lm-btn-ghost'} lm-mini" data-a="mode" data-v="teams">Teams</button></span></div>
              <div class="lm-setrow"><span>Starting damage %</span><input data-dmg type="number" min="0" max="300" step="10" value="${st.startDamage}"></div>
              <div class="lm-setrow"><span>Stocks</span><input data-stocks type="number" min="1" max="10" value="${st.stocks}"></div>
            </div>` : `<div class="lm-card"><h4>Match settings</h4><p>${st.teams ? 'Teams' : 'Free for all'} • starting damage ${st.startDamage}% • ${st.stocks} stocks</p><p class="lm-note">Waiting for the host to start. Pick your team with the colored dots.</p></div>`;
        this.body.innerHTML = `
            <div class="lm-codebar"><div class="lm-code"><span>LOBBY CODE</span><b>${esc(Online.code)}</b></div><button class="lm-btn lm-btn-ghost lm-mini" data-a="copy">Copy</button>
              ${host ? '<button class="lm-btn lm-btn-ghost lm-mini" data-a="borgs">Invite borgs</button><button class="lm-btn lm-btn-ghost lm-mini" data-a="party">Invite party</button>' : ''}</div>
            <div class="lm-online-split">
              <div class="lm-card"><h4>Players ${L.members.length} / 8</h4>${rows}</div>
              ${ctl}
            </div>
            <p class="lm-status${/need/i.test(this.msg || Online.note) ? ' bad' : ''}">${esc(this.msg || Online.note || '')}</p>
            <div class="lm-foot2">${host ? `<button class="lm-btn" data-a="start" ${L.members.length < 2 ? 'disabled' : ''}>Start match</button>` : ''}<button class="lm-btn lm-btn-ghost" data-a="leave">Leave lobby</button></div>`;
    }
}
