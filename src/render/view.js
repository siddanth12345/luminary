// Renderer, camera, lights and post-processing. The camera always looks at the centre of
// the map, so the middle of the screen is the middle of the map (and the aim matrix,
// which the original measured from the screen centre, behaves identically).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { S, WORLD, STAGE, p1, p2, fighters, mouse, dramaticZoom, updateAimMatrix } from '../core.js';
import { CX, CY, wx, wy, lerp, smooth, clamp01, syncSpace } from './space.js';
import { buildStage } from './stage.js';
import { FighterModel } from './fighterModel.js';
import { Effects } from './effects.js';
import { ItemsView } from './items.js';

const FOV = 38;
const PITCH = 7 * Math.PI / 180;   // slight look-down so the platform top reads in 3D

export class View {
    constructor(canvas) {
        this.canvas = canvas;
        const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
        this.pr = Math.min(window.devicePixelRatio || 1, 1.5);
        r.setPixelRatio(this.pr);
        this.q = 0; this.ft = 0; this.inMatch = undefined;
        r.outputColorSpace = THREE.SRGBColorSpace;
        r.toneMapping = THREE.ACESFilmicToneMapping;
        r.toneMappingExposure = 1.05;
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.PCFShadowMap;

        const scene = this.scene = new THREE.Scene();
        scene.background = new THREE.Color(0x060913);
        scene.fog = new THREE.FogExp2(0x060913, 0.00009);

        this.camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 50, 20000);
        this.baseTarget = new THREE.Vector3();
        this.basePos = new THREE.Vector3();
        this.zoomDist = 3000;
        this.camTarget = new THREE.Vector3();     // smoothed camera focus (between the two fighters)
        this.camDist = 0;                         // smoothed camera distance (0 = not initialised)
        this.v2 = new THREE.Vector3();

        // ---- lights
        scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x1a1033, 1.15));
        const key = this.key = new THREE.DirectionalLight(0xdbeafe, 2.6);
        key.position.set(-900, 1500, 1200);
        key.target.position.set(0, -150, 0);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        const sc = key.shadow.camera;
        sc.left = -1500; sc.right = 1500; sc.top = 1000; sc.bottom = -1000; sc.near = 100; sc.far = 4500;
        key.shadow.bias = -0.0004; key.shadow.normalBias = 1.2;
        scene.add(key, key.target);
        const rim = new THREE.DirectionalLight(0x8b5cf6, 1.6);
        rim.position.set(1100, 600, -1400);
        scene.add(rim);

        // ---- world
        this.stage = buildStage(scene);
        this.fx = new Effects(scene);
        this.fx.setStageTop(this.stage.topY);
        this.models = fighters.map((f, i) => this.makeModel(f, i));
        this.fx.models = this.models;
        this.items = new ItemsView(scene);
        this.arenaVersion = S.arenaVersion || 0;

        // ---- post
        const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: (window.innerWidth < 900 ? 0 : 2) });
        this.composer = new EffectComposer(r, rt);
        this.composer.addPass(new RenderPass(scene, this.camera));
        this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.5, 0.55, 0.92);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());

        this.clientX = window.innerWidth / 2;
        this.clientY = window.innerHeight / 2;
        this.ray = new THREE.Raycaster();
        this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        this.hit = new THREE.Vector3();
        this.clock = 0;
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    makeModel(f, i) {
        const m = new FighterModel(this.scene, f, { variant: i === 0 ? 'hero' : 'rival', fx: this.fx, light: i < 2 });
        m.setStageBounds(STAGE.x, STAGE.x + STAGE.width, this.stage.topY);
        if (this.inMatch === false) m.root.visible = false;
        return m;
    }

    /** the arena changed (1v1 <-> custom match) or a fighter changed colour (teams): rebuild what depends on it */
    syncWorld() {
        if ((S.arenaVersion || 0) !== this.arenaVersion) {
            this.arenaVersion = S.arenaVersion || 0;
            syncSpace();
            this.scene.remove(this.stage.root);
            this.stage = buildStage(this.scene);
            this.fx.setStageTop(this.stage.topY);
            this.models.forEach((m, i) => m.setStageBounds(STAGE.x, STAGE.x + STAGE.width, this.stage.topY));
            this.camDist = 0;
            this.applyQuality();
            for (const g of this.stage.rocks) g.visible = this.inMatch !== false;
        }
        fighters.forEach((f, i) => {
            const m = this.models[i];
            if (m.builtColor !== f.color) { m.dispose(); this.models[i] = this.makeModel(f, i); this.fx.models = this.models; }
        });
    }

    applyQuality() {
        const q = this.q, cap = Math.min(window.devicePixelRatio || 1, 1.5);
        const pr = q >= 4 ? 0.6 : q >= 3 ? 0.8 : Math.min(cap, q >= 2 ? 1 : cap);
        if (pr !== this.pr) { this.pr = pr; this.renderer.setPixelRatio(pr); this.resize(); }
        const m = this.inMatch !== false;
        this.bloom.enabled = m && q < 1;
        const sh = m && q < 2;
        if (this.renderer.shadowMap.enabled !== sh) { this.renderer.shadowMap.enabled = sh; this.key.castShadow = sh; this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
        this.stage.stars.visible = q < 3;
    }

    resize() {
        const w = window.innerWidth, h = window.innerHeight;
        this.renderer.setSize(w, h, false);
        this.composer.setSize(w, h);
        this.bloom.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.w = w; this.h = h;
    }

    /** distance at which the whole 3800x2100 map fills the view (like the original's scale-to-fit) */
    fitDistance() {
        const t = Math.tan(FOV * Math.PI / 360);
        const byH = (WORLD.height / 2) / t;
        const byW = (WORLD.width / 2) / (t * this.camera.aspect);
        return Math.max(byH, byW) * 1.05;
    }

    /**
     * Where the camera wants to be: framing the two fighters (zooming in when they are close,
     * out as they spread apart), never farther out than the whole map.
     */
    followGoal(out) {
        const d0 = this.fitDistance();
        const t = Math.tan(FOV * Math.PI / 360);
        let live = fighters.filter(f => f.active && !f.out);
        if (!live.length) live = [p1, p2];
        const xs = live.map(f => wx(f.x)), ys = live.map(f => wy(f.y));
        const ax = Math.min(...xs), bx = Math.max(...xs), ay = Math.min(...ys), by = Math.max(...ys);
        const halfW = (bx - ax) / 2 + 520, halfH = (by - ay) / 2 + 380;   // breathing room around the group
        let dist = Math.max(halfH / t, halfW / (t * this.camera.aspect));
        const big = WORLD.width / 3800;
        dist = Math.min(d0, Math.max(d0 / 2.7 / (big > 1 ? 1.6 : 1), dist));
        const lim = (v, m) => Math.max(-m, Math.min(m, v));
        out.set(lim((ax + bx) / 2, WORLD.width / 2), lim((ay + by) / 2, WORLD.height / 2), 0);
        return dist;
    }

    /** Position the camera for this frame (without shake). */
    placeCamera(dt = 0.016) {
        const d0 = this.fitDistance();
        const following = S.gameState === 'playing' || S.gameState === 'countdown';
        let goalDist = d0;
        const goal = this.v2.set(0, 0, 0);
        if (following) goalDist = this.followGoal(goal);
        if (!this.camDist) { this.camDist = goalDist; this.camTarget.copy(goal); }
        const k = 1 - Math.exp(-dt * 3.2);
        this.camDist += (goalDist - this.camDist) * k;
        this.camTarget.lerp(goal, k);

        let target = this.baseTarget.copy(this.camTarget);
        let dist = this.camDist;
        if (dramaticZoom.active) {
            const kk = clamp01((dramaticZoom.currentZoom - 1) / (dramaticZoom.targetZoom - 1));
            const e = smooth(kk);
            target.set(wx(dramaticZoom.targetX) * e, wy(dramaticZoom.targetY) * e, 0);
            dist = d0 / dramaticZoom.currentZoom;
        }
        if (this.debugCam) { target.copy(this.debugCam.target); dist = this.debugCam.dist; }
        this.zoomDist = dist;
        this.basePos.set(target.x, target.y + Math.sin(PITCH) * dist, Math.cos(PITCH) * dist);
        this.camera.position.copy(this.basePos);
        this.camera.lookAt(target);
        this.camera.updateMatrixWorld(true);
    }

    /** Convert the last known pointer position to world coordinates on the z = 0 play plane. */
    setPointer(clientX, clientY) { this.clientX = clientX; this.clientY = clientY; this.updateAim(); }

    updateAim() {
        if (mouse.touchMode) return;
        const ndc = new THREE.Vector2((this.clientX / this.w) * 2 - 1, -(this.clientY / this.h) * 2 + 1);
        this.ray.setFromCamera(ndc, this.camera);
        if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
            mouse.worldX = this.hit.x + CX;
            mouse.worldY = CY - this.hit.y;
        }
    }

    /** The aim matrix is measured from the player (the camera no longer sits on the map centre). */
    updateAimOrigin() {
        const me = fighters[S.mySlot || 0] || p1;
        const v = this.v2.set(wx(me.x), wy(me.y), 0).project(this.camera);
        mouse.originX = (v.x * 0.5 + 0.5) * this.w;
        mouse.originY = (-v.y * 0.5 + 0.5) * this.h;
        updateAimMatrix();
    }

    update(dt, alpha) {
        this.clock += dt;
        this.syncWorld();
        this.placeCamera(dt);
        this.updateAim();
        this.updateAimOrigin();

        // screen shake (the original shook the canvas by up to +-shake/2 pixels)
        if (S.screenShake > 0 && !dramaticZoom.active) {
            const worldPerPx = (2 * this.zoomDist * Math.tan(FOV * Math.PI / 360)) / this.h;
            const sx = (Math.random() - 0.5) * S.screenShake * worldPerPx * 1.4;
            const sy = (Math.random() - 0.5) * S.screenShake * worldPerPx * 1.4;
            this.camera.position.x += sx; this.camera.position.y += sy;
            this.camera.updateMatrixWorld(true);
        }

        // adaptive quality ladder: measure the real frame time; below ~30 fps step down (bloom, then shadows, then resolution),
        // and step back up after a long smooth stretch
        this.ft = this.ft ? this.ft * 0.92 + dt * 0.08 : dt;
        this.qT = (this.qT || 0) + dt;
        if (this.qT > 1.2) {
            if (this.ft > 1 / 30 && this.q < 4) { this.q++; this.qT = 0; this.applyQuality(); }
            else if (this.ft < 1 / 58 && this.q > 0 && this.qT > 8) { this.q--; this.qT = 0; this.applyQuality(); }
            else if (this.ft < 1 / 30) this.qT = Math.min(this.qT, 1.2);
        }

        // outside a match (menu / lobby) keep the scene light: no rocks, fewer stars, no fighters or shadows
        const inMatch = S.gameState !== 'start';
        if (inMatch !== this.inMatch) {
            this.inMatch = inMatch;
            for (const g of this.stage.rocks) g.visible = inMatch;
            this.stage.stars.material.opacity = inMatch ? 0.95 : 0.6;
            this.applyQuality();
            for (const m of this.models) m.root.visible = inMatch;
            if (!inMatch) this.items.update(0, this.clock, this.models);
            this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
        }
        this.stage.update(this.clock, dt);
        if (inMatch) {
            for (const m of this.models) m.update(dt, alpha, this.clock);
            this.fx.update(dt, this.models);
            this.items.update(dt, this.clock, this.models);
        } else this.fx.clearEvents();

        // keep the shadow frustum centred on the action
        this.composer.render(dt);
    }
}
