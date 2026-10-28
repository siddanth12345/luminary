// A procedural 3D fighter: a jointed rig built from primitives, driven every frame by the
// *read-only* simulation state of its Fighter (position, velocity, attackKind, timers...).
// Nothing in here feeds back into gameplay.
//
// Local model space: +Y up, +Z = the way the fighter faces, +X = the fighter's right arm.
// The rig is mirrored for left/right facing by yawing the whole model, so every pose below
// is authored once, facing forward.
import * as THREE from 'three';
import { S } from '../core.js';
import { wx, wy, clamp01, lerp, smooth, seg, D2R } from './space.js';
import { Trail } from './trail.js';

const BLADE_LEN = 40;
const ATTACK_FRAMES = 18;

// ----------------------------------------------------------------- poses
const POSE_DEFAULT = {
    dy: 0, fwd: 0,
    lean: 0, twist: 0, roll: 0,           // body (tilt group)
    spin: 0, pitch: 0,                    // screen-plane rotation (flip group), degrees
    torsoX: 0, torsoY: 0, torsoZ: 0,
    headX: 0, headY: 0, headZ: 0,
    rSx: 8, rSz: 10, rSy: 0, rE: 18,      // right arm: swing fwd / splay out / twist / elbow bend
    lSx: 8, lSz: 10, lSy: 0, lE: 18,
    rHx: 0, rHz: 3, rK: 0,                // right leg: swing fwd / splay / knee bend
    lHx: 0, lHz: 3, lK: 0,
    blade: 0, aura: 0,
};
const POSE_KEYS = Object.keys(POSE_DEFAULT);
const newPose = () => ({ ...POSE_DEFAULT });

export class FighterModel {
    /**
     * @param {THREE.Scene} scene
     * @param {object} fighter   the simulation Fighter (read only)
     * @param {object} opts      { variant: 'hero' | 'rival', fx: Effects }
     */
    constructor(scene, fighter, { variant = 'hero', fx } = {}) {
        this.builtColor = fighter.color;
        this.f = fighter;
        this.fx = fx;
        this.variant = variant;
        this.scene = scene;
        this.cur = newPose();
        this.tintables = [];
        this.mats = [];
        this.t = Math.random() * 10;
        this.runPhase = 0;
        this.yaw = 0;
        this.tumble = 0;
        this.lastJumps = fighter.jumpsLeft;
        this.wasAir = false;
        this.flipT = 99;
        this.lastAtkU = 0;
        this.lastSerial = fighter.attackSerial;
        this.lastThrow = 0;
        this.firedAtk = {};
        this.prevPos = new THREE.Vector3(wx(fighter.x), wy(fighter.y), 0);
        this.greyAmt = 0;
        this.visFacing = 1;
        this.v3 = new THREE.Vector3();
        this.v3b = new THREE.Vector3();

        this.#build();
        this.#buildExtras();

        const base = this.baseColor;
        const mk = (color, boost = 1.6) => new Trail(scene, { color, boost });
        this.trails = {
            blade: mk(base, 2.2), fistR: mk('#e0f2fe', 1.5), fistL: mk('#e0f2fe', 1.5),
            footR: mk(base, 1.8), footL: mk(base, 1.8), body: mk(base, 1.5),
        };
        this.trails.body.max = 28;
    }

    // ============================================================ build
    #mat(color, { metal = 0.3, rough = 0.5, emissive = null, ei = 0, tint = null } = {}) {
        const m = new THREE.MeshStandardMaterial({
            color, metalness: metal, roughness: rough, transparent: true,
            emissive: emissive ?? 0x000000, emissiveIntensity: ei,
        });
        this.mats.push(m);
        if (tint) this.tintables.push({ m, base: m.color.clone(), emis: m.emissive.clone(), grey: new THREE.Color(tint) });
        return m;
    }

    #build() {
        const f = this.f;
        const base = new THREE.Color(f.color);
        this.baseColor = base.clone();

        const armor = this.#mat(base.clone().multiplyScalar(0.62), { metal: 0.6, rough: 0.3, tint: '#7a7f89' });
        const armorDark = this.#mat(base.clone().multiplyScalar(0.26), { metal: 0.6, rough: 0.38, tint: '#4a4f58' });
        const suit = this.#mat(0x0f172a, { metal: 0.25, rough: 0.65 });
        const trim = this.#mat(0xcbd5e1, { metal: 0.85, rough: 0.22 });
        const glow = this.#mat(base.clone().multiplyScalar(0.25), { emissive: base, ei: 2.6, tint: '#5a5f68' });
        this.glowMat = glow;

        const M = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m; };
        const G = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
        const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 5, 10);

        this.root = new THREE.Group();
        this.flip = G(this.root);
        this.yawG = G(this.flip);
        this.tilt = G(this.yawG);
        this.scene.add(this.root);

        // pelvis (origin = hip joints, y = -8 from the hitbox centre)
        const pelvis = this.pelvis = G(this.tilt, 0, -8, 0);
        const hipBox = M(new THREE.BoxGeometry(15, 6.4, 10), suit); hipBox.position.y = 1; pelvis.add(hipBox);
        const belt = M(new THREE.BoxGeometry(16.6, 2.4, 11.2), trim); belt.position.set(0, 3.8, 0); pelvis.add(belt);
        const buckle = M(new THREE.OctahedronGeometry(2.3, 0), glow); buckle.scale.z = 0.55; buckle.position.set(0, 3.8, 5.9); pelvis.add(buckle);

        // torso
        const torso = this.torso = G(pelvis, 0, 3, 0);
        const abdomen = M(new THREE.CylinderGeometry(5.4, 6.2, 7, 12), suit); abdomen.position.y = 3.5; torso.add(abdomen);
        const chest = M(cap(6.0, 5), armor); chest.scale.set(1.5, 1, 0.98); chest.position.y = 10; torso.add(chest);
        const chestPlate = M(new THREE.BoxGeometry(9.5, 7, 2.2), armorDark); chestPlate.position.set(0, 10.5, 6.4); torso.add(chestPlate);
        const gem = M(new THREE.OctahedronGeometry(2.9, 0), glow); gem.scale.set(1, 1.35, 0.6); gem.position.set(0, 10.5, 7.8); torso.add(gem);
        this.gem = gem;
        const pack = M(new THREE.BoxGeometry(10, 11, 4.4), armorDark); pack.position.set(0, 10.5, -6.6); torso.add(pack);
        for (const s of [-1, 1]) {
            const vent = M(new THREE.BoxGeometry(1.6, 6, 1.2), glow); vent.position.set(s * 3.2, 10.5, -9); torso.add(vent);
        }
        // luminary halo mounted on the back
        this.halo = G(torso, 0, 13, -10.5);
        const ring = M(new THREE.TorusGeometry(13.5, 0.85, 8, 40), glow); this.halo.add(ring);
        const ring2 = M(new THREE.TorusGeometry(10, 0.45, 6, 32), trim); this.halo.add(ring2);
        for (let i = 0; i < 4; i++) {
            const tick = M(new THREE.BoxGeometry(1.4, 3.6, 1.4), glow);
            const a = i * Math.PI / 2;
            tick.position.set(Math.cos(a) * 13.5, Math.sin(a) * 13.5, 0); tick.rotation.z = a + Math.PI / 2;
            this.halo.add(tick);
        }
        this.haloRing2 = ring2;

        // neck + head
        const neck = M(new THREE.CylinderGeometry(2.6, 3.2, 3.2, 10), suit); neck.position.y = 16.8; torso.add(neck);
        const head = this.head = G(torso, 0, 18, 0);
        const helm = M(new THREE.SphereGeometry(9.6, 24, 18), armor); helm.scale.set(1, 0.97, 1.04); helm.position.y = 9.6; head.add(helm);
        const visor = M(cap(1.9, 10.5), glow); visor.rotation.z = Math.PI / 2; visor.position.set(0, 10.2, 8.4); head.add(visor);
        const chin = M(new THREE.BoxGeometry(8.4, 3.2, 5.4), armorDark); chin.position.set(0, 3.6, 6.2); head.add(chin);
        for (const s of [-1, 1]) {
            const ear = M(new THREE.CylinderGeometry(2.8, 2.8, 2.6, 14), trim); ear.rotation.z = Math.PI / 2; ear.position.set(s * 9.4, 9.6, 0); head.add(ear);
            const earG = M(new THREE.CylinderGeometry(1.4, 1.4, 2.9, 10), glow); earG.rotation.z = Math.PI / 2; earG.position.set(s * 9.5, 9.6, 0); head.add(earG);
        }
        if (this.variant === 'hero') {
            const crest = M(new THREE.BoxGeometry(1.8, 8, 13), armorDark); crest.position.set(0, 18.4, -1.4); crest.rotation.x = -0.22; head.add(crest);
            const stripe = M(new THREE.BoxGeometry(2.1, 1.2, 12), glow); stripe.position.set(0, 21.6, -2.2); stripe.rotation.x = -0.22; head.add(stripe);
        } else {
            for (const s of [-1, 1]) {
                const horn = M(new THREE.ConeGeometry(2.6, 13, 7), armorDark); horn.position.set(s * 6.2, 18.4, -1.2);
                horn.rotation.set(-0.35, 0, -s * 0.5); head.add(horn);
                const tip = M(new THREE.ConeGeometry(1.15, 5, 6), glow); tip.position.set(s * 9.6, 23.2, -2.4);
                tip.rotation.set(-0.35, 0, -s * 0.5); head.add(tip);
            }
        }

        // arms
        const makeArm = (s) => {
            const sh = G(torso, s * 11, 13.4, 0);
            const pauld = M(new THREE.SphereGeometry(4.9, 14, 12), armor); pauld.scale.set(1, 0.86, 1); pauld.position.x = s * 1.4; sh.add(pauld);
            const ring = M(new THREE.TorusGeometry(4.6, 0.55, 6, 18), glow); ring.rotation.y = Math.PI / 2; ring.position.x = s * 1.4; sh.add(ring);
            const up = M(cap(2.5, 6.6), suit); up.position.y = -6.4; sh.add(up);
            const el = G(sh, 0, -11.8, 0);
            el.add(M(new THREE.SphereGeometry(2.55, 10, 8), trim));
            const fore = M(cap(2.45, 6.0), armor); fore.position.y = -6; el.add(fore);
            const wr = G(el, 0, -11.6, 0);
            const fist = M(new THREE.SphereGeometry(3.5, 12, 10), trim); fist.position.y = -2.4; wr.add(fist);
            const knuckle = M(new THREE.BoxGeometry(5.4, 1.8, 3.6), glow); knuckle.position.set(0, -2.4, 2.3); wr.add(knuckle);
            return { sh, el, wr };
        };
        this.armR = makeArm(1);
        this.armL = makeArm(-1);

        // legs
        const makeLeg = (s) => {
            const hip = G(pelvis, s * 4.7, 0, 0);
            const th = M(cap(3.2, 6), suit); th.position.y = -5.9; hip.add(th);
            const skirt = M(new THREE.BoxGeometry(5.6, 6, 6.6), armor); skirt.position.set(s * 0.8, -3.2, 0); hip.add(skirt);
            const kn = G(hip, 0, -11.7, 0);
            const pad = M(new THREE.SphereGeometry(3.4, 12, 10), armorDark); pad.position.z = 2.2; kn.add(pad);
            const shin = M(cap(2.8, 6), armor); shin.position.y = -6; kn.add(shin);
            const ank = G(kn, 0, -11.6, 0);
            const foot = M(new THREE.BoxGeometry(6.4, 3.6, 11), suit); foot.position.set(0, -1.3, 2.8); ank.add(foot);
            const toe = M(new THREE.BoxGeometry(6.6, 3.4, 4.2), trim); toe.position.set(0, -1.4, 6.9); ank.add(toe);
            const sole = M(new THREE.BoxGeometry(6.5, 0.8, 10.6), glow); sole.position.set(0, -3.1, 2.8); ank.add(sole);
            return { hip, kn, ank };
        };
        this.legR = makeLeg(1);
        this.legL = makeLeg(-1);

        // blade of light, held in the right hand
        const wr = this.armR.wr;
        this.bladeG = G(wr, 0, 0, 0);
        const hilt = M(new THREE.CylinderGeometry(1.15, 1.35, 7.6, 10), trim); hilt.position.y = -3.4; this.bladeG.add(hilt);
        const guard = M(new THREE.BoxGeometry(6.2, 1.1, 2), trim); guard.position.y = -7.2; this.bladeG.add(guard);
        this.blade = G(this.bladeG, 0, -7.8, 0);
        const cCol = new THREE.Color(0xffffff).multiplyScalar(2.4);
        const core = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1, 0.7), new THREE.MeshBasicMaterial({ color: cCol, toneMapped: false }));
        core.position.y = -0.5; this.blade.add(core);
        const outer = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 2.4), new THREE.MeshBasicMaterial({
            color: base.clone().multiplyScalar(2.2), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }));
        outer.position.y = -0.5; this.blade.add(outer);
        this.bladeTipM = G(this.blade, 0, -1, 0);
        this.bladeBaseM = G(this.blade, 0, 0, 0);
        this.bladeG.visible = false;
        this.fistMarkR = G(this.armR.wr, 0, -3, 0);
        this.fistMarkL = G(this.armL.wr, 0, -3, 0);
    }

    #buildExtras() {
        const base = this.baseColor;
        const f = this.f;

        // shield bubble (fresnel + hex-ish rings)
        this.shield = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
            uniforms: { uColor: { value: new THREE.Color('#22d3ee') }, uT: { value: 0 }, uPow: { value: 1 } },
            vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
                void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
            fragmentShader: `uniform vec3 uColor; uniform float uT; uniform float uPow; varying vec3 vN; varying vec3 vV; varying vec3 vP;
                void main(){
                    float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
                    float lat = abs(sin(vP.y * 9.0 + uT * 1.5)) ; float lon = abs(sin(atan(vP.z, vP.x) * 6.0 + uT));
                    float grid = smoothstep(0.93, 1.0, max(lat, lon));
                    float a = (0.16 + fr * 0.85 + grid * 0.22) * uPow;
                    gl_FragColor = vec4(uColor * (1.0 + fr * 1.4), a);
                }`,
        }));
        this.shield.visible = false; this.shield.renderOrder = 8; this.root.add(this.shield);

        // dash aura
        this.aura = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({
            color: base.clone().multiplyScalar(1.8), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }));
        this.aura.scale.set(15, 15, 40); this.aura.position.z = -9; this.aura.visible = false; this.aura.renderOrder = 7;
        this.tilt.add(this.aura);

        // grabbed highlight (the original drew a red rectangle around a grabbed fighter)
        const gb = new THREE.Mesh(new THREE.BoxGeometry(68, 92, 34), new THREE.MeshBasicMaterial({
            color: 0xef4444, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        }));
        gb.add(new THREE.LineSegments(new THREE.EdgesGeometry(gb.geometry), new THREE.LineBasicMaterial({ color: 0xff6b6b, toneMapped: false })));
        gb.visible = false; this.grabBox = gb; this.root.add(gb);

        // status labels + dizzy stars
        const label = (text, color) => {
            const c = document.createElement('canvas'); c.width = 256; c.height = 64;
            const g = c.getContext('2d');
            g.font = '700 30px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.shadowColor = color; g.shadowBlur = 12; g.fillStyle = color; g.fillText(text, 128, 34);
            const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, toneMapped: false }));
            s.scale.set(64, 16, 1); s.position.y = 52; s.visible = false; s.renderOrder = 20;
            this.root.add(s); return s;
        };
        this.lblHang = label('HANGING', '#38bdf8');
        this.lblStun = label('STUNNED', '#f43f5e');
        this.stars = new THREE.Group(); this.stars.position.y = 44; this.root.add(this.stars);
        const starMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#facc15').multiplyScalar(1.7), toneMapped: false });
        for (let i = 0; i < 3; i++) {
            const st = new THREE.Mesh(new THREE.OctahedronGeometry(2.6, 0), starMat);
            st.userData.i = i; this.stars.add(st);
        }
        this.stars.visible = false;

        // soft light that follows the fighter so the stage picks up its colour
        this.light = new THREE.PointLight(base.clone(), 2.5e4, 420, 2);
        this.light.position.set(0, 10, 70);
        this.root.add(this.light);

        // ground contact shadow disc (cheap & always visible, independent of the shadow map)
        const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({
            color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false,
        }));
        blob.rotation.x = -Math.PI / 2; blob.visible = false; blob.renderOrder = 2;
        this.blob = blob; this.scene.add(blob);
    }

    // ============================================================ pose logic
    /** Compute the locomotion/state pose for this frame (to be smoothed). */
    #statePose(dt, alpha) {
        const f = this.f;
        const p = newPose();
        const t = this.t;
        const speedX = Math.abs(f.vx);
        const playing = S.gameState === 'playing';
        this.visFacing = f.facing;
        this.pose_special = null;

        // ---- non-playing screens: hover idle (matches the original, where fighters just sit there)
        if (!playing && S.gameState !== 'gameover') {
            const b = Math.sin(t * 2.4);
            p.dy = b * 1.2; p.rSx = 22 + b * 4; p.lSx = 22 - b * 4; p.rSz = 18; p.lSz = 18; p.rE = 35; p.lE = 35;
            p.rHx = 10; p.lHx = -6; p.rK = 22; p.lK = 14; p.lean = 3; p.headX = -3;
            return p;
        }
        if (S.gameState === 'gameover') {
            if (f.stocks > 0) { // victory pose
                const b = Math.sin(t * 7);
                p.dy = Math.abs(b) * 2.5; p.rSx = 172 + b * 6; p.lSx = 150 - b * 8; p.rSz = 18; p.lSz = 28; p.rE = 12; p.lE = 40;
                p.lean = -4; p.headX = -10; p.torsoY = Math.sin(t * 3) * 10; p.rHx = 6; p.lHx = -6; p.rK = 12; p.lK = 8;
            }
            return p;
        }

        // ---- special states, in the same priority the simulation uses
        if (f.clashStunTimer > 0) {
            const sh = Math.sin(t * 60) * 2;
            p.dy = -2 + sh * 0.4; p.lean = 18; p.headX = 22; p.rSx = 120; p.lSx = 120; p.rE = 130; p.lE = 130; p.rSz = 20; p.lSz = 20;
            p.rK = 40; p.lK = 40; p.rHx = 20; p.lHx = 20; p.twist = sh * 3; p.torsoX = 14;
            return p;
        }
        if (f.dizzyTimer > 0) {
            const w = t * 6;
            p.dy = -1.5; p.lean = Math.sin(w) * 14; p.roll = Math.cos(w * 0.9) * 10; p.headZ = Math.sin(w * 1.3) * 22; p.headX = 14;
            p.rSx = 12 + Math.sin(w) * 18; p.lSx = 12 - Math.sin(w) * 18; p.rSz = 28; p.lSz = 28; p.rE = 28; p.lE = 28;
            p.rK = 26; p.lK = 26; p.rHx = Math.sin(w) * 10; p.lHx = -Math.sin(w) * 10;
            return p;
        }
        if (f.isHanging) {
            this.visFacing = -f.hangSide;
            const sw = Math.sin(t * 2.2);
            p.dy = -2; p.rSx = 150; p.lSx = 150; p.rSz = 12; p.lSz = 12; p.rE = 62; p.lE = 62; p.lean = 8; p.headX = -18;
            p.rHx = 14 + sw * 4; p.lHx = 6 - sw * 4; p.rK = 38; p.lK = 22; p.torsoX = 6;
            return p;
        }
        if (f.isRolling) {
            const u = 1 - f.rollTimer / (f.rollTotal || 20);
            p.spin = 360 * smooth(u) * 1.0; p.dy = -4; p.rSx = 95; p.lSx = 95; p.rE = 125; p.lE = 125; p.rSz = 6; p.lSz = 6;
            p.rHx = 100; p.lHx = 100; p.rK = 125; p.lK = 125; p.headX = 38; p.torsoX = 40; p.aura = 0.5;
            return p;
        }
        if (f.grabbedBy) {
            const sw = Math.sin(t * 9);
            p.dy = -2; p.roll = sw * 8; p.headX = 20; p.headZ = sw * 12;
            p.rSx = 20; p.lSx = 20; p.rSz = 38 + sw * 10; p.lSz = 38 - sw * 10; p.rE = 20; p.lE = 20;
            p.rHx = 12 + sw * 8; p.lHx = 10 - sw * 8; p.rK = 22; p.lK = 28;
            return p;
        }
        if (f.grabHolding) {
            const wind = 1 - clamp01(f.grabTimer / 90);
            const pull = smooth(seg(wind, 0.7, 1));
            p.rSx = lerp(88, 40, pull); p.lSx = lerp(88, 40, pull); p.rE = lerp(80, 120, pull); p.lE = lerp(80, 120, pull);
            p.rSz = lerp(18, 8, pull); p.lSz = lerp(18, 8, pull); p.lean = 6 + pull * 6; p.dy = -2.5 - pull * 1.5;
            p.rK = 28; p.lK = 28; p.rHx = 18; p.lHx = -10; p.twist = pull * 18; p.torsoY = pull * 18;
            return p;
        }
        if (f.throwFxT > 0) {
            const u = 1 - f.throwFxT / 14;
            const w = smooth(seg(u, 0, 0.55));
            p.rSx = lerp(-35, 125, w); p.lSx = lerp(-35, 125, w); p.rE = lerp(55, 4, w); p.lE = lerp(55, 4, w);
            p.torsoY = lerp(35, -30, w); p.twist = lerp(20, -16, w); p.lean = lerp(-6, 16, w); p.fwd = 4 * w;
            p.rHx = 28 * w; p.lHx = -16 * w; p.rK = 16; p.lK = 22;
            return p;
        }
        // ---- F specials
        if (f.freezeTimer > 0) {                       // getting up after a headbutt
            const u = 1 - f.freezeTimer / 18;
            const c = 1 - smooth(u);
            p.dy = -6 * c; p.rK = 100 * c; p.lK = 100 * c; p.rHx = 74 * c; p.lHx = 74 * c;
            p.rSx = 30 + 70 * c; p.lSx = 30 + 70 * c; p.rE = 20 + 30 * c; p.lE = 20 + 30 * c; p.rSz = 20; p.lSz = 20;
            p.lean = 22 * c; p.headX = 14 * c; p.torsoX = 10 * c;
            return p;
        }
        if (f.specialKind === 'SPIRAL') {
            p.spin = f.specialT * 52; p.dy = -2; p.rSx = 172; p.lSx = 172; p.rSz = 8; p.lSz = 8; p.rE = 4; p.lE = 4;
            p.rHx = 8; p.lHx = -6; p.rK = 22; p.lK = 30; p.headX = -10; p.aura = 1; p.blade = 1;
            return p;
        }
        if (f.specialKind === 'SUPLEX') {                // carrying the opponent up, then slamming them down
            if (f.suplexPhase === 'rise') {
                const u = clamp01(f.suplexN / 20);
                p.dy = -3; p.rSx = 172; p.lSx = 172; p.rSz = 10; p.lSz = 10; p.rE = 6; p.lE = 6;
                p.lean = -10 - 22 * smooth(u); p.headX = -14; p.rHx = 20; p.lHx = 6; p.rK = 60; p.lK = 50; p.fwd = -3; p.aura = 0.8;
            } else {
                const u = clamp01(f.suplexN / 12);
                p.rSx = lerp(172, 70, smooth(u)); p.lSx = p.rSx; p.rE = 20; p.lE = 20; p.rSz = 10; p.lSz = 10;
                p.lean = lerp(-30, 38, smooth(u)); p.headX = 14 * smooth(u); p.rHx = 30; p.lHx = 10; p.rK = 30; p.lK = 24; p.aura = 1; p.pitch = 0;
            }
            return p;
        }
        if (f.diving || f.specialKind === 'HEADBUTT') {
            this.visFacing = f.facing;
            p.pitch = this.#velPitch(); p.rSx = -30; p.lSx = -30; p.rSz = 8; p.lSz = 8; p.rE = 8; p.lE = 8;
            p.rHx = -6; p.lHx = -10; p.rK = 12; p.lK = 18; p.headX = 24; p.lean = 6; p.aura = 1;
            return p;
        }
        if (f.specialKind === 'CORE') {                // thrust the orb away
            const u = f.specialT / 24;
            const th = smooth(seg(u, 0, 0.22)) * (1 - smooth(seg(u, 0.5, 1)));
            p.rSx = 70 + 28 * th; p.lSx = 70 + 28 * th; p.rE = 60 - 56 * th; p.lE = 60 - 56 * th; p.rSz = 14; p.lSz = 14;
            p.lean = -6 + 14 * th; p.fwd = 5 * th; p.rK = 24; p.lK = 18; p.rHx = 14 * th; p.lHx = -10 * th; p.aura = 0.8 * (1 - u);
            return p;
        }
        if (f.charging) {                              // cupping a growing orb
            const c = clamp01(f.chargeFrames / 63);
            const sh = Math.sin(t * 40) * 2 * c;
            p.dy = -3 - 2 * c; p.rSx = 84; p.lSx = 84; p.rE = 70; p.lE = 70; p.rSz = 14 - 8 * c; p.lSz = 14 - 8 * c;
            p.lean = -5; p.rK = 34; p.lK = 34; p.rHx = 20; p.lHx = -14; p.headX = 6; p.twist = sh; p.aura = 0.35 + 0.65 * c;
            return p;
        }

        if (f.isGrabDashing) {
            this.visFacing = Math.abs(f.vx) > 1 ? Math.sign(f.vx) : f.facing;
            p.pitch = this.#velPitch(); p.rSx = 168; p.lSx = 168; p.rSz = 10; p.lSz = 10; p.rE = 5; p.lE = 5; p.rSy = 0;
            p.rHx = -22; p.lHx = -14; p.rK = 10; p.lK = 16; p.headX = -22; p.lean = 6; p.aura = 1;
            return p;
        }
        if (f.isDashing) {
            this.visFacing = Math.abs(f.vx) > 1 ? Math.sign(f.vx) : f.facing;
            p.pitch = this.#velPitch(); p.rSx = 168; p.lSx = 40; p.rSz = 4; p.lSz = 8; p.rE = 4; p.lE = 40;
            p.rHx = -26; p.lHx = -10; p.rK = 14; p.lK = 24; p.headX = -22; p.lean = 8; p.roll = Math.sin(t * 40) * 3; p.aura = 1;
            return p;
        }
        if (f.hitstun > 0) {
            const sp = Math.hypot(f.vx, f.vy);
            const k = Math.sin(t * 28);
            p.dy = 0; p.rSx = 70 + k * 40; p.lSx = 40 - k * 40; p.rSz = 55; p.lSz = 55; p.rE = 40 + k * 20; p.lE = 40 - k * 20;
            p.rHx = 30 - k * 24; p.lHx = -10 + k * 24; p.rHz = 16; p.lHz = 16; p.rK = 30; p.lK = 30 + k * 10; p.headX = -20; p.lean = -12;
            p.tumbleRate = Math.min(26, 5 + sp * 0.8);
            return p;
        }
        if (f.isShielding) {
            p.dy = -4.2; p.lean = 9; p.rSx = 96; p.lSx = 96; p.rE = 112; p.lE = 112; p.rSz = -6; p.lSz = -6; p.rSy = 30; p.lSy = -30;
            p.rHx = 34; p.lHx = -12; p.rK = 56; p.lK = 44; p.rHz = 8; p.lHz = 10; p.headX = 10;
            return p;
        }

        // ---- ordinary movement
        if (!f.grounded) {
            const rise = clamp01((f.vy + 12) / 24); // 0 = rising fast (vy<0), 1 = falling fast
            p.rSx = lerp(125, 38, rise); p.lSx = lerp(118, 28, rise);
            p.rSz = lerp(28, 62, rise); p.lSz = lerp(34, 62, rise);
            p.rE = lerp(20, 14, rise); p.lE = lerp(26, 14, rise);
            p.rHx = lerp(52, 14, rise); p.lHx = lerp(-12, -8, rise);
            p.rK = lerp(78, 22, rise); p.lK = lerp(34, 18, rise);
            p.lean = lerp(-4, 6, rise); p.headX = lerp(-6, 4, rise);
            if (this.flipT < 0.5) {
                const u = this.flipT / 0.5;
                p.spin = 360 * smooth(u);
                p.rK = 95; p.lK = 95; p.rHx = 85; p.lHx = 85; p.rSx = 95; p.lSx = 95; p.rE = 120; p.lE = 120;
            }
            if (speedX > 1.5) p.lean += 6;
            return p;
        }
        if (speedX > 1.4) {
            const rate = 13 + 6 * Math.min(1, speedX / 8.5);
            this.runPhase += dt * rate;
            const ph = this.runPhase;
            const sR = Math.sin(ph), sL = Math.sin(ph + Math.PI);
            p.lean = 14; p.dy = -Math.abs(Math.cos(ph)) * 1.8 - 1;
            p.rHx = sR * 52; p.lHx = sL * 52; p.rK = 12 + Math.max(0, Math.cos(ph)) * 70; p.lK = 12 + Math.max(0, Math.cos(ph + Math.PI)) * 70;
            p.rSx = -sR * 48 + 6; p.lSx = -sL * 48 + 6; p.rE = 78 + sR * 12; p.lE = 78 + sL * 12; p.rSz = 8; p.lSz = 8;
            p.torsoY = sR * 9; p.headX = -6;
            return p;
        }
        // idle
        const b = Math.sin(t * 2.3);
        p.dy = b * 0.5 - 0.5; p.lean = 2 + b * 1.2; p.rSx = 14 + b * 3; p.lSx = 14 - b * 3; p.rE = 36; p.lE = 36; p.rSz = 14; p.lSz = 14;
        p.rHx = 5; p.lHx = -3; p.rK = 10 + b * 2; p.lK = 8; p.headX = -2;
        return p;
    }

    #velPitch() {
        const f = this.f;
        const vx = Math.abs(f.vx), vy = -f.vy;
        return Math.atan2(vy, Math.max(vx, 0.001)) / D2R;
    }

    // ---------------------------------------------------------------- attack overlays
    /** Returns { w, kind, u, pose } for an in-progress attack, or null. */
    #attackOverlay(alpha) {
        const f = this.f;
        if (f.attackTimer <= 0 || !f.attackKind) return null;
        if (f.isRolling || f.hitstun > 0 || f.dizzyTimer > 0 || f.clashStunTimer > 0 || f.isHanging || f.grabbedBy) return null;
        const u = clamp01((ATTACK_FRAMES - 1 - f.attackTimer + alpha) / ATTACK_FRAMES);
        const w = smooth(u / 0.1) * (1 - smooth(seg(u, 0.72, 1)));
        const k = f.attackKind;
        const o = {};
        const hand = (f.attackSerial % 2 === 0) ? 'R' : 'L';

        if (k === 'JAB') {
            const ext = smooth(seg(u, 0.08, 0.3)) * (1 - smooth(seg(u, 0.42, 0.78)));
            const P = hand, O = hand === 'R' ? 'L' : 'R';
            o[P + 'Sx'] = lerp(38, 94, ext); o[P + 'E'] = lerp(118, 4, ext); o[P + 'Sz'] = 6;
            o[O + 'Sx'] = 58; o[O + 'E'] = 112; o[O + 'Sz'] = 8;
            o.torsoY = (hand === 'R' ? -1 : 1) * 30 * ext; o.twist = (hand === 'R' ? -1 : 1) * 10 * ext;
            o.fwd = 7 * ext; o.lean = 9 * ext;
            o[P + 'Hx'] = 30 * ext; o[(hand === 'R' ? 'l' : 'r') + 'Hx'] = -18 * ext;
            o.rK = 18; o.lK = 18;
            return { w, kind: k, u, o, hand, ext };
        }
        if (k === 'UP') {
            const crouch = smooth(seg(u, 0, 0.16)) * (1 - smooth(seg(u, 0.16, 0.3)));
            const sw = smooth(seg(u, 0.14, 0.46));
            const rec = smooth(seg(u, 0.62, 1));
            const rise = sw * (1 - rec);
            o.rSx = lerp(lerp(8, -38, smooth(seg(u, 0, 0.14))), 178, sw); o.rSx = lerp(o.rSx, 20, rec);
            o.rE = lerp(34, 4, sw); o.rSz = 12;
            o.lSx = lerp(18, 150, sw); o.lE = 30; o.lSz = 30;
            o.dy = -6 * crouch + 9 * rise; o.lean = lerp(14 * crouch, -12, sw) * (1 - rec);
            o.rK = 70 * crouch + 8; o.lK = 62 * crouch + 8; o.rHx = 34 * crouch - 12 * rise; o.lHx = 18 * crouch - 6 * rise;
            o.torsoY = -24 * crouch + 18 * sw * (1 - rec); o.headX = -20 * sw;
            o.blade = smooth(seg(u, 0.06, 0.2)) * (1 - smooth(seg(u, 0.78, 0.98)));
            return { w, kind: k, u, o, sw };
        }
        if (k === 'DOWN') {
            const tuck = smooth(seg(u, 0, 0.2)) * (1 - smooth(seg(u, 0.22, 0.36)));
            const st = smooth(seg(u, 0.2, 0.36)) * (1 - smooth(seg(u, 0.72, 1)));
            o.rHx = 88 * tuck + 22 * st; o.lHx = 80 * tuck + 8 * st; o.rK = 112 * tuck + 3 * st; o.lK = 104 * tuck + 3 * st;
            o.rSx = 168 * tuck + 70 * st; o.lSx = 160 * tuck + 62 * st; o.rSz = 32; o.lSz = 36; o.rE = 20; o.lE = 24;
            o.lean = 8 * st - 4 * tuck; o.dy = -2 * tuck - 3 * st; o.headX = 16 * st; o.fwd = 3 * st;
            return { w, kind: k, u, o, st };
        }
        if (k === 'SIDE_LEFT' || k === 'SIDE_RIGHT') {
            const wind = smooth(seg(u, 0, 0.28));
            const swing = smooth(seg(u, 0.28, 0.5));
            const rec = smooth(seg(u, 0.6, 1));
            let a = lerp(14, 205, wind); a = lerp(a, 8, swing); a = lerp(a, 16, rec);
            o.rSx = a; o.rE = lerp(26, 10, swing); o.rSz = lerp(10, 16, wind) * (1 - swing * 0.5); o.rSy = lerp(0, 0, wind);
            o.lSx = lerp(lerp(14, 28, wind), -36, swing); o.lSz = lerp(14, 50, swing); o.lE = 30;
            o.torsoY = lerp(lerp(0, 34, wind), -28, swing) * (1 - rec); o.twist = lerp(lerp(0, 18, wind), -14, swing) * (1 - rec);
            o.lean = lerp(lerp(0, -12, wind), 22, swing) * (1 - rec); o.fwd = 10 * swing * (1 - rec);
            o.rHx = 40 * swing * (1 - rec) - 8 * wind * (1 - swing); o.lHx = -22 * swing * (1 - rec); o.rK = 26 * swing + 10; o.lK = 18 + 22 * wind * (1 - swing);
            o.dy = -2.5 * swing; o.headX = -6 * wind + 10 * swing;
            o.blade = smooth(seg(u, 0.02, 0.14)) * (1 - smooth(seg(u, 0.78, 0.98)));
            return { w, kind: k, u, o, swing, wind };
        }
        if (k === 'LUNGE') {
            const el = Math.atan2(Math.sin(f.attackFxAngle), Math.max(Math.abs(Math.cos(f.attackFxAngle)), 0.001)) / D2R;
            o.pitch = el; o.rSx = 92; o.rE = 2; o.rSz = 2; o.lSx = -38; o.lSz = 22; o.lE = 18;
            o.rHx = -20; o.lHx = -26; o.rK = 6; o.lK = 12; o.headX = -14; o.lean = 4;
            o.roll = 720 * smooth(seg(u, 0.04, 0.82)); o.blade = smooth(seg(u, 0, 0.1)) * (1 - smooth(seg(u, 0.84, 1))); o.aura = 1;
            return { w: smooth(u / 0.07) * (1 - smooth(seg(u, 0.84, 1))), kind: k, u, o, el };
        }
        return null;
    }

    // ============================================================ per-frame update
    update(dt, alpha, nowSec) {
        const f = this.f;
        this.t += dt;
        this.flipT += dt;

        // ---- placement (interpolated between the last two simulation steps)
        let x = f.x, y = f.y;
        if (!f._teleported) { x = lerp(f.px, f.x, alpha); y = lerp(f.py, f.y, alpha); }
        const pos = this.v3.set(wx(x), wy(y), 0);
        const jumped = pos.distanceTo(this.prevPos) > 260;
        if (jumped) this.onTeleport(pos);
        this.prevPos.copy(pos);
        this.root.position.copy(pos);

        // loser of a finished match is gone (blown out of the arena)
        const hidden = (S.gameState === 'gameover' && f.stocks <= 0) || f.active === false || f.out === true;
        this.root.visible = !hidden;
        if (hidden) { this.#hideExtras(); return; }

        // ---- pose
        const airNow = !f.grounded && !f.isHanging;
        if (airNow && this.wasAir && f.jumpsLeft < this.lastJumps) this.flipT = 0; // mid-air jump -> somersault
        this.wasAir = airNow;
        this.lastJumps = f.jumpsLeft;
        const base = this.#statePose(dt, alpha);
        if (base.tumbleRate) this.tumble += dt * base.tumbleRate * (f.vx >= 0 ? -1 : 1);
        else this.tumble *= Math.exp(-dt * 10);
        const smoothK = 1 - Math.exp(-dt * 26);
        for (const k of POSE_KEYS) this.cur[k] += (base[k] - this.cur[k]) * smoothK;
        // smoothing must not blur cyclic spin/pitch/roll: take those straight from the state pose
        this.cur.spin = base.spin; this.cur.pitch = base.pitch;

        const pose = { ...this.cur };
        const atk = this.#attackOverlay(alpha);
        if (atk) {
            for (const k in atk.o) pose[k] = lerp(pose[k], atk.o[k], atk.w);
            if (atk.kind === 'LUNGE') { this.visFacing = f.facing; }
            else if (atk.kind === 'SIDE_LEFT') this.visFacing = -1;
            else if (atk.kind === 'SIDE_RIGHT') this.visFacing = 1;
            this.#attackFx(atk, dt);
        } else {
            this.lastAtkU = 0; this.firedAtk = {};
        }

        // ---- facing (yaw) with a 3/4 bias toward the camera
        const targetYaw = this.visFacing * (90 - 24) * D2R;
        this.yaw += (targetYaw - this.yaw) * (1 - Math.exp(-dt * 22));
        this.yawG.rotation.y = this.yaw;

        const sf = this.visFacing;
        this.flip.rotation.z = sf * pose.pitch * D2R - sf * pose.spin * D2R + (this.tumble || 0);
        this.tilt.rotation.set(pose.lean * D2R, pose.twist * D2R, pose.roll * D2R);
        this.tilt.position.set(0, pose.dy, pose.fwd);

        this.torso.rotation.set(pose.torsoX * D2R, pose.torsoY * D2R, pose.torsoZ * D2R);
        this.head.rotation.set(pose.headX * D2R, pose.headY * D2R, pose.headZ * D2R);
        this.armR.sh.rotation.set(-pose.rSx * D2R, pose.rSy * D2R, pose.rSz * D2R);
        this.armL.sh.rotation.set(-pose.lSx * D2R, pose.lSy * D2R, -pose.lSz * D2R);
        this.armR.el.rotation.set(-pose.rE * D2R, 0, 0);
        this.armL.el.rotation.set(-pose.lE * D2R, 0, 0);
        this.legR.hip.rotation.set(-pose.rHx * D2R, 0, pose.rHz * D2R);
        this.legL.hip.rotation.set(-pose.lHx * D2R, 0, -pose.lHz * D2R);
        this.legR.kn.rotation.set(pose.rK * D2R, 0, 0);
        this.legL.kn.rotation.set(pose.lK * D2R, 0, 0);

        // blade + aura
        const bl = clamp01(pose.blade);
        this.bladeG.visible = bl > 0.02;
        this.blade.scale.y = Math.max(0.001, BLADE_LEN * bl);
        this.aura.visible = pose.aura > 0.05;
        if (this.aura.visible) this.aura.material.opacity = 0.34 * clamp01(pose.aura);

        // little life in the always-on parts
        this.halo.rotation.z = this.t * 0.8;
        this.haloRing2.rotation.z = -this.t * 1.7;
        this.gem.scale.setScalar(1 + Math.sin(this.t * 4) * 0.08);

        // ---- state decoration
        this.#decorate(dt);
        this.root.updateMatrixWorld(true);
        this.#emitTrails(atk, pose, dt);
        for (const k in this.trails) this.trails[k].update(dt);
        this.#contactBlob(pos);
    }

    #contactBlob(pos) {
        const f = this.f;
        // a soft dark disc on the platform top while the fighter is above it
        const over = (f.x > this.stageL && f.x < this.stageR);
        const h = pos.y - this.stageTop;
        if (over && h > -10 && h < 420 && !this.f.isHanging) {
            this.blob.visible = true;
            this.blob.position.set(pos.x, this.stageTop + 0.4, 0);
            const s = 24 + Math.max(0, h) * 0.05;
            this.blob.scale.set(s, s * 0.5, 1);
            this.blob.material.opacity = clamp01(0.5 - h / 700);
        } else this.blob.visible = false;
    }

    setStageBounds(l, r, top) { this.stageL = l; this.stageR = r; this.stageTop = top; }

    #hideExtras() {
        this.shield.visible = false; this.grabBox.visible = false; this.stars.visible = false;
        this.lblHang.visible = false; this.lblStun.visible = false; this.blob.visible = false;
        for (const k in this.trails) this.trails[k].update(0.016);
    }

    #decorate(dt) {
        const f = this.f;
        const T = this.t;
        // flicker while invincible (original: alpha 0.5 on alternate 4-frame blocks)
        const flick = f.invincibleTimer > 0 && Math.floor(f.invincibleTimer / 4) % 2 === 0;
        const opacity = flick ? 0.5 : 1;
        for (const m of this.mats) m.opacity = opacity;

        // greyed while stunned / grabbed / dizzy
        const grey = (f.hitstun > 0 || f.dizzyTimer > 0 || f.clashStunTimer > 0 || f.grabbedBy !== null) ? 1 : 0;
        this.greyAmt += (grey - this.greyAmt) * (1 - Math.exp(-dt * 30));
        for (const t of this.tintables) {
            t.m.color.copy(t.base).lerp(t.grey, this.greyAmt);
            t.m.emissive.copy(t.emis).multiplyScalar(1 - this.greyAmt * 0.85);
        }

        // shield bubble: radius follows the remaining shield exactly like the original
        if (f.isShielding) {
            const r = (f.shieldHealth / f.maxShieldHealth) * 52 + 10;
            this.shield.visible = true;
            this.shield.scale.setScalar(r);
            this.shield.position.set(0, 0, 0);
            this.shield.material.uniforms.uT.value = T;
            this.shield.material.uniforms.uPow.value = 0.8 + Math.sin(T * 14) * 0.08;
        } else this.shield.visible = false;

        this.grabBox.visible = f.grabbedBy !== null;
        if (this.grabBox.visible) this.grabBox.material.opacity = 0.2 + Math.sin(T * 12) * 0.05;

        this.lblHang.visible = f.isHanging;
        this.lblStun.visible = f.clashStunTimer > 0;
        this.stars.visible = f.dizzyTimer > 0;
        if (this.stars.visible) {
            this.stars.children.forEach((s, i) => {
                const a = T * 5.5 + i * (Math.PI * 2 / 3);
                s.position.set(Math.cos(a) * 15, Math.sin(a * 2) * 2.2, Math.sin(a) * 9);
                s.rotation.y = a * 2; s.rotation.x = a;
            });
        }
        this.light.intensity = 2.5e4 * (flick ? 0.5 : 1);
    }

    // ============================================================ effects tied to the animation
    #attackFx(a, dt) {
        const fx = this.fx; if (!fx) return;
        const f = this.f;
        const u = a.u;
        const fired = this.firedAtk;
        const sf = f.facing;
        const col = this.baseColor;
        const mark = (k, thr) => { if (!fired[k] && u >= thr) { fired[k] = true; return true; } return false; };
        const c = this.root.position; // fighter centre (render)

        if (a.kind === 'JAB' && mark('ring', 0.26)) {
            const fist = (a.hand === 'R' ? this.fistMarkR : this.fistMarkL).getWorldPosition(new THREE.Vector3());
            fx.ring(fist, 4, 30, 0.22, '#e0f2fe', 'screen');
            fx.sparks(fist, '#bae6fd', 7, 160, 0.25);
            fx.star(fist, 34, '#e0f2fe', 0.14);
        }
        if (a.kind === 'UP' && mark('arc', 0.15)) {
            const sh = this.armR.sh.getWorldPosition(new THREE.Vector3());
            fx.crescent(sh, sf, -135, 100, 62, 22, col, 0.34);
            fx.sparks(sh, '#bae6fd', 8, 220, 0.3);
        }
        if (a.kind === 'UP' && mark('apex', 0.46)) {
            const hand = this.armR.wr.getWorldPosition(new THREE.Vector3());
            fx.ring(hand, 6, 44, 0.26, col, 'screen');
            fx.star(hand, 40, '#ffffff', 0.16);
        }
        if ((a.kind === 'SIDE_LEFT' || a.kind === 'SIDE_RIGHT') && mark('arc', 0.26)) {
            const sh = this.armR.sh.getWorldPosition(new THREE.Vector3());
            fx.crescent(sh, a.kind === 'SIDE_RIGHT' ? 1 : -1, 118, -88, 64, 26, col, 0.36);
            fx.sparks(sh, '#bae6fd', 10, 240, 0.3);
        }
        if (a.kind === 'DOWN') {
            if (mark('stomp', 0.3)) {
                const foot = this.legR.ank.getWorldPosition(new THREE.Vector3());
                const grounded = f.grounded;
                if (grounded) { fx.ring(new THREE.Vector3(c.x, this.stageTop + 1, 0), 6, 110, 0.38, col, 'ground'); fx.sparks(new THREE.Vector3(c.x, this.stageTop + 2, 0), '#bae6fd', 12, 260, 0.35, 'up'); }
                else { fx.ring(foot.clone().add(new THREE.Vector3(0, -8, 0)), 6, 54, 0.3, col, 'screen'); fx.sparks(foot, '#bae6fd', 10, 240, 0.3, 'down'); }
                fx.star(foot, 44, '#ffffff', 0.15);
            }
        }
        if (a.kind === 'LUNGE' && mark('go', 0.01)) {
            fx.ring(c.clone(), 5, 52, 0.28, col, 'screen');
            fx.sparks(c.clone(), '#bae6fd', 12, 280, 0.32);
            fx.star(c.clone(), 46, '#ffffff', 0.16);
        }
    }

    onTeleport(pos) {
        for (const k in this.trails) this.trails[k].clear();
        this.tumble = 0;
        this.cur.spin = 0;
        if (this.fx && S.gameState !== 'start') this.fx.respawn(pos.clone(), this.baseColor);
    }

    #emitTrails(atk, pose, dt) {
        const f = this.f;
        const T = this.trails;
        const get = (o) => o.getWorldPosition(new THREE.Vector3());

        // blade (slashes, uppercut, lunge)
        if (this.bladeG.visible && pose.blade > 0.35) {
            T.blade.setColor(this.baseColor, 2.4);
            T.blade.push(get(this.bladeBaseM), get(this.bladeTipM));
        }
        // fists on jabs
        if (atk && atk.kind === 'JAB' && atk.ext > 0.15) {
            const R = atk.hand === 'R';
            const tr = R ? T.fistR : T.fistL;
            tr.push(get(R ? this.fistMarkR : this.fistMarkL), get((R ? this.armR : this.armL).el));
        }
        // feet on the stomp / dive
        if (atk && atk.kind === 'DOWN' && atk.st > 0.2) {
            T.footR.push(get(this.legR.ank), get(this.legR.kn));
            T.footL.push(get(this.legL.ank), get(this.legL.kn));
        }
        // body streak while dashing / lunging / grab-dashing
        const fast = f.isDashing || f.isGrabDashing || (atk && atk.kind === 'LUNGE');
        if (fast) {
            const c = this.root.position;
            const sp = Math.hypot(f.vx, f.vy) || 1;
            const nx = -(-f.vy) / sp, ny = f.vx / sp; // perpendicular to velocity in the screen plane (render y is flipped)
            const w = 11;
            T.body.setColor(f.isGrabDashing ? '#ef4444' : this.baseColor, 1.7);
            T.body.push(new THREE.Vector3(c.x + nx * w, c.y + ny * w, 0), new THREE.Vector3(c.x - nx * w, c.y - ny * w, 0));
        }
    }

    dispose() { this.scene.remove(this.root); }
}
