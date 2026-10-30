// 3D look of the match items (Ball, Strawberry, Balloon, Firestick, Clock), the balloons that carrying
// fighters tow above their heads, and the clock's time bubble. Read-only: everything comes from core.js.
import * as THREE from 'three';
import { S, items, fighters } from '../core.js';
import { wx, wy, clamp01, lerp } from './space.js';

const CLOCK_RADIUS = 760;
const STICK_UNIT = 36;                 // rendered firestick length per unit of `len`
const ADD = THREE.AdditiveBlending;

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1, ...o });
const glow = (color, k = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });

function makeBall() {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(24, 24, 18), std('#f97316', { roughness: 0.6 }));
    g.add(ball);
    const seamMat = std('#1f1308', { roughness: 0.8 });
    for (const rot of [[0, 0, 0], [Math.PI / 2, 0, 0], [0, Math.PI / 2, 0]]) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(24.2, 0.9, 6, 36), seamMat);
        t.rotation.set(...rot); g.add(t);
    }
    return g;
}
function makeStrawberry() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(18, 20, 16), std('#ef4444', { roughness: 0.35, emissive: '#7f1d1d', emissiveIntensity: 0.35 }));
    body.scale.set(1, 1.18, 1); body.position.y = -2; g.add(body);
    const seedMat = std('#fde68a', { roughness: 0.5 });
    for (let i = 0; i < 12; i++) {
        const a = i * 2.4, y = -12 + (i % 4) * 8;
        const s = new THREE.Mesh(new THREE.SphereGeometry(1.5, 6, 5), seedMat);
        const r = 17 * Math.sqrt(Math.max(0.15, 1 - Math.pow((y + 2) / 22, 2)));
        s.position.set(Math.cos(a) * r, y, Math.sin(a) * r); g.add(s);
    }
    const leafMat = std('#22c55e', { roughness: 0.6 });
    for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(4, 13, 5), leafMat);
        const a = i * Math.PI * 2 / 5;
        leaf.position.set(Math.cos(a) * 7, 19, Math.sin(a) * 7);
        leaf.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1); g.add(leaf);
    }
    return g;
}
function makeBalloonMesh(color = '#f472b6') {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(22, 24, 18), std(color, { roughness: 0.18, metalness: 0.0, emissive: color, emissiveIntensity: 0.18 }));
    b.scale.set(1, 1.22, 1); b.position.y = 26; g.add(b);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(4, 7, 8), std(color, { roughness: 0.3 }));
    knot.rotation.x = Math.PI; knot.position.y = -3; g.add(knot);
    const hi = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 6), glow('#ffffff', 1.4)); hi.position.set(-8, 36, 14); hi.scale.set(1, 1.6, 0.6); g.add(hi);
    return g;
}
function makeStick() {
    const g = new THREE.Group();
    const wood = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 1, 10), std('#7c4a21', { roughness: 0.8 }));
    wood.name = 'wood'; g.add(wood);
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 8, 10), std('#1f2937'));
    wrap.name = 'wrap'; g.add(wrap);
    const flame = new THREE.Group(); flame.name = 'flame';
    const outer = new THREE.Mesh(new THREE.ConeGeometry(9, 26, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color('#f97316').multiplyScalar(2), transparent: true, opacity: 0.85, blending: ADD, depthWrite: false, toneMapped: false }));
    outer.position.y = 12; flame.add(outer);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(4.6, 17, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fde047').multiplyScalar(2.4), transparent: true, opacity: 0.95, blending: ADD, depthWrite: false, toneMapped: false }));
    inner.position.y = 8; flame.add(inner);
    g.add(flame);
    return g;
}
function makeClock() {
    const g = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(24, 3.6, 10, 36), std('#fbbf24', { metalness: 0.7, roughness: 0.3 }));
    g.add(rim);
    const face = new THREE.Mesh(new THREE.CircleGeometry(23, 32), std('#f8fafc', { roughness: 0.5 }));
    face.position.z = 1; g.add(face);
    const tickMat = std('#0f172a');
    for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        const t = new THREE.Mesh(new THREE.BoxGeometry(1.6, i % 3 === 0 ? 5.4 : 3, 1), tickMat);
        t.position.set(Math.sin(a) * 18.5, Math.cos(a) * 18.5, 2); t.rotation.z = -a; g.add(t);
    }
    const hand = (len, w, name) => {
        const h = new THREE.Group(); h.name = name;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, 1.2), std('#dc2626')); m.position.y = len / 2 - 2; h.add(m);
        h.position.z = 3; g.add(h); return h;
    };
    hand(15, 2.2, 'min'); hand(10, 3, 'hour');
    for (const s of [-1, 1]) {
        const bell = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std('#fbbf24', { metalness: 0.7, roughness: 0.3 }));
        bell.position.set(s * 17, 22, 0); bell.rotation.z = -s * 0.7; g.add(bell);
    }
    return g;
}
const BUILD = { BALL: makeBall, STRAWBERRY: makeStrawberry, BALLOON: () => makeBalloonMesh('#f472b6'), FIRESTICK: makeStick, CLOCK: makeClock };

export class ItemsView {
    constructor(scene) {
        this.scene = scene;
        this.map = new Map();               // item id -> { g, type }
        this.balloons = [];                 // one per fighter slot
        for (let i = 0; i < 8; i++) {
            const g = makeBalloonMesh(['#f472b6', '#60a5fa', '#facc15', '#4ade80', '#c084fc', '#fb923c', '#2dd4bf', '#f87171'][i]);
            const stringGeo = new THREE.BufferGeometry();
            stringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
            const str = new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0xe2e8f0 }));
            str.frustumCulled = false;
            g.visible = false; str.visible = false;
            scene.add(g, str);
            this.balloons.push({ g, str });
        }
        // time bubble (flat on the play plane)
        this.bubble = new THREE.Group();
        const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color('#38bdf8').multiplyScalar(1.2), transparent: true, opacity: 0.07, blending: ADD, depthWrite: false, toneMapped: false }));
        const edge = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color('#7dd3fc').multiplyScalar(2), transparent: true, opacity: 0.8, blending: ADD, depthWrite: false, toneMapped: false }));
        this.ticks = new THREE.Group();
        const tickMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#bae6fd').multiplyScalar(2), transparent: true, opacity: 0.7, blending: ADD, depthWrite: false, toneMapped: false });
        for (let i = 0; i < 12; i++) {
            const a = i * Math.PI / 6, t = new THREE.Mesh(new THREE.PlaneGeometry(0.012, i % 3 === 0 ? 0.08 : 0.04), tickMat);
            t.position.set(Math.sin(a) * 0.94, Math.cos(a) * 0.94, 0); t.rotation.z = -a; this.ticks.add(t);
        }
        const handMat = tickMat;
        this.hand = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.42), handMat); this.hand.position.y = 0.21;
        this.handG = new THREE.Group(); this.handG.add(this.hand);
        this.bubble.add(fill, edge, this.ticks, this.handG);
        this.bubble.visible = false; this.bubble.renderOrder = 2;
        scene.add(this.bubble);
    }

    update(dt, t, models) {
        const live = new Set();
        let bubbleAt = null;
        for (const it of items) {
            if (it.st === 'dead') continue;
            live.add(it.id);
            let e = this.map.get(it.id);
            if (!e) {
                const g = BUILD[it.type] ? BUILD[it.type]() : makeBall();
                this.scene.add(g); e = { g, type: it.type }; this.map.set(it.id, e);
            }
            const g = e.g;
            g.visible = !(it.type === 'FIRESTICK' && it.st === 'held');       // a held stick is drawn in the holder's hand by the fighter model
            if (!g.visible) continue;
            const px = wx(it.x), py = wy(it.y);
            if (it.type === 'FIRESTICK') {
                const L = STICK_UNIT * (it.len || 5);
                const wood = g.getObjectByName('wood'), flame = g.getObjectByName('flame'), wrap = g.getObjectByName('wrap');
                wood.scale.y = L; wood.position.y = 0; wrap.position.y = -L / 2 + 8; flame.position.y = L / 2 - 2;
                flame.scale.setScalar(0.8 + 0.16 * (it.len || 5) * 0.4);
                flame.children[0].scale.y = 1 + Math.sin(t * 22 + it.id) * 0.12;
                if (it.st === 'held') {
                    const h = fighters[it.hold];
                    const f = h ? (h.facing || 1) : 1;
                    const a = -f * 0.85;                                      // tilted up and forward
                    g.rotation.z = a;
                    g.position.set(px - Math.sin(a) * L / 2, py + Math.cos(a) * L / 2 - 4, 6);   // the grip sits in the hand
                } else {
                    g.rotation.z = -(it.rot || 0) + (it.st === 'idle' ? Math.PI / 2 : 0);
                    g.position.set(px, py, 4);
                }
            } else if (it.type === 'CLOCK') {
                g.position.set(px, py, 6);
                g.rotation.z = it.st === 'thrown' ? -(it.rot || 0) * 0.5 : Math.sin(t * 2 + it.id) * 0.06;
                const min = g.getObjectByName('min'), hr = g.getObjectByName('hour');
                min.rotation.z = -t * (it.act ? 3 : 0.6); hr.rotation.z = -t * (it.act ? 0.25 : 0.05);
                const s = it.act ? 1.25 + Math.sin(t * 6) * 0.05 : 1;
                g.scale.setScalar(s);
                if (it.act) bubbleAt = it;
            } else {
                g.position.set(px, py + (it.st === 'idle' ? Math.sin(t * 3 + it.id) * 3 : 0), 4);
                g.rotation.z = it.type === 'BALL' ? -(it.rot || 0) : Math.sin(t * 2.4 + it.id) * 0.1;
                if (it.type === 'BALL') g.rotation.x = -(it.rot || 0) * 0.6;
            }
        }
        for (const [id, e] of this.map) {
            if (!live.has(id)) { this.scene.remove(e.g); e.g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this.map.delete(id); }
        }

        // time bubble
        if (bubbleAt) {
            this.bubble.visible = true;
            this.bubble.position.set(wx(bubbleAt.x), wy(bubbleAt.y), -20);
            this.bubble.scale.setScalar(CLOCK_RADIUS);
            this.ticks.rotation.z = -t * 0.05;
            this.handG.rotation.z = -t * 0.35;
        } else this.bubble.visible = false;

        // balloons towed by fighters who picked one up
        fighters.forEach((f, i) => {
            const b = this.balloons[i]; if (!b) return;
            if (!f.active || f.out || !f.balloon || (S.gameState === 'gameover' && f.stocks <= 0)) { b.g.visible = false; b.str.visible = false; return; }
            const m = models && models[i];
            const tug = m ? clamp01(1 - m.tugT / 0.5) : 0;
            const bob = Math.sin(t * 2.6 + i) * 4;
            const sway = Math.sin(t * 1.7 + i) * 8 - f.vx * 1.4;
            const baseX = wx(f.x), baseY = wy(f.y);
            const h = lerp(86, 58, tug) + bob;
            b.g.visible = true; b.str.visible = true;
            b.g.position.set(baseX + sway, baseY + h, -6);
            b.g.rotation.z = -sway * 0.01;
            b.g.scale.set(1 - tug * 0.12, 1 + tug * 0.2, 1);
            const a = b.str.geometry.attributes.position;
            a.setXYZ(0, baseX, baseY + 26, 0); a.setXYZ(1, baseX + sway, baseY + h - 2, -6);
            a.needsUpdate = true;
        });
    }
}
