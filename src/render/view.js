// Renderer, camera, lights and post-processing. The camera always looks at the centre of
// the map, so the middle of the screen is the middle of the map (and the aim matrix,
// which the original measured from the screen centre, behaves identically).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { S, WORLD, STAGE, p1, p2, mouse, dramaticZoom, updateAimMatrix } from '../core.js';
import { CX, CY, wx, wy, lerp, smooth, clamp01 } from './space.js';
import { buildStage } from './stage.js';
import { FighterModel } from './fighterModel.js';
import { Effects } from './effects.js';

const FOV = 38;
const PITCH = 7 * Math.PI / 180;   // slight look-down so the platform top reads in 3D

export class View {
    constructor(canvas) {
        this.canvas = canvas;
        const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
        r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        r.outputColorSpace = THREE.SRGBColorSpace;
        r.toneMapping = THREE.ACESFilmicToneMapping;
        r.toneMappingExposure = 1.05;
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.PCFSoftShadowMap;

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
        key.shadow.mapSize.set(4096, 4096);
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
        this.models = [
            new FighterModel(scene, p1, { variant: 'hero', fx: this.fx }),
            new FighterModel(scene, p2, { variant: 'rival', fx: this.fx }),
        ];
        for (const m of this.models) m.setStageBounds(STAGE.x, STAGE.x + STAGE.width, this.stage.topY);
        this.fx.models = this.models;

        // ---- post
        const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
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

    resize() {
        const w = window.innerWidth, h = window.innerHeight;
        this.renderer.setSize(w, h, false);
        this.composer.setSize(w, h);
        this.bloom.setSize(w, h);
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
        const ax = wx(p1.x), ay = wy(p1.y), bx = wx(p2.x), by = wy(p2.y);
        const halfW = Math.abs(ax - bx) / 2 + 520;        // breathing room around the pair
        const halfH = Math.abs(ay - by) / 2 + 380;
        let dist = Math.max(halfH / t, halfW / (t * this.camera.aspect));
        dist = Math.min(d0, Math.max(d0 / 2.7, dist));
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
        const ndc = new THREE.Vector2((this.clientX / this.w) * 2 - 1, -(this.clientY / this.h) * 2 + 1);
        this.ray.setFromCamera(ndc, this.camera);
        if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
            mouse.worldX = this.hit.x + CX;
            mouse.worldY = CY - this.hit.y;
        }
    }

    /** The aim matrix is measured from the player (the camera no longer sits on the map centre). */
    updateAimOrigin() {
        const v = this.v2.set(wx(p1.x), wy(p1.y), 0).project(this.camera);
        mouse.originX = (v.x * 0.5 + 0.5) * this.w;
        mouse.originY = (-v.y * 0.5 + 0.5) * this.h;
        updateAimMatrix();
    }

    update(dt, alpha) {
        this.clock += dt;
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

        this.stage.update(this.clock, dt);
        for (const m of this.models) m.update(dt, alpha, this.clock);
        this.fx.update(dt, this.models);

        // keep the shadow frustum centred on the action
        this.composer.render(dt);
    }
}
