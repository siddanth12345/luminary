// Custom match: create / join a lobby (up to 8 players), pick FFA or teams, starting damage and stocks.
import { S } from '../core.js';
import { Online, hostRoom, joinRoom, leaveRoom, setLobbySetting, setMemberTeam, setMemberChar, kickMember, beginLobbyMatch, addBot } from './online.js';
import { Party } from './party.js';
import { CHAR_IDS, CHARS, charOf } from '../characters.js';
import { ITEM_TYPES, ITEM_INFO, ITEM_INTERVAL_MIN, ITEM_INTERVAL_MAX } from '../items.js';

// ---- saved custom settings (up to 10, stored on this device)
const PKEY = 'luminary.presets.v1', MAX_PRESETS = 10;
const SKEYS = ['teams', 'startDamage', 'stocks', 'mode', 'timeLimit', 'items'];
const loadPresets = () => { try { const a = JSON.parse(localStorage.getItem(PKEY) || '[]'); return Array.isArray(a) ? a.slice(0, MAX_PRESETS) : []; } catch (e) { return []; } };
const savePresets = (a) => { try { localStorage.setItem(PKEY, JSON.stringify(a)); } catch (e) { /* storage blocked */ } };
const pickSettings = (st) => JSON.parse(JSON.stringify(Object.fromEntries(SKEYS.map(k => [k, st[k]]))));
const describe = (st) => `${st.teams ? 'Teams' : 'FFA'} • ${st.mode === 'timer' ? st.timeLimit + ' min timer' : st.stocks + ' stocks'} • ${st.startDamage}%${st.items && st.items.on ? ' • items' : ''}`;

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
        this.joinCode = ''; this.presets = loadPresets(); this.renaming = null; this.descOpen = new Set(); this.msg2 = '';
        this.el.addEventListener('click', (e) => this.onClick(e));
        this.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && e.target.matches('[data-code-in]')) this.join(); });
        this.el.addEventListener('input', (e) => {
            if (e.target.matches('[data-dmg]')) { const v = Math.max(0, Math.min(249, parseInt(e.target.value, 10) || 0)); setLobbySetting('startDamage', v); }
            if (e.target.matches('[data-stocks]')) { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= 10) setLobbySetting('stocks', v); }
            if (e.target.matches('[data-tlim]')) { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= 10) setLobbySetting('timeLimit', v); }
            if (e.target.matches('[data-code-in]')) { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); this.joinCode = e.target.value; }
        });
        this.el.addEventListener('change', (e) => {
            if (e.target.matches('[data-charsel]')) setMemberChar(+e.target.dataset.slot, e.target.value);
            if (e.target.matches('[data-dmg]')) setLobbySetting('startDamage', Math.max(0, Math.min(249, parseInt(e.target.value, 10) || 0)));
            if (e.target.matches('[data-stocks]')) setLobbySetting('stocks', Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 3)));
            if (e.target.matches('[data-tlim]')) setLobbySetting('timeLimit', Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 5)));
            if (e.target.matches('[data-ival]')) this.setItems({ interval: Math.max(ITEM_INTERVAL_MIN, Math.min(ITEM_INTERVAL_MAX, parseInt(e.target.value, 10) || 15)) });
        });
        this.el.addEventListener('keydown', (e) => {
            if (e.target.matches('[data-rename]')) { if (e.key === 'Enter') this.commitRename(e.target); else if (e.key === 'Escape') { this.renaming = null; e.target.blur(); this.render(); } }
        });
        this.el.addEventListener('focusout', (e) => { if (e.target.matches && e.target.matches('[data-rename]') && this.renaming) this.commitRename(e.target); });
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

    items() { const i = (Online.lobby.settings.items) || {}; return { on: !!i.on, types: (i.types || ITEM_TYPES).slice(), interval: i.interval || 15 }; }
    setItems(patch) { setLobbySetting('items', { ...this.items(), ...patch }); }
    commitRename(inp) {
        const id = this.renaming; this.renaming = null;
        const p = this.presets.find(x => x.id === id);
        const v = inp.value.trim().replace(/\s+/g, ' ').slice(0, 24);
        if (p && v) { p.name = v; savePresets(this.presets); }
        if (document.activeElement === inp) inp.blur();
        this.render();
    }

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
        else if (a === 'bot') { if (!addBot(b.dataset.level)) { this.msg = 'The lobby is full (8)'; this.render(); } }
        else if (a === 'dmg') { const st = Online.lobby.settings; setLobbySetting(b.dataset.k, Math.max(b.dataset.k === 'stocks' || b.dataset.k === 'timeLimit' ? 1 : 0, Math.min(b.dataset.k === 'stocks' ? 10 : b.dataset.k === 'timeLimit' ? 10 : 249, (+st[b.dataset.k] || 0) + (+b.dataset.d)))); }
        else if (a === 'smode') setLobbySetting('mode', b.dataset.v);
        else if (a === 'itemson') this.setItems({ on: !this.items().on });
        else if (a === 'itemall') { const it = this.items(); this.setItems({ types: it.types.length === ITEM_TYPES.length ? [] : ITEM_TYPES.slice() }); }
        else if (a === 'item') { const it = this.items(), t = b.dataset.t; this.setItems({ types: it.types.includes(t) ? it.types.filter(x => x !== t) : ITEM_TYPES.filter(x => x === t || it.types.includes(x)) }); }
        else if (a === 'idesc') { const t = b.dataset.t; if (this.descOpen.has(t)) this.descOpen.delete(t); else this.descOpen.add(t); this.render(); }
        else if (a === 'ival') this.setItems({ interval: Math.max(ITEM_INTERVAL_MIN, Math.min(ITEM_INTERVAL_MAX, this.items().interval + (+b.dataset.d))) });
        else if (a === 'psave') {
            if (this.presets.length >= MAX_PRESETS) { this.msg2 = 'You can save up to 10 settings. Delete one first.'; this.render(); return; }
            let n = 1; while (this.presets.some(x => x.name === 'Setting ' + n)) n++;
            this.presets.push({ id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 99), name: 'Setting ' + n, s: pickSettings(Online.lobby.settings) });
            savePresets(this.presets); this.msg2 = ''; this.render();
        }
        else if (a === 'papply') { const p = this.presets.find(x => x.id === b.dataset.id); if (p) { for (const k of SKEYS) setLobbySetting(k, JSON.parse(JSON.stringify(p.s[k]))); this.msg2 = 'Loaded "' + p.name + '".'; this.render(); } }
        else if (a === 'pupdate') { const p = this.presets.find(x => x.id === b.dataset.id); if (p) { p.s = pickSettings(Online.lobby.settings); savePresets(this.presets); this.msg2 = 'Updated "' + p.name + '" with the current settings.'; this.render(); } }
        else if (a === 'pdel') { this.presets = this.presets.filter(x => x.id !== b.dataset.id); savePresets(this.presets); this.msg2 = ''; this.render(); }
        else if (a === 'prename') { this.renaming = b.dataset.id; this.render(); const inp = this.body.querySelector('[data-rename]'); if (inp) { inp.focus(); inp.select(); } }
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
        const ae = document.activeElement;
        if (this.inLobby() && ae && this.body.contains(ae) && ae.matches('input')) return;   // don't rebuild while someone is typing a setting
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
            const canTeam = host || mine;
            const chips = st.teams ? Object.keys(TEAMS).map(t => `<button class="lm-chip${m.team === t ? ' on' : ''}" style="--c:${TEAMS[t]}" title="${t}" ${(host || mine) ? `data-a="team" data-slot="${m.slot}" data-team="${t}"` : 'disabled'}></button>`).join('') : '';
            return `<div class="lm-prow"><span class="lm-dot" style="background:${st.teams ? TEAMS[m.team] : '#64748b'}"></span><b>${esc(m.name)}</b>${m.slot === 0 ? '<i>host</i>' : ''}${m.bot ? '<i>cpu</i>' : ''}${mine ? '<i>you</i>' : ''}${host && m.bot ? `<select class="lm-charsel" data-charsel data-slot="${m.slot}" aria-label="Character">${CHAR_IDS.map(c => `<option value="${c}"${c === (m.char || 'luminent') ? ' selected' : ''}>${CHARS[c].name}</option>`).join('')}</select>` : `<i>${esc(charOf(m.char).name)}</i>`}<span class="lm-sp"></span>${chips}${host && m.slot !== 0 ? `<button class="lm-btn lm-btn-ghost lm-mini" data-a="kick" data-slot="${m.slot}">${m.bot ? 'Remove' : 'Kick'}</button>` : ''}</div>`;
        }).join('');
        const it = this.items(), timer = st.mode === 'timer';
        const itemRows = ITEM_TYPES.map(t => { const on = it.types.includes(t), inf = ITEM_INFO[t];
            return `<div class="lm-item${on ? ' on' : ''}"><button class="lm-itemrow" data-a="item" data-t="${t}" aria-pressed="${on}"><span class="lm-ico">${inf.icon}</span><b>${inf.name}</b><span class="lm-tick">${on ? '✓' : ''}</span></button><button class="lm-btn lm-btn-ghost lm-mini" data-a="idesc" data-t="${t}" title="What does it do?">${this.descOpen.has(t) ? 'Hide' : 'Info'}</button>${this.descOpen.has(t) ? `<p class="lm-idesc">${esc(inf.desc)}</p>` : ''}</div>`; }).join('');
        const itemsBlock = `<div class="lm-setrow"><span>Item spawner</span><span><button class="lm-btn ${it.on ? '' : 'lm-btn-ghost'} lm-mini" data-a="itemson">${it.on ? 'On' : 'Off'}</button></span></div>` + (it.on ? `
              <div class="lm-items"><div class="lm-itemhead"><span>Items that can spawn</span><button class="lm-btn lm-btn-ghost lm-mini" data-a="itemall">${it.types.length === ITEM_TYPES.length ? 'Deselect all' : 'Select all'}</button></div>${itemRows}
              <div class="lm-setrow"><span>Spawn every (seconds)</span><span class="lm-step"><button class="lm-btn lm-btn-ghost lm-mini" data-a="ival" data-d="-5">−</button><input data-ival type="number" min="${ITEM_INTERVAL_MIN}" max="${ITEM_INTERVAL_MAX}" step="5" value="${it.interval}"><button class="lm-btn lm-btn-ghost lm-mini" data-a="ival" data-d="5">+</button></span></div></div>` : '');
        const ctl = host ? `
            <div class="lm-card"><h4>Match settings</h4>
              <div class="lm-setrow"><span>Mode</span><span><button class="lm-btn ${st.teams ? 'lm-btn-ghost' : ''} lm-mini" data-a="mode" data-v="ffa">Free for all</button> <button class="lm-btn ${st.teams ? '' : 'lm-btn-ghost'} lm-mini" data-a="mode" data-v="teams">Teams</button></span></div>
              <div class="lm-setrow"><span>Win by</span><span><button class="lm-btn ${timer ? 'lm-btn-ghost' : ''} lm-mini" data-a="smode" data-v="stock">Stocks</button> <button class="lm-btn ${timer ? '' : 'lm-btn-ghost'} lm-mini" data-a="smode" data-v="timer">Timer (kills)</button></span></div>
              <div class="lm-setrow"><span>Starting damage %</span><span class="lm-step"><button class="lm-btn lm-btn-ghost lm-mini" data-a="dmg" data-k="startDamage" data-d="-10">−</button><input data-dmg type="number" min="0" max="249" step="10" value="${st.startDamage}"><button class="lm-btn lm-btn-ghost lm-mini" data-a="dmg" data-k="startDamage" data-d="10">+</button></span></div>
              ${timer
                ? `<div class="lm-setrow"><span>Time limit (min)</span><span class="lm-step"><button class="lm-btn lm-btn-ghost lm-mini" data-a="dmg" data-k="timeLimit" data-d="-1">−</button><input data-tlim type="number" min="1" max="10" value="${st.timeLimit}"><button class="lm-btn lm-btn-ghost lm-mini" data-a="dmg" data-k="timeLimit" data-d="1">+</button></span></div>`
                : `<div class="lm-setrow"><span>Stocks</span><span class="lm-step"><button class="lm-btn lm-btn-ghost lm-mini" data-a="dmg" data-k="stocks" data-d="-1">−</button><input data-stocks type="number" min="1" max="10" value="${st.stocks}"><button class="lm-btn lm-btn-ghost lm-mini" data-a="dmg" data-k="stocks" data-d="1">+</button></span></div>`}
              ${itemsBlock}
              <div class="lm-setrow"><span>Add CPU</span><span><button class="lm-btn lm-btn-ghost lm-mini" data-a="bot" data-level="easy">Easy</button> <button class="lm-btn lm-btn-ghost lm-mini" data-a="bot" data-level="medium">Medium</button> <button class="lm-btn lm-btn-ghost lm-mini" data-a="bot" data-level="hard">Hard</button></span></div>
            </div>` : `<div class="lm-card"><h4>Match settings</h4><p>${esc(describe(st))}</p>${st.items && st.items.on ? `<p class="lm-note">Items: ${(st.items.types || []).map(t => ITEM_INFO[t].icon + ' ' + ITEM_INFO[t].name).join(', ') || 'none'} every ${st.items.interval}s</p>` : ''}<p class="lm-note">Waiting for the host to start. Pick your team with the colored dots.</p></div>`;
        const presetRows = this.presets.map(p => `<div class="lm-preset">
              <div class="lm-pmain">${this.renaming === p.id ? `<input data-rename maxlength="24" value="${esc(p.name)}">` : `<button class="lm-pname" data-a="papply" data-id="${p.id}" title="Load these settings"><b>${esc(p.name)}</b><small>${esc(describe(p.s))}</small></button>`}</div>
              <div class="lm-pbtns"><button class="lm-btn lm-btn-ghost lm-mini" data-a="prename" data-id="${p.id}">Rename</button><button class="lm-btn lm-btn-ghost lm-mini" data-a="pupdate" data-id="${p.id}" title="Overwrite with the current settings">Update</button><button class="lm-btn lm-btn-ghost lm-mini lm-danger" data-a="pdel" data-id="${p.id}">Delete</button></div></div>`).join('');
        const presetCard = host ? `<div class="lm-card"><h4>Saved settings ${this.presets.length} / ${MAX_PRESETS}</h4>
              <button class="lm-btn lm-mini" data-a="psave" ${this.presets.length >= MAX_PRESETS ? 'disabled' : ''}>Save current as setting</button>
              <div class="lm-plist">${presetRows || '<p class="lm-note">No saved settings yet. Set things up, then save them here to reuse later.</p>'}</div>
              ${this.msg2 ? `<p class="lm-note">${esc(this.msg2)}</p>` : ''}</div>` : '';
        this.body.innerHTML = `
            <div class="lm-codebar"><div class="lm-code"><span>LOBBY CODE</span><b>${esc(Online.code)}</b></div><button class="lm-btn lm-btn-ghost lm-mini" data-a="copy">Copy</button>
              ${host ? '<button class="lm-btn lm-btn-ghost lm-mini" data-a="borgs">Invite borgs</button><button class="lm-btn lm-btn-ghost lm-mini" data-a="party">Invite party</button>' : ''}</div>
            <div class="lm-online-split lm-three">
              <div class="lm-card"><h4>Players ${L.members.length} / 8</h4>${rows}</div>
              ${ctl}
              ${presetCard}
            </div>
            <p class="lm-status${/need/i.test(this.msg || Online.note) ? ' bad' : ''}">${esc(this.msg || Online.note || '')}</p>
            <div class="lm-foot2">${host ? `<button class="lm-btn" data-a="start" ${L.members.length < 2 ? 'disabled' : ''}>Start match</button>` : ''}<button class="lm-btn lm-btn-ghost" data-a="leave">Leave lobby</button></div>`;
    }
}
