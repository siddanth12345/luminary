// Character select: every character is a half-profile card. The whole card is the select button;
// the Info button on it shows what the character does.
import { CHAR_IDS, CHARS, getMyChar, setMyChar, portraitSVG } from './characters.js';

const ACCENTS = { luminent: '#22d3ee', bulwark: '#60a5fa', zephyr: '#34d399', ember: '#fb923c', tide: '#38bdf8', volt: '#facc15', umbra: '#a78bfa', terra: '#a8a29e' };

export class CharUI {
    constructor({ root, openBtn }) {
        this.el = document.createElement('div');
        this.el.className = 'lm-modal lm-hidden';
        this.el.innerHTML = `<div class="lm-panel" role="dialog" aria-label="Characters">
            <div class="lm-head"><h2>Characters</h2><button class="lm-x" data-close aria-label="Close">✕</button></div>
            <div class="lm-body"><p class="lm-note">Pick who you fight as. Bots in Easy / Medium / Hard and training use your character. All melee hitboxes are identical; characters differ in walk speed, a few special tunings, and how they look and move. In a custom match the host can pick a character for each bot.</p>
            <div class="ch-grid" data-grid></div></div></div>`;
        root.appendChild(this.el);
        this.grid = this.el.querySelector('[data-grid]');
        this.open_ = new Set();
        this.el.addEventListener('click', (e) => {
            if (e.target === this.el || e.target.closest('[data-close]')) return this.hide();
            const info = e.target.closest('[data-info]');
            if (info) { e.stopPropagation(); const id = info.dataset.info; if (this.open_.has(id)) this.open_.delete(id); else this.open_.add(id); this.render(); return; }
            const card = e.target.closest('[data-pick]');
            if (card) { setMyChar(card.dataset.pick); this.render(); }
        });
        this.el.addEventListener('keydown', (e) => { e.stopPropagation(); if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-pick]')) { e.preventDefault(); setMyChar(e.target.dataset.pick); this.render(); } });
        if (openBtn) openBtn.addEventListener('click', (e) => { e.stopPropagation(); this.open(); });
    }
    open() { this.el.classList.remove('lm-hidden'); this.render(); }
    hide() { this.el.classList.add('lm-hidden'); }
    render() {
        const mine = getMyChar();
        this.grid.innerHTML = CHAR_IDS.map((id) => {
            const c = CHARS[id], on = id === mine, acc = ACCENTS[id];
            const spd = Math.round(c.walk * 100);
            return `<div class="ch-card${on ? ' on' : ''}" style="--ac:${acc}">
                <div class="ch-pick" role="button" tabindex="0" data-pick="${id}" aria-pressed="${on}" aria-label="Select ${c.name}">
                    <div class="ch-art">${portraitSVG(id, acc)}</div>
                    <div class="ch-meta"><b>${c.name}</b><span>${c.role}</span>
                        <div class="ch-bar" title="Walk speed ${spd}%"><i style="width:${Math.min(100, spd / 1.4)}%"></i></div></div>
                    ${on ? '<em class="ch-tag">Equipped</em>' : ''}
                    <button class="lm-btn lm-btn-ghost lm-mini ch-info" data-info="${id}" aria-expanded="${this.open_.has(id)}">${this.open_.has(id) ? 'Hide' : 'Info'}</button>
                </div>
                ${this.open_.has(id) ? `<p class="ch-desc">${c.desc}<br><small>Walk speed ${spd}%</small></p>` : ''}
            </div>`;
        }).join('');
    }
}
