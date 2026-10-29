// The 3D arena: a floating neon platform, a huge "luminary" halo behind it, a starfield,
// drifting rocks and the dashed blast-zone frame. Collision is still the original
// rectangle, so what you see is exactly what you stand on.
import * as THREE from 'three';
import { STAGE, BLAST_ZONES } from '../core.js';
import { wx, wy } from './space.js';

export const STAGE_DEPTH = 560;

function canvasTex(w, h, draw, srgb = true) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
}

function glowMat(color, intensity = 2) {
    const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).multiplyScalar(0.25),
        emissive: new THREE.Color(color),
        emissiveIntensity: intensity,
        roughness: 0.4,
        metalness: 0.1,
    });
    return m;
}

export function buildStage(scene) {
    const root = new THREE.Group();
    scene.add(root);
    const anim = []; // per-frame callbacks (t, dt)
    const K = STAGE.width / 3800;            // big arena: the backdrop scales with it
    const decor = new THREE.Group();
    decor.scale.setScalar(K);
    root.add(decor);

    const W = STAGE.width;
    const D = STAGE_DEPTH;
    const topY = wy(STAGE.y);
    const cx = wx(STAGE.x + W / 2);

    // ------------------------------------------------------------ platform
    const stage = new THREE.Group();
    stage.position.set(cx, 0, 0);
    root.add(stage);

    const bodyMat = new THREE.MeshStandardMaterial({ color: STAGE.color, metalness: 0.55, roughness: 0.42 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W, STAGE.height - 6, D), bodyMat);
    slab.position.y = topY - 6 - (STAGE.height - 6) / 2;
    slab.castShadow = true; slab.receiveShadow = true;
    stage.add(slab);

    // glowing seam lines on the front/back faces
    const seamMat = glowMat('#0ea5e9', 1.6);
    for (const zs of [1, -1]) {
        for (let i = -4; i <= 4; i++) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(3, STAGE.height - 24, 1.2), seamMat);
            m.position.set(i * (W / 9.6), topY - 6 - (STAGE.height - 6) / 2, zs * (D / 2 + 0.4));
            stage.add(m);
        }
        const strip = new THREE.Mesh(new THREE.BoxGeometry(W - 8, 2.6, 1.2), seamMat);
        strip.position.set(0, topY - STAGE.height + 10, zs * (D / 2 + 0.4));
        stage.add(strip);
    }

    // top face with a drawn grid + emblem
    const topTex = canvasTex(2048, Math.round(2048 * D / W), (g, w, h) => {
        g.fillStyle = '#0b1325'; g.fillRect(0, 0, w, h);
        const grad = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.5);
        grad.addColorStop(0, 'rgba(34,211,238,0.22)'); grad.addColorStop(1, 'rgba(34,211,238,0)');
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(56,189,248,0.38)'; g.lineWidth = 2;
        const step = w / 38;
        for (let x = 0; x <= w; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
        for (let y = 0; y <= h; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
        g.strokeStyle = 'rgba(125,211,252,0.9)'; g.lineWidth = 5;
        g.strokeRect(14, 14, w - 28, h - 28);
        // luminary emblem
        g.translate(w / 2, h / 2);
        g.strokeStyle = 'rgba(103,232,249,0.95)'; g.lineWidth = 6;
        g.beginPath(); g.arc(0, 0, h * 0.30, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 3; g.beginPath(); g.arc(0, 0, h * 0.22, 0, Math.PI * 2); g.stroke();
        g.beginPath();
        for (let i = 0; i < 3; i++) {
            const a = -Math.PI / 2 + i * Math.PI * 2 / 3;
            g.lineTo(Math.cos(a) * h * 0.22, Math.sin(a) * h * 0.22);
        }
        g.closePath(); g.stroke();
        g.fillStyle = 'rgba(165,243,252,0.9)'; g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill();
        // centre dashes
        g.lineWidth = 4;
        for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
            g.beginPath(); g.moveTo(s * (h * 0.36 + i * 54), -3); g.lineTo(s * (h * 0.36 + i * 54 + 28), -3); g.stroke();
        }
    });
    const topMat = new THREE.MeshStandardMaterial({
        map: topTex, emissiveMap: topTex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.55,
        roughness: 0.35, metalness: 0.6,
    });
    const top = new THREE.Mesh(new THREE.PlaneGeometry(W, D), topMat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = topY + 0.05;
    top.receiveShadow = true;
    stage.add(top);

    // bright rim around the top (the original's cyan edge strip)
    const rimMat = glowMat(STAGE.topColor, 2.6);
    const rimF = new THREE.Mesh(new THREE.BoxGeometry(W, 8, 8), rimMat);
    rimF.position.set(0, topY - 3, D / 2 - 4);
    const rimB = rimF.clone(); rimB.position.z = -D / 2 + 4;
    const rimL = new THREE.Mesh(new THREE.BoxGeometry(8, 8, D), rimMat);
    rimL.position.set(-W / 2 + 4, topY - 3, 0);
    const rimR = rimL.clone(); rimR.position.x = W / 2 - 4;
    stage.add(rimF, rimB, rimL, rimR);

    // ledge emitters (the two grabbable edges)
    const ledgeMat = glowMat('#06b6d4', 3.2);
    const ledgeGeo = new THREE.BoxGeometry(10, 16, D * 0.82);
    const ledgeL = new THREE.Mesh(ledgeGeo, ledgeMat); ledgeL.position.set(-W / 2 - 1, topY - 5, 0);
    const ledgeR = new THREE.Mesh(ledgeGeo, ledgeMat); ledgeR.position.set(W / 2 + 1, topY - 5, 0);
    stage.add(ledgeL, ledgeR);
    anim.push((t) => { ledgeMat.emissiveIntensity = 2.6 + Math.sin(t * 3) * 0.7; });

    // inverted crystal keel under the slab (purely decorative)
    const keelMat = new THREE.MeshStandardMaterial({ color: 0x172033, metalness: 0.6, roughness: 0.5, flatShading: true });
    const keelGeo = new THREE.CylinderGeometry(0.5, 0.07, 1, 4, 1);
    keelGeo.rotateY(Math.PI / 4);
    const keel = new THREE.Mesh(keelGeo, keelMat);
    keel.scale.set(W * 0.96, 320, D * 0.9);
    keel.position.y = topY - STAGE.height - 160;
    keel.castShadow = true;
    stage.add(keel);
    const keelEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(keelGeo),
        new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55 })
    );
    keelEdges.scale.copy(keel.scale); keelEdges.position.copy(keel.position);
    stage.add(keelEdges);

    const crystalMat = glowMat('#22d3ee', 2.4);
    for (let i = 0; i < 9; i++) {
        const h = 90 + Math.random() * 150;
        const c = new THREE.Mesh(new THREE.ConeGeometry(14 + Math.random() * 14, h, 5), crystalMat);
        c.rotation.x = Math.PI;
        c.position.set((i - 4) * 70 + (Math.random() - 0.5) * 24, topY - STAGE.height - 250 - h / 2 + 30, (Math.random() - 0.5) * 110);
        c.rotation.z = (Math.random() - 0.5) * 0.3;
        stage.add(c);
    }
    // underside glow
    const under = new THREE.PointLight(0x22d3ee, 9e5, 1400, 2);
    under.position.set(0, topY - 190, 260);
    stage.add(under);

    // ------------------------------------------------------------ backdrop
    // luminary halo
    const halo = new THREE.Group();
    halo.position.set(0, 140, -1500);
    decor.add(halo);
    const haloMat1 = glowMat('#22d3ee', 1.7);
    const haloMat2 = glowMat('#8b5cf6', 1.5);
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(1150, 7, 8, 160), haloMat1);
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(960, 4, 8, 160), haloMat2);
    const r3 = new THREE.Group();
    for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        const tick = new THREE.Mesh(new THREE.BoxGeometry(10, i % 3 === 0 ? 70 : 34, 6), haloMat1);
        tick.position.set(Math.cos(a) * 1050, Math.sin(a) * 1050, 0);
        tick.rotation.z = a - Math.PI / 2;
        r3.add(tick);
    }
    halo.add(r1, r2, r3);
    anim.push((t) => { r2.rotation.z = t * 0.05; r3.rotation.z = -t * 0.03; r1.rotation.z = t * 0.01; });

    // nebula glows
    const nebTex = canvasTex(512, 512, (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.28)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const nebula = (color, x, y, z, s, o) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({
            map: nebTex, color, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        }));
        m.position.set(x, y, z); decor.add(m);
    };
    nebula(0x2563eb, 0, 120, -2300, 5200, 0.55);
    nebula(0x7c3aed, -2200, 600, -2600, 3600, 0.5);
    nebula(0x0891b2, 2300, -300, -2400, 3600, 0.45);
    nebula(0xdb2777, 1500, 1000, -3000, 3000, 0.28);

    // starfield
    const starCount = 650;
    const sp = new Float32Array(starCount * 3);
    const sc = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
        sp[i * 3] = (Math.random() - 0.5) * 11000;
        sp[i * 3 + 1] = (Math.random() - 0.5) * 6200;
        sp[i * 3 + 2] = -1800 - Math.random() * 2600;
        const k = 0.5 + Math.random() * 0.5;
        const tint = Math.random();
        sc[i * 3] = k * (tint > 0.8 ? 1 : 0.7);
        sc[i * 3 + 1] = k * 0.85;
        sc[i * 3 + 2] = k;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 14, sizeAttenuation: true, vertexColors: true, fog: false, transparent: true, opacity: 0.95 }));
    decor.add(stars);
    anim.push((t) => { stars.position.x = Math.sin(t * 0.02) * 40; });

    // floating rocks
    const rocks = [];
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x1f2a44, metalness: 0.4, roughness: 0.6, flatShading: true });
    const rockGlow = glowMat('#38bdf8', 1.8);
    for (let i = 0; i < 7; i++) {
        const g = new THREE.Group();
        const s = 40 + Math.random() * 120;
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
        rock.scale.set(1.2, 0.7 + Math.random() * 0.5, 1);
        rock.castShadow = false;
        g.add(rock);
        if (Math.random() > 0.4) {
            const c = new THREE.Mesh(new THREE.OctahedronGeometry(s * 0.28, 0), rockGlow);
            c.position.y = s * 0.7; c.scale.y = 1.8; g.add(c);
        }
        const side = i % 2 ? 1 : -1;
        g.position.set(side * (900 + Math.random() * 2400), -700 + Math.random() * 1800, -350 - Math.random() * 1500);
        g.userData = { base: g.position.y, ph: Math.random() * 6.28, sp: 0.15 + Math.random() * 0.25, rs: (Math.random() - 0.5) * 0.3 };
        decor.add(g); rocks.push(g);
    }
    anim.push((t) => {
        for (const g of rocks) {
            g.position.y = g.userData.base + Math.sin(t * g.userData.sp + g.userData.ph) * 28;
            g.rotation.y = t * g.userData.rs;
        }
    });

    // ------------------------------------------------------------ soft platforms (Big Battlefield)
    for (const p of STAGE.platforms || []) {
        const py = wy(p.y), g = new THREE.Group();
        const slab2 = new THREE.Mesh(new THREE.BoxGeometry(p.w, 26, D * 0.55), bodyMat);
        slab2.position.y = -13; slab2.castShadow = true; slab2.receiveShadow = true;
        const edge2 = new THREE.Mesh(new THREE.BoxGeometry(p.w, 5, D * 0.55 + 2), glowMat(STAGE.topColor, 2.4));
        edge2.position.y = 1;
        g.add(slab2, edge2);
        g.position.set(wx(p.x + p.w / 2), py, 0);
        root.add(g);
    }

    // ------------------------------------------------------------ blast-zone frame (dashed)
    const bz = BLAST_ZONES;
    const dashGeo = new THREE.BoxGeometry(1, 1, 1);
    const dashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xef4444).multiplyScalar(1.4), transparent: true, opacity: 0.42, toneMapped: false });
    const L = wx(bz.left), R = wx(bz.right), T = wy(bz.top), B = wy(bz.bottom);
    const DASH = 44 * K, GAP = 44 * K, TH = 5 * K;
    const list = [];
    const edge = (x0, y0, x1, y1) => {
        const len = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.floor(len / (DASH + GAP));
        for (let i = 0; i < n; i++) {
            const t0 = (i * (DASH + GAP) + DASH / 2) / len;
            list.push({ x: x0 + (x1 - x0) * t0, y: y0 + (y1 - y0) * t0, horiz: Math.abs(y1 - y0) < 1e-3 });
        }
    };
    edge(L, T, R, T); edge(L, B, R, B); edge(L, B, L, T); edge(R, B, R, T);
    const frame = new THREE.InstancedMesh(dashGeo, dashMat, list.length);
    const m4 = new THREE.Matrix4();
    list.forEach((d, i) => {
        m4.makeScale(d.horiz ? DASH : TH, d.horiz ? TH : DASH, TH);
        m4.setPosition(d.x, d.y, 0);
        frame.setMatrixAt(i, m4);
    });
    root.add(frame);

    return {
        root, stage, topY, W, D, decor, stars, rocks,
        update(t, dt) { for (const f of anim) f(t, dt); },
        /** world-space (render) y of the ledge for the lights / effects */
        ledgeY: topY,
    };
}
