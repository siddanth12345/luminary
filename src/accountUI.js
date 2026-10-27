// Account bar (start screen) + sign-in dialog + toast notifications.
import { ACC, onAccount, displayName, getStats, signIn, signUp, signOut, playAsGuest, backend } from './account.js';
import { borgCount, getRequests, onBorgs } from './friends.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Toasts {
    constructor(root) { this.el = document.createElement('div'); this.el.className = 'lm-toasts'; root.appendChild(this.el); }
    show({ text, actions = [], ttl = 8000 }) {
        const n = document.createElement('div'); n.className = 'lm-toast';
        n.innerHTML = `<span>${esc(text)}</span>`;
        const close = () => { n.remove(); };
        for (const a of actions) {
            const b = document.createElement('button'); b.className = 'lm-btn lm-btn-sm' + (a.ghost ? ' lm-btn-ghost' : ''); b.textContent = a.label;
            b.addEventListener('click', (e) => { e.stopPropagation(); close(); a.fn && a.fn(); });
            n.appendChild(b);
        }
        this.el.appendChild(n);
        if (ttl) setTimeout(close, ttl);
        return n;
    }
}

export class AccountUI {
    constructor({ root, startScreen, openBorgs, onChange }) {
        this.openBorgs = openBorgs; this.onChange = onChange || (() => {});
        this.mode = 'login';

        // ---- bar on the start screen
        this.bar = document.createElement('div'); this.bar.className = 'lm-accbar';
        startScreen.appendChild(this.bar);
        this.bar.addEventListener('click', (e) => {
            const a = e.target.closest('[data-a]'); if (!a) return; e.stopPropagation();
            if (a.dataset.a === 'borgs') this.openBorgs();
            if (a.dataset.a === 'login') this.open('login');
            if (a.dataset.a === 'signup') this.open('signup');
            if (a.dataset.a === 'logout') this.logout();
        });

        // ---- dialog
        this.el = document.createElement('div'); this.el.className = 'lm-modal lm-hidden';
        this.el.innerHTML = `
            <div class="lm-panel lm-panel-sm" role="dialog" aria-label="Account">
                <div class="lm-head"><h2 data-title>Log in</h2><button class="lm-x" data-close aria-label="Close">✕</button></div>
                <div class="lm-body">
                    <div class="lm-tabs"><button class="lm-tab" data-mode="login">Log in</button><button class="lm-tab" data-mode="signup">Create account</button></div>
                    <form data-form autocomplete="off">
                        <label class="lm-field"><span>Username</span><input data-user maxlength="20" autocomplete="username" spellcheck="false"></label>
                        <label class="lm-field"><span>Password</span><input data-pass type="password" maxlength="20" autocomplete="current-password"></label>
                        <label class="lm-field" data-emailrow><span>Email (optional, only for contact)</span><input data-email type="email" maxlength="80" autocomplete="email" spellcheck="false"></label>
                        <label class="lm-check" data-transferrow><input type="checkbox" data-transfer checked><span>Bring my guest progress (borgs, record, controls) into this account</span></label>
                        <p class="lm-rules" data-rules>Username 3-20 letters, numbers or _. Password 3-20 characters with 1 uppercase, 1 lowercase and 1 number.</p>
                        <p class="lm-status bad" data-err></p>
                        <button class="lm-btn lm-wide-btn" type="submit" data-submit>Log in</button>
                    </form>
                    <div class="lm-or"><span>or</span></div>
                    <button class="lm-btn lm-btn-ghost lm-wide-btn" data-guest>Play as guest</button>
                    <p class="lm-note" data-backend></p>
                </div>
            </div>`;
        root.appendChild(this.el);
        this.q = (s) => this.el.querySelector(s);
        this.el.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
        this.q('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); this.submit(); });
        this.q('[data-guest]').addEventListener('click', () => { playAsGuest(); this.close(false); });
        this.el.addEventListener('click', (e) => { if (e.target === this.el || e.target.closest('[data-close]')) this.close(true); });
        for (const inp of this.el.querySelectorAll('input')) inp.addEventListener('keydown', (e) => e.stopPropagation());   // typing must not trigger game keys

        onAccount(() => this.renderBar());
        onBorgs(() => this.renderBar());
        this.renderBar();
    }

    renderBar() {
        const st = ACC.status;
        if (st === 'loading') { this.bar.innerHTML = '<span class="lm-acc-name">Loading account…</span>'; return; }
        if (st === 'signedOut') { this.bar.innerHTML = '<button class="lm-btn lm-btn-sm" data-a="login">Log in</button><button class="lm-btn lm-btn-sm lm-btn-ghost" data-a="signup">Create account</button>'; return; }
        const s = getStats(), pend = getRequests().incoming.filter(r => !r.splintered).length;
        this.bar.innerHTML = `
            <span class="lm-acc-name">${st === 'guest' ? '👤 ' : '✓ '}<b>${esc(displayName())}</b>${st === 'guest' ? ' <i>(guest)</i>' : ''}</span>
            <span class="lm-acc-rec">${s.wins}W · ${s.losses}L</span>
            <button class="lm-btn lm-btn-sm lm-btn-ghost" data-a="borgs">Borgs ${borgCount()}${pend ? `<em class="lm-badge">${pend}</em>` : ''}</button>
            ${st === 'guest' ? '<button class="lm-btn lm-btn-sm" data-a="login">Log in</button><button class="lm-btn lm-btn-sm lm-btn-ghost" data-a="signup">Sign up</button>' : '<button class="lm-btn lm-btn-sm lm-btn-ghost" data-a="logout">Log out</button>'}`;
    }

    setMode(m) {
        this.mode = m;
        const su = m === 'signup';
        this.q('[data-title]').textContent = su ? 'Create account' : 'Log in';
        this.q('[data-submit]').textContent = su ? 'Create account' : 'Log in';
        this.q('[data-emailrow]').classList.toggle('lm-hidden', !su);
        this.q('[data-rules]').classList.toggle('lm-hidden', !su);
        this.q('[data-transferrow]').classList.toggle('lm-hidden', ACC.status !== 'guest');
        this.q('[data-pass]').autocomplete = su ? 'new-password' : 'current-password';
        this.el.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
        this.q('[data-err]').textContent = '';
    }
    open(mode = 'login') {
        this.el.classList.remove('lm-hidden');
        this.q('[data-guest]').classList.toggle('lm-hidden', ACC.status === 'guest');
        this.q('[data-backend]').textContent = backend.name === 'local'
            ? 'No online server is set up (src/net/config.js), so accounts are saved in this browser only.'
            : 'Your account is saved on the online server.';
        this.setMode(mode);
        setTimeout(() => this.q('[data-user]').focus(), 50);
    }
    /** closing the dialog without choosing means "guest" (so the game is always playable) */
    close(asGuest) {
        this.el.classList.add('lm-hidden');
        if (asGuest && ACC.status === 'signedOut') playAsGuest();
    }
    async submit() {
        const u = this.q('[data-user]').value.trim(), p = this.q('[data-pass]').value, em = this.q('[data-email]').value.trim();
        const transfer = ACC.status === 'guest' && this.q('[data-transfer]').checked;
        const btn = this.q('[data-submit]'); btn.disabled = true; this.q('[data-err]').textContent = '';
        const err = this.mode === 'signup' ? await signUp(u, p, em, transfer) : await signIn(u, p, transfer);
        btn.disabled = false;
        if (err) { this.q('[data-err]').textContent = err; return; }
        this.q('[data-pass]').value = '';
        this.el.classList.add('lm-hidden');
        this.onChange();
    }
    async logout() { await signOut(); this.onChange(); this.open('login'); }
}
