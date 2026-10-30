// Loading screen: shows CBG, waits for the game to finish loading, then on Enter the button bursts into
// letters that fly in between C, B and G to spell Cool Battle Game, and the title glides to the start screen.
const L = document.getElementById('cbgLoader');
if (L) {
    const btn = document.getElementById('cbgEnter'), title = document.getElementById('loaderTitle'), real = document.getElementById('gameTitle');
    const ready = () => { btn.disabled = false; btn.firstElementChild.textContent = 'Press Enter'; btn.focus(); };
    const poll = setInterval(() => { if (window.__luminary) { clearInterval(poll); ready(); } }, 80);
    let started = false;
    const go = () => {
        if (started || btn.disabled) return; started = true;
        const r = btn.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        btn.style.visibility = 'hidden';
        const letters = 'COOLBATTLEGAME!'.split('');
        for (let i = 0; i < 22; i++) {                                   // the button explodes
            const sh = document.createElement('div'); sh.className = 'cbg-shard'; sh.textContent = letters[i % letters.length];
            sh.style.left = cx + 'px'; sh.style.top = cy + 'px'; document.body.appendChild(sh);
            const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 260;
            sh.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) rotate(${Math.random() * 540 - 270}deg) scale(.4)`, opacity: 0 }], { duration: 650 + Math.random() * 350, easing: 'cubic-bezier(.1,.7,.3,1)' }).onfinish = () => sh.remove();
        }
        setTimeout(() => { title.classList.remove('collapsed'); title.classList.add('pop'); }, 140);   // the letters take the button's place between C, B and G
        setTimeout(() => {                                                // glide the finished title onto the start screen's title
            const a = title.getBoundingClientRect(), b = real.getBoundingClientRect();
            const k = b.width / a.width;
            title.style.transition = 'transform .7s cubic-bezier(.6,0,.2,1)'; title.style.transformOrigin = 'center center';
            title.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(${k})`;
            L.classList.add('fade');
            setTimeout(() => { real.style.visibility = ''; L.classList.add('gone'); }, 760);
        }, 1050);
    };
    real.style.visibility = 'hidden';
    btn.addEventListener('click', go);
    window.addEventListener('keydown', (e) => { if (!started && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); go(); } }, true);
}
