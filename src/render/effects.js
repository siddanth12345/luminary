// All the visual-only effects: the simulation's particles / shockwaves / KO beams are
// drawn here in 3D, the `fxEvents` it emits become sparks, flashes and rings, and
// animation-driven effects (slash crescents, punch rings, dash ghosts) are spawned by
// the fighter models through the small API at the bottom of this class.
import * as THREE from 'three';
import { S, p1, p2, fighters, particles, shockwaves, koBeams, fxEvents, mouse, orbs, CHARGE_MAX } from '../core.js';
import { wx, wy, clamp01, lerp, smooth, D2R } from './space.js';
import { getHitboxes } from '../gfx.js';

// colours per character style (main, bright)
const PAL = { core: ['#a78bfa', '#ede9fe'], iron: ['#94a3b8', '#e2e8f0'], wind: ['#6ee7b7', '#ecfdf5'], fire: ['#fb923c', '#fde047'], water: ['#38bdf8', '#e0f2fe'], volt: ['#facc15', '#fef9c3'], dark: ['#7c3aed', '#c4b5fd'], rock: ['#a8a29e', '#d6d3d1'] };
const pal = (c) => PAL[String(c || 'core').replace('!', '')] || PAL.core;

const ADD = THREE.AdditiveBlending;

function mergeGeos(list) {
    const pos = [], nor = [];
    for (const { geo, mat } of list) {
        let g = geo.index ? geo.toNonIndexed() : geo.clone();
        if (mat) g.applyMatrix4(mat);
        pos.push(...g.attributes.position.array);
        nor.push(...g.attributes.normal.array);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return out;
}

function starGeometry(points = 8, inner = 0.22) {
    const s = new THREE.Shape();
    for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? 1 : inner;
        const a = (i / (points * 2)) * Math.PI * 2;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    s.closePath();
    return new THREE.ShapeGeometry(s);
}

function crescentGeometry(radius, width, a0, a1, mirror, seg = 44) {
    const pos = [], tt = [], vv = [], idx = [];
    for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        let ang = lerp(a0, a1, t);
        if (mirror) ang = 180 - ang;
        const r = ang * D2R;
        const w = width * Math.pow(Math.sin(Math.PI * Math.min(0.999, Math.max(0.001, t))), 0.65);
        const rin = radius - w * 0.55, rout = radius + w * 0.45;
        pos.push(Math.cos(r) * rin, Math.sin(r) * rin, 0, Math.cos(r) * rout, Math.sin(r) * rout, 0);
        tt.push(t, t); vv.push(0, 1);
        if (i < seg) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
    g.setAttribute('aV', new THREE.Float32BufferAttribute(vv, 1));
    g.setIndex(idx);
    return g;
}

const CRESCENT_VS = `attribute float aT; attribute float aV; varying float vT; varying float vV;
    void main(){ vT = aT; vV = aV; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const CRESCENT_FS = `uniform vec3 uColor; uniform float uReveal; uniform float uFade; varying float vT; varying float vV;
    void main(){
        float head = smoothstep(uReveal, uReveal - 0.04, vT);            // not yet swept
        float tail = smoothstep(uReveal - 0.75, uReveal - 0.05, vT);      // older part fades
        float edge = 1.0 - abs(vV - 0.5) * 1.6;
        float a = head * tail * clamp(edge, 0.0, 1.0) * uFade;
        vec3 c = mix(uColor, vec3(1.0), smoothstep(0.35, 1.0, edge) * 0.8);
        gl_FragColor = vec4(c * 1.8, a);
    }`;

export class Effects {
    constructor(scene) {
        this.scene = scene;
        this.timed = [];
        this.colorCache = new Map();
        this.tmpM = new THREE.Matrix4();
        this.tmpQ = new THREE.Quaternion();
        this.tmpV = new THREE.Vector3();
        this.tmpS = new THREE.Vector3();
        this.tmpC = new THREE.Color();
        this.up = new THREE.Vector3(0, 1, 0);
        this.stageTop = 0;

        this.starGeo = starGeometry(8, 0.2);
        this.starGeo4 = starGeometry(4, 0.16);
        this.ringGeo = new THREE.RingGeometry(0.86, 1, 56);

        // ---- core particles (instanced)
        this.MAXP = 2600;
        this.pMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({
            transparent: true, blending: ADD, depthWrite: false, toneMapped: false,
        }), this.MAXP);
        this.pMesh.frustumCulled = false; this.pMesh.renderOrder = 5;
        this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.pMesh.setColorAt(0, new THREE.Color());
        this.pMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.pMesh.count = 0;
        scene.add(this.pMesh);

        // ---- sparks (stretched streaks)
        this.MAXS = 600;
        this.sparks_ = [];
        this.sMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({
            transparent: true, blending: ADD, depthWrite: false, toneMapped: false,
        }), this.MAXS);
        this.sMesh.frustumCulled = false; this.sMesh.renderOrder = 6;
        this.sMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.sMesh.setColorAt(0, new THREE.Color());
        this.sMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.sMesh.count = 0;
        scene.add(this.sMesh);

        // ---- dash ghosts (instanced silhouettes)
        const ghostGeo = mergeGeos([
            { geo: new THREE.CapsuleGeometry(11, 24, 4, 10), mat: new THREE.Matrix4().makeTranslation(0, -8, 0) },
            { geo: new THREE.SphereGeometry(9.5, 12, 10), mat: new THREE.Matrix4().makeTranslation(0, 22, 0) },
        ]);
        this.MAXG = 160;
        this.gMesh = new THREE.InstancedMesh(ghostGeo, new THREE.MeshBasicMaterial({
            transparent: true, blending: ADD, depthWrite: false, toneMapped: false,
        }), this.MAXG);
        this.gMesh.frustumCulled = false; this.gMesh.renderOrder = 4;
        this.gMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.gMesh.setColorAt(0, new THREE.Color());
        this.gMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.gMesh.count = 0;
        scene.add(this.gMesh);

        // ---- shockwaves (pool of shader quads)
        this.swPool = [];
        for (let i = 0; i < 6; i++) {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
                transparent: true, depthWrite: false, blending: ADD,
                uniforms: { uR: { value: 1 }, uW: { value: 12 }, uA: { value: 1 }, uC: { value: new THREE.Color('#38bdf8') }, uSize: { value: 1 } },
                vertexShader: `varying vec2 vP; uniform float uSize; void main(){ vP = position.xy * uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
                fragmentShader: `varying vec2 vP; uniform float uR; uniform float uW; uniform float uA; uniform vec3 uC;
                    void main(){ float d = length(vP); float x = abs(d - uR);
                        float core = smoothstep(uW, 0.0, x); float halo = smoothstep(uW * 5.0, 0.0, x) * 0.25;
                        float a = (core + halo) * uA; gl_FragColor = vec4(uC * (1.2 + core * 1.8), a); }`,
            }));
            m.visible = false; m.frustumCulled = false; m.renderOrder = 3; scene.add(m); this.swPool.push(m);
        }

        // ---- KO beams
        this.beamPool = [];
        const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
        for (let i = 0; i < 6; i++) {
            const g = new THREE.Group();
            const outer = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#38bdf8').multiplyScalar(1.8), transparent: true, blending: ADD, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
            const inner = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#e0f2fe').multiplyScalar(2.4), transparent: true, blending: ADD, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
            g.add(outer, inner); g.userData = { outer, inner }; g.visible = false; g.renderOrder = 6; scene.add(g); this.beamPool.push(g);
        }

        this.showHB = getHitboxes(); window.addEventListener('cbg-hb', () => { this.showHB = getHitboxes(); });
        // ---- hitbox boxes (the original drew these as translucent red rectangles)
        this.hbPool = [];
        const hbGeo = new THREE.BoxGeometry(1, 1, 1);
        const hbEdges = new THREE.EdgesGeometry(hbGeo);
        for (let i = 0; i < 8; i++) {
            const m = new THREE.Mesh(hbGeo, new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.16, depthWrite: false, blending: ADD, toneMapped: false }));
            m.add(new THREE.LineSegments(hbEdges, new THREE.LineBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.75, toneMapped: false })));
            m.visible = false; m.renderOrder = 5; scene.add(m); this.hbPool.push(m);
        }

        // ---- CBG Core orbs (projectiles) and the charge orbs held by fighters
        const orbCore = new THREE.SphereGeometry(1, 24, 18);
        const mkOrb = () => {
            const g = new THREE.Group();
            const core = new THREE.Mesh(orbCore, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
            const mid = new THREE.Mesh(orbCore, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: ADD, depthWrite: false, toneMapped: false }));
            const halo = new THREE.Mesh(orbCore, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, blending: ADD, depthWrite: false, toneMapped: false }));
            mid.scale.setScalar(1.35); halo.scale.setScalar(2.1);
            g.add(core, mid, halo); g.userData = { core, mid, halo };
            // other projectile designs (each character's own): rock, void orb, bubble
            const rock = new THREE.Group();
            const rm = new THREE.MeshStandardMaterial({ color: 0x78716c, flatShading: true, roughness: 1, metalness: 0, emissive: 0x3b3531, emissiveIntensity: 0.9 });
            rock.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.95, 0), rm));
            const chip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ color: 0x57534e, flatShading: true, roughness: 1, emissive: 0x292524, emissiveIntensity: 0.9 }));
            chip.position.set(0.55, 0.45, 0.35); rock.add(chip);
            const vein = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fb923c').multiplyScalar(1.5), transparent: true, opacity: 0.5, blending: ADD, depthWrite: false, toneMapped: false }));
            vein.position.set(-0.25, -0.2, 0.5); rock.add(vein);
            const voidG = new THREE.Group();
            voidG.add(new THREE.Mesh(orbCore, new THREE.MeshBasicMaterial({ color: 0x07030f, toneMapped: false })));
            const vr = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.09, 8, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color('#a855f7').multiplyScalar(2.2), transparent: true, opacity: 0.9, blending: ADD, depthWrite: false, toneMapped: false }));
            const vr2 = vr.clone(); vr2.rotation.x = 1.1; voidG.add(vr, vr2);
            voidG.add(new THREE.Mesh(orbCore, new THREE.MeshBasicMaterial({ color: new THREE.Color('#7c3aed').multiplyScalar(1.4), transparent: true, opacity: 0.22, blending: ADD, depthWrite: false, toneMapped: false })).translateZ(0).clone());
            voidG.children[3].scale.setScalar(1.7);
            const bub = new THREE.Group();
            bub.add(new THREE.Mesh(orbCore, new THREE.MeshBasicMaterial({ color: new THREE.Color('#7dd3fc').multiplyScalar(1.4), transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })));
            bub.add(new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color('#e0f2fe').multiplyScalar(2), transparent: true, opacity: 0.85, blending: ADD, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })));
            const hl = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.7, 24, 1, 2.2, 1.3), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, toneMapped: false, side: THREE.DoubleSide }));
            hl.position.z = 0.05; bub.add(hl);
            rock.visible = voidG.visible = bub.visible = false;
            g.add(rock, voidG, bub); Object.assign(g.userData, { rock, voidG, bub, vr, vr2 });
            g.visible = false; g.renderOrder = 6; this.scene.add(g);
            return g;
        };
        this.orbPool = []; for (let i = 0; i < 24; i++) this.orbPool.push(mkOrb());
        this.chargePool = Array.from({ length: 8 }, () => mkOrb());
        this.chargeT = 0;

        // ---- aim line (player -> cursor), dashed like the original
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        this.aim = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: new THREE.Color('#22d3ee').multiplyScalar(1.4), dashSize: 22, gapSize: 16, transparent: true, opacity: 0.5, toneMapped: false }));
        this.aim.frustumCulled = false; this.aim.visible = false; this.aim.renderOrder = 4;
        scene.add(this.aim);
    }

    setStageTop(y) { this.stageTop = y; }

    color(hex) {
        let c = this.colorCache.get(hex);
        if (!c) { c = new THREE.Color(hex); this.colorCache.set(hex, c); }
        return c;
    }

    // ============================================================ public spawners
    /** expanding ring. plane: 'screen' (faces the camera) or 'ground' (flat on the stage). */
    ring(pos, r0, r1, life, color, plane = 'screen') {
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.7), transparent: true, blending: ADD, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
        const m = new THREE.Mesh(this.ringGeo, mat);
        m.position.copy(pos);
        if (plane === 'ground') m.rotation.x = -Math.PI / 2; else m.position.z += 6;
        m.renderOrder = 6;
        this.scene.add(m);
        this.timed.push({ obj: m, t: 0, dur: life, step: (u) => {
            const e = 1 - Math.pow(1 - u, 3);
            m.scale.setScalar(lerp(r0, r1, e)); mat.opacity = (1 - u) * 0.95;
        }, free: () => { mat.dispose(); } });
    }

    /** a bright flash star billboard */
    star(pos, size, color, life = 0.16, points = 8) {
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, blending: ADD, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
        const m = new THREE.Mesh(points === 4 ? this.starGeo4 : this.starGeo, mat);
        m.position.copy(pos); m.position.z += 8; m.rotation.z = Math.random() * 3; m.renderOrder = 7;
        this.scene.add(m);
        this.timed.push({ obj: m, t: 0, dur: life, step: (u) => {
            m.scale.setScalar(size * lerp(0.35, 1.05, 1 - Math.pow(1 - u, 2))); mat.opacity = (1 - u * u);
            m.rotation.z += 0.04;
        }, free: () => mat.dispose() });
    }

    /** sweeping crescent slash. a0 -> a1 in degrees for a right-facing fighter (mirrored for left). */
    crescent(center, facing, a0, a1, radius, width, color, life = 0.34) {
        const geo = crescentGeometry(radius, width, a0, a1, facing < 0);
        const mat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: ADD, side: THREE.DoubleSide,
            uniforms: { uColor: { value: new THREE.Color(color) }, uReveal: { value: 0 }, uFade: { value: 1 } },
            vertexShader: CRESCENT_VS, fragmentShader: CRESCENT_FS,
        });
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(center); m.position.z += 7; m.renderOrder = 7;
        this.scene.add(m);
        this.timed.push({ obj: m, t: 0, dur: life, step: (u) => {
            mat.uniforms.uReveal.value = lerp(0.02, 1.25, smooth(u / 0.5));
            mat.uniforms.uFade.value = 1 - smooth((u - 0.45) / 0.55);
            m.scale.setScalar(1 + u * 0.12);
        }, free: () => { geo.dispose(); mat.dispose(); } });
    }

    /** radial spark streaks. dir: undefined = all around, 'up' / 'down' bias */
    sparks(pos, color, count, speed, life = 0.3, dir) {
        const col = new THREE.Color(color).multiplyScalar(2);
        for (let i = 0; i < count; i++) {
            if (this.sparks_.length >= this.MAXS) this.sparks_.shift();
            let a = Math.random() * Math.PI * 2;
            if (dir === 'up') a = Math.PI / 2 + (Math.random() - 0.5) * 2.4;
            if (dir === 'down') a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
            const s = speed * (0.45 + Math.random() * 0.75);
            this.sparks_.push({
                p: pos.clone(), v: new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, (Math.random() - 0.5) * s * 0.35),
                t: 0, life: life * (0.6 + Math.random() * 0.7), c: col,
            });
        }
    }

    /** directional spark spray (used for hits) */
    spray(pos, angle, color, count, speed, spread = 0.9, life = 0.32) {
        const col = new THREE.Color(color).multiplyScalar(2);
        for (let i = 0; i < count; i++) {
            if (this.sparks_.length >= this.MAXS) this.sparks_.shift();
            const a = angle + (Math.random() - 0.5) * spread;
            const s = speed * (0.4 + Math.random() * 0.9);
            this.sparks_.push({
                p: pos.clone(), v: new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, (Math.random() - 0.5) * s * 0.3),
                t: 0, life: life * (0.6 + Math.random() * 0.7), c: col,
            });
        }
    }

    /** light pillar (respawn / KO) */
    pillar(pos, color, height = 640, life = 0.7, radius = 15) {
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, blending: ADD, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
        const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, height, 20, 1, true), mat);
        m.position.set(pos.x, pos.y + height / 2 - 40, pos.z); m.renderOrder = 5;
        this.scene.add(m);
        this.timed.push({ obj: m, t: 0, dur: life, step: (u) => {
            const w = radius * (1 - u) * (1 + 0.5 * Math.sin(u * 20));
            m.scale.set(Math.max(0.01, w), 1, Math.max(0.01, w)); mat.opacity = (1 - u) * 0.8;
        }, free: () => { m.geometry.dispose(); mat.dispose(); } });
    }

    respawn(pos, color) {
        this.pillar(pos, color, 700, 0.8, 20);
        this.ring(pos, 4, 70, 0.5, color, 'screen');
        this.sparks(pos, color, 22, 260, 0.6, 'down');
    }

    // ============================================================ per-frame
    clearEvents() { fxEvents.length = 0; }

    #consumeEvents() {
        while (fxEvents.length) {
            const e = fxEvents.shift();
            const pos = new THREE.Vector3(wx(e.x), wy(e.y), 0);
            switch (e.type) {
                case 'hit': {
                    const force = e.a || 10, ang = -e.b; // sim y is flipped
                    this.star(pos, 30 + force * 1.8, '#fde68a', 0.2);
                    this.ring(pos, 6, 38 + force * 1.6, 0.3, '#fbbf24', 'screen');
                    this.spray(pos, ang, '#fcd34d', Math.min(26, 8 + Math.floor(force * 0.7)), 320 + force * 14, 0.8);
                    this.sparks(pos, '#ffffff', 6, 200, 0.2);
                    break;
                }
                case 'block':
                    this.ring(pos, 10, 62, 0.28, '#22d3ee', 'screen');
                    this.star(pos, 34, '#a5f3fc', 0.14, 4);
                    this.sparks(pos, '#67e8f9', 8, 200, 0.25);
                    break;
                case 'grab':
                    this.ring(pos, 6, 54, 0.3, '#ef4444', 'screen');
                    this.star(pos, 40, '#fecaca', 0.16);
                    this.sparks(pos, '#f87171', 12, 240, 0.3);
                    break;
                case 'clash':
                    this.star(pos, 190, '#ffffff', 0.34);
                    this.star(pos, 120, '#7dd3fc', 0.46, 4);
                    this.ring(pos, 10, 260, 0.5, '#38bdf8', 'screen');
                    this.sparks(pos, '#e0f2fe', 36, 520, 0.6);
                    break;
                case 'stomp': {          // a = width of the shockwave, b = facing (0 = both ways)
                    const w = e.a || 250, g = new THREE.Vector3(pos.x, this.stageTop + 1, 0), P = pal(e.c);
                    this.ring(g, 6, w * 0.55, 0.38, P[0], 'ground');
                    this.ring(g.clone().setY(this.stageTop + 2), 4, w * 0.3, 0.3, '#ffffff', 'ground');
                    const dirs = e.b ? [e.b] : [-1, 1];
                    for (const d of dirs) {
                        for (let i = 0; i < 8; i++) {
                            const px = g.x + d * (w * 0.5 * (i + 1) / 8) * (e.b ? 1 : 1);
                            this.sparks(new THREE.Vector3(px, this.stageTop + 4, 0), P[1], 2, 220, 0.35, 'up');
                        }
                    }
                    this.star(g.clone().setY(this.stageTop + 20), 70, '#ffffff', 0.16);
                    break;
                }
                case 'blink': {          // a, b = destination
                    const to = new THREE.Vector3(wx(e.a), wy(e.b), 0);
                    this.star(pos, 70, '#c4b5fd', 0.2, 4);
                    this.ring(pos, 4, 60, 0.3, '#a78bfa', 'screen');
                    this.sparks(pos, '#ddd6fe', 14, 260, 0.3);
                    for (let i = 1; i < 7; i++) this.sparks(pos.clone().lerp(to, i / 7), '#a78bfa', 3, 120, 0.35);
                    this.star(to, 80, '#ffffff', 0.18);
                    this.ring(to, 4, 74, 0.32, '#c4b5fd', 'screen');
                    this.sparks(to, '#ede9fe', 14, 280, 0.32);
                    break;
                }
                case 'spiral':
                    this.ring(pos, 10, 90, 0.26, '#8b5cf6', 'screen');
                    this.sparks(pos, '#c4b5fd', 8, 240, 0.3);
                    break;
                case 'core':             // cast flash. a = charge
                    this.star(pos, 50 + 60 * e.a, '#e9d5ff', 0.18);
                    this.ring(pos, 6, 70 + 80 * e.a, 0.3, '#a78bfa', 'screen');
                    break;
                case 'explosion': {      // a = radius, b = charge
                    const R = e.a || 100, P = pal(e.c);
                    this.star(pos, R * 1.5, '#ffffff', 0.3);
                    this.star(pos, R * 1.1, P[0], 0.42, 4);
                    this.ring(pos, 10, R * 1.15, 0.45, P[0], 'screen');
                    this.ring(pos, 6, R * 0.7, 0.3, '#ffffff', 'screen');
                    this.sparks(pos, P[1], 18 + Math.floor(26 * e.b), 300 + R * 3, 0.55);
                    break;
                }
                case 'pillar': {         // a = width, b = height, c = style (a trailing ! = the eruption itself; without it only the warning swell)
                    const P = pal(e.c), big = String(e.c || '').includes('!'), w = Math.max(40, e.a || 100), h = Math.max(60, e.b || 200);
                    const g = new THREE.Vector3(pos.x, this.stageTop + 1, 0);
                    const mk = (col, rad, op) => new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 1.25, 1, 20, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(2), transparent: true, opacity: op, blending: ADD, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
                    const outer = mk(P[0], w / 2, 0.8), inner = mk(P[1], w / 4, 0.95);
                    outer.renderOrder = inner.renderOrder = 6;
                    this.scene.add(outer, inner);
                    const H = big ? h : h * 0.5, dur = big ? 0.6 : 0.35;
                    this.timed.push({ obj: outer, t: 0, dur, step: (u) => {
                        const rise = big ? Math.min(1, u / 0.18) : u, fade = big ? 1 - Math.pow(Math.max(0, (u - 0.25) / 0.75), 1.5) : 1 - u;
                        const hh = Math.max(1, H * (0.08 + 0.92 * rise));
                        outer.scale.set(1 - u * 0.4, hh, 1 - u * 0.4); inner.scale.set(1 - u * 0.7, hh * 0.9, 1 - u * 0.7);
                        outer.position.set(g.x, g.y + hh / 2, 0); inner.position.set(g.x, g.y + hh * 0.45, 0);
                        outer.material.opacity = 0.8 * fade; inner.material.opacity = 0.95 * fade;
                    }, free: () => { this.scene.remove(inner); inner.geometry.dispose(); inner.material.dispose(); outer.geometry.dispose(); outer.material.dispose(); } });
                    this.ring(g, 6, w * 0.9, 0.4, P[0], 'ground');
                    if (big) {
                        this.ring(g.clone().setY(this.stageTop + 2), 4, w * 1.5, 0.5, P[1], 'ground');
                        for (let i = 0; i < 4; i++) this.sparks(new THREE.Vector3(g.x + (Math.random() - 0.5) * w, g.y + 6, 0), P[i % 2], 7, 300 + h, 0.7, 'up');
                        this.star(g.clone().setY(this.stageTop + 30), w * 0.9, '#ffffff', 0.2);
                    }
                    break;
                }
                case 'quake': {          // heavy ground slam: cracks racing outward + dust
                    const P = pal(e.c), w = e.a || 300, y = this.stageTop + 2;
                    this.ring(new THREE.Vector3(pos.x, y, 0), 10, w * 1.3, 0.6, P[0], 'ground');
                    for (const d of [-1, 1]) for (let k = 0; k < 3; k++) {
                        const pts = []; let x = pos.x, z = 0; const len = w * (0.6 + Math.random() * 0.7), dz = (Math.random() - 0.5) * 1.4;
                        for (let i = 0; i <= 10; i++) { pts.push(new THREE.Vector3(x, y, z)); x += d * len / 10; z += dz * 6 + (Math.random() - 0.5) * 16; }
                        const geo = new THREE.BufferGeometry().setFromPoints(pts);
                        const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(P[1]).multiplyScalar(1.6), transparent: true, opacity: 1, toneMapped: false });
                        const line = new THREE.Line(geo, mat); line.renderOrder = 5; this.scene.add(line);
                        this.timed.push({ obj: line, t: 0, dur: 0.9, step: (u) => { mat.opacity = 1 - u * u; }, free: () => { geo.dispose(); mat.dispose(); } });
                    }
                    for (let i = 0; i < 14; i++) this.sparks(new THREE.Vector3(pos.x + (Math.random() - 0.5) * w * 1.2, y + 4, (Math.random() - 0.5) * 80), '#a8a29e', 2, 140, 0.8, 'up');
                    break;
                }
                case 'gust': {           // wind ring; b = 1 means it pulls inward
                    const P = pal(e.c), R = e.a || 120;
                    if (e.b) { this.ring(pos, R * 1.1, 10, 0.4, P[0], 'screen'); this.ring(pos, R * 0.7, 6, 0.32, P[1], 'screen'); }
                    else { this.ring(pos, 10, R, 0.4, P[0], 'screen'); this.ring(pos, 6, R * 0.6, 0.3, P[1], 'screen'); this.sparks(pos, P[1], 14, R * 2, 0.45); }
                    break;
                }
                case 'trail': {          // a = travel angle (sim), b = 1 for a dash streak
                    const P = pal(e.c), wa = -(e.a || 0);
                    this.spray(pos, wa + Math.PI, P[Math.random() < 0.5 ? 0 : 1], e.b ? 3 : 4, 160, 0.5, 0.3);
                    this.star(pos, e.b ? 40 : 52, P[1], 0.12, 4);
                    break;
                }
                case 'flame': {          // a = aim angle (sim rad), b = +/- length (positive = final burst)
                    // Legacy fallback: if |a| is large it was the old signed-length encoding
                    let ang, L, last;
                    if (Math.abs(e.a) > 6.5) {           // old format: a = signed length, b = 1 on final
                        L = Math.abs(e.a || 200); ang = (e.a || 1) < 0 ? Math.PI : 0; last = !!e.b;
                    } else {
                        ang = e.a || 0; L = Math.abs(e.b || 200); last = (e.b || 0) > 0;
                    }
                    const dirx = Math.cos(ang), diry = Math.sin(ang);   // sim space (y down)
                    const wa = -ang;                                   // three.js (y up)
                    for (let i = 0; i < 4; i++) {
                        const t = 0.2 + 0.7 * Math.random();
                        const p = pos.clone();
                        p.x += dirx * L * t;
                        p.y -= diry * L * t;                           // flip sim y -> three y
                        p.y += (Math.random() - 0.5) * 40;
                        this.spray(p, wa + 0.2, i % 2 ? '#fb923c' : '#fde047', 3, 140 + L, 0.6, 0.35);
                        this.star(p, 26 + Math.random() * 26, i % 2 ? '#fb923c' : '#fef08a', 0.16, 4);
                    }
                    if (last) {
                        const p = pos.clone();
                        p.x += dirx * L * 0.85;
                        p.y -= diry * L * 0.85;
                        this.star(p, 130, '#fb923c', 0.28);
                        this.ring(p, 10, 110, 0.35, '#fde047', 'screen');
                    }
                    break;
                }
                case 'rocket': {
                    const P = pal(e.c);
                    this.ring(pos, 6, 90, 0.35, P[0], 'screen'); this.star(pos, 110, P[1], 0.22); this.sparks(pos, P[1], 20, 380, 0.5);
                    break;
                }
                case 'counter':
                    this.ring(pos, 8, 80, 0.3, '#f472b6', 'screen');
                    this.star(pos, 70, '#ffffff', 0.15, 4);
                    this.sparks(pos, '#f9a8d4', 12, 260, 0.3);
                    break;
                case 'kick':             // knocked off a ledge. a = side
                    this.ring(pos, 6, 60, 0.3, '#f59e0b', 'screen');
                    this.sparks(pos, '#fbbf24', 14, 260, 0.35);
                    break;
                case 'heal':
                    this.ring(pos, 10, 90, 0.5, '#4ade80', 'screen');
                    this.sparks(pos, '#86efac', 14, 200, 0.7, 'up');
                    break;
                case 'pickup':
                    this.ring(pos, 6, 54, 0.35, '#fde68a', 'screen');
                    this.sparks(pos, '#ffffff', 8, 180, 0.35);
                    break;
                case 'burn':
                    this.star(pos, 60, '#fb923c', 0.2, 4);
                    this.sparks(pos, '#f97316', 12, 260, 0.5, 'up');
                    break;
                case 'bubble':             // a = radius
                    this.ring(pos, 20, e.a || 760, 0.8, '#38bdf8', 'screen');
                    this.star(pos, 140, '#bae6fd', 0.3, 4);
                    break;
                case 'ko':
                    this.star(pos, 260, '#ffffff', 0.45);
                    this.ring(pos, 10, 380, 0.7, '#f87171', 'screen');
                    this.sparks(pos, '#fbbf24', 40, 600, 0.8);
                    this.sparks(pos, '#ffffff', 24, 800, 0.6);
                    break;
            }
        }
    }

    #paintOrb(g, r, color, strength) {
        const u = g.userData;
        const c = this.color(color);
        u.core.material.color.set('#ffffff').lerp(c, 0.25).multiplyScalar(1.8 * strength);
        u.mid.material.color.copy(c).multiplyScalar(2.2 * strength);
        u.halo.material.color.copy(c).multiplyScalar(1.6 * strength);
        g.scale.setScalar(Math.max(1, r));
    }

    update(dt, models) {
        this.#consumeEvents();
        const M = this.tmpM, Q = this.tmpQ, V = this.tmpV, Sc = this.tmpS, C = this.tmpC;

        // ---- timed effects
        for (let i = this.timed.length - 1; i >= 0; i--) {
            const f = this.timed[i];
            f.t += dt;
            const u = clamp01(f.t / f.dur);
            f.step(u);
            if (f.t >= f.dur) { this.scene.remove(f.obj); f.free && f.free(); this.timed.splice(i, 1); }
        }

        // ---- core particles
        let n = 0;
        for (let i = 0; i < particles.length && n < this.MAXP; i++) {
            const p = particles[i];
            const r = Math.max(0.6, p.radius * (0.35 + 0.9 * p.alpha)) * 1.6;
            V.set(wx(p.x), wy(p.y), p.z || 0); Sc.set(r, r, r);
            M.compose(V, Q.identity(), Sc);
            this.pMesh.setMatrixAt(n, M);
            C.copy(this.color(p.color)).multiplyScalar(1.6 * p.alpha);
            this.pMesh.setColorAt(n, C);
            n++;
        }
        this.pMesh.count = n;
        this.pMesh.instanceMatrix.needsUpdate = true;
        if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;

        // ---- sparks
        n = 0;
        for (let i = this.sparks_.length - 1; i >= 0; i--) {
            const s = this.sparks_[i];
            s.t += dt;
            if (s.t >= s.life) { this.sparks_.splice(i, 1); continue; }
            s.v.y -= 260 * dt; s.v.multiplyScalar(1 - dt * 2.2);
            s.p.addScaledVector(s.v, dt);
        }
        for (const s of this.sparks_) {
            if (n >= this.MAXS) break;
            const sp = s.v.length();
            if (sp < 0.001) continue;
            const k = 1 - s.t / s.life;
            const len = Math.min(46, 5 + sp * 0.07) * (0.35 + k * 0.65);
            Q.setFromUnitVectors(this.up, V.copy(s.v).divideScalar(sp));
            Sc.set(1.6 * (0.4 + k * 0.6), len, 1.6 * (0.4 + k * 0.6));
            M.compose(s.p, Q, Sc);
            this.sMesh.setMatrixAt(n, M);
            this.sMesh.setColorAt(n, C.copy(s.c).multiplyScalar(k));
            n++;
        }
        this.sMesh.count = n;
        this.sMesh.instanceMatrix.needsUpdate = true;
        if (this.sMesh.instanceColor) this.sMesh.instanceColor.needsUpdate = true;

        // ---- ghosts
        n = 0;
        for (const f of fighters) {
            for (const g of f.ghosts) {
                if (n >= this.MAXG) break;
                V.set(wx(g.x), wy(g.y), -2); Sc.set(1, 1, 0.55);
                M.compose(V, Q.identity(), Sc);
                this.gMesh.setMatrixAt(n, M);
                this.gMesh.setColorAt(n, C.copy(this.color(g.color || '#67e8f9')).multiplyScalar(1.25 * g.alpha));
                n++;
            }
        }
        this.gMesh.count = n;
        this.gMesh.instanceMatrix.needsUpdate = true;
        if (this.gMesh.instanceColor) this.gMesh.instanceColor.needsUpdate = true;

        // ---- shockwaves
        for (let i = 0; i < this.swPool.length; i++) {
            const m = this.swPool[i], sw = shockwaves[i];
            if (!sw) { m.visible = false; continue; }
            m.visible = true;
            const size = (sw.radius + 80) * 2;
            m.position.set(wx(sw.x), wy(sw.y), -4); m.scale.set(size, size, 1);
            const u = m.material.uniforms;
            u.uSize.value = size; u.uR.value = sw.radius; u.uW.value = 10 + sw.radius * 0.006;
            u.uA.value = Math.max(0, sw.alpha); u.uC.value.set(sw.color);
        }

        // ---- KO beams
        for (let i = 0; i < this.beamPool.length; i++) {
            const g = this.beamPool[i], b = koBeams[i];
            if (!b) { g.visible = false; continue; }
            g.visible = true;
            const a = new THREE.Vector3(wx(b.startX), wy(b.startY), 0), c = new THREE.Vector3(wx(b.targetX), wy(b.targetY), 0);
            const len = a.distanceTo(c) || 1;
            g.position.copy(a).add(c).multiplyScalar(0.5);
            g.quaternion.setFromUnitVectors(this.up, c.clone().sub(a).normalize());
            const w = (b.width / 2) * (0.5 + b.alpha * 0.5);
            g.userData.outer.scale.set(w, len, w); g.userData.inner.scale.set(w * 0.35, len, w * 0.35);
            g.userData.outer.material.opacity = b.alpha * 0.55; g.userData.inner.material.opacity = b.alpha * 0.9;
        }

        // ---- hitboxes
        fighters.forEach((f, i) => {
            const m = this.hbPool[i], hb = f.activeHitbox; if (!m) return;
            if (!hb || !this.showHB) { m.visible = false; return; }
            m.visible = true;
            m.position.set(wx(hb.x), wy(hb.y), 0); m.scale.set(hb.w, hb.h, 44);
        });

        // ---- core orbs in flight
        this.chargeT += dt;
        for (let i = 0; i < this.orbPool.length; i++) {
            const g = this.orbPool[i], o = orbs[i];
            if (!o) { g.visible = false; continue; }
            g.visible = true;
            const pulse = 1 + Math.sin(this.chargeT * 18 + i) * 0.07;
            g.position.set(wx(o.x), wy(o.y), 0);
            const kind = o.kind || 0, u = g.userData, alt = kind === 'boulder' || kind === 'void' || kind === 'bubble';
            u.core.visible = u.mid.visible = u.halo.visible = !alt;
            u.rock.visible = kind === 'boulder'; u.voidG.visible = kind === 'void'; u.bub.visible = kind === 'bubble';
            if (kind === 'water') { this.#paintOrb(g, o.r * pulse, '#38bdf8', 1); if (Math.random() < 0.7) this.sparks(g.position.clone(), '#bae6fd', 1, 60, 0.3, 'down'); }
            else if (kind === 'boulder') {
                g.scale.setScalar(o.r); u.rock.rotation.x += dt * 4; u.rock.rotation.y += dt * 3;
                if (Math.random() < 0.9) this.sparks(g.position.clone(), '#a8a29e', 1, 90, 0.4, 'down');
                if (Math.random() < 0.3) this.sparks(g.position.clone(), '#fb923c', 1, 80, 0.25);
            } else if (kind === 'void') {
                g.scale.setScalar(o.r * pulse); u.vr.rotation.z += dt * 5; u.vr2.rotation.z -= dt * 7;
                if (Math.random() < 0.7) this.sparks(g.position.clone(), '#a855f7', 1, 100, 0.35);
            } else if (kind === 'bubble') {
                g.scale.setScalar(o.r * (1 + Math.sin(this.chargeT * 7 + i) * (o.cap ? 0.05 : 0.025)));
                if (Math.random() < 0.15) this.sparks(g.position.clone(), '#e0f2fe', 1, 50, 0.4, 'up');
            } else { this.#paintOrb(g, o.r * pulse, o.color, 1); if (Math.random() < 0.8) this.sparks(g.position.clone(), o.color, 1, 70, 0.28); }
        }
        // ---- the orb a fighter is charging (grows with the charge)
        fighters.forEach((f, i) => {
            const g = this.chargePool[i]; if (!g) return;
            if (!f.active || f.out || !f.charging || S.gameState !== 'playing') { g.visible = false; return; }
            const c = Math.min(1, f.chargeFrames / CHARGE_MAX);
            const r = (5 + 15 * c) * (1 + Math.sin(this.chargeT * 30) * 0.08);
            g.visible = true;
            g.position.set(wx(f.x + f.facing * (30 + 8 * c)), wy(f.y - 2), 8);
            const col = c >= 1 ? (S.match ? '#a855f7' : f === p1 ? '#a855f7' : '#fb923c') : f.color;
            this.#paintOrb(g, r, col, 0.8 + 0.2 * c);
            if (Math.random() < 0.5 + c * 0.5) {          // energy streaming in
                const a = Math.random() * Math.PI * 2, d = 50 + 60 * c;
                const from = g.position.clone().add(new THREE.Vector3(Math.cos(a) * d, Math.sin(a) * d, 0));
                this.spray(from, a + Math.PI, c >= 1 ? (S.match ? '#a855f7' : f === p1 ? '#a855f7' : '#fb923c') : f.color, 1, d * 5, 0.1, 0.18);
            }
            if (c >= 1 && Math.floor(this.chargeT * 12) % 6 === 0) this.ring(g.position.clone(), r, r + 40, 0.2, '#ffffff', 'screen');
        });

        // ---- aim line
        const ta = mouse.touchMode ? mouse.touchAim : null;
        const show = S.gameState === 'playing' && (!mouse.touchMode || !!ta);   // on phones the guide only shows while the grab / grid is being aimed
        this.aim.visible = show;
        if (show) {
            const a = this.aim.geometry.attributes.position;
            const me = fighters[S.mySlot || 0] || p1;
            a.setXYZ(0, wx(me.x), wy(me.y), 3);
            if (ta) a.setXYZ(1, wx(me.x) + ta[0] * 520, wy(me.y) - ta[1] * 520, 3); else a.setXYZ(1, wx(mouse.worldX), wy(mouse.worldY), 3);
            a.needsUpdate = true;
            this.aim.computeLineDistances();
        }
    }
}
