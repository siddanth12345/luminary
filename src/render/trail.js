// Ribbon trail: a fading strip dragged between two moving points (sword swings, fists,
// feet, dash tails). Purely visual; sampled from the animated rig every frame.
import * as THREE from 'three';

export class Trail {
    constructor(scene, { max = 22, color = '#22d3ee', life = 0.3, boost = 1.8 } = {}) {
        this.max = max;
        this.life = life;
        this.samples = []; // newest first: { a: Vector3, b: Vector3, age }
        this.color = new THREE.Color(color).multiplyScalar(boost);

        const pos = new Float32Array(max * 2 * 3);
        const col = new Float32Array(max * 2 * 4);
        const idx = [];
        for (let i = 0; i < max - 1; i++) {
            const a = i * 2;
            idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
        g.setIndex(idx);
        g.setDrawRange(0, 0);
        this.geo = g;
        this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
            vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
        }));
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 6;
        scene.add(this.mesh);
    }

    setColor(c, boost = 1.8) { this.color.set(c).multiplyScalar(boost); }

    push(a, b) {
        const s = this.samples;
        const last = s[0];
        // skip a duplicate (no motion) sample so the strip does not collapse
        if (last && last.a.distanceToSquared(a) < 0.04 && last.b.distanceToSquared(b) < 0.04) { last.age = 0; return; }
        s.unshift({ a: a.clone(), b: b.clone(), age: 0 });
        if (s.length > this.max) s.length = this.max;
    }

    /** Break the ribbon (e.g. when an attack ends) so the next swing does not connect to this one. */
    cut() { this.cutAt = this.samples.length; }

    update(dt) {
        const s = this.samples;
        for (const k of s) k.age += dt;
        while (s.length && s[s.length - 1].age > this.life) s.pop();
        const pos = this.geo.attributes.position.array;
        const col = this.geo.attributes.color.array;
        const n = s.length;
        for (let i = 0; i < n; i++) {
            const k = s[i];
            const fade = Math.pow(1 - Math.min(1, k.age / this.life), 1.4);
            const taper = 1 - i / Math.max(1, this.max) * 0.35;
            const o = i * 2;
            pos[o * 3] = k.a.x; pos[o * 3 + 1] = k.a.y; pos[o * 3 + 2] = k.a.z;
            pos[o * 3 + 3] = k.b.x; pos[o * 3 + 4] = k.b.y; pos[o * 3 + 5] = k.b.z;
            for (let v = 0; v < 2; v++) {
                const c = (o + v) * 4;
                col[c] = this.color.r; col[c + 1] = this.color.g; col[c + 2] = this.color.b;
                col[c + 3] = fade * taper * (v === 0 ? 0.95 : 0.55);
            }
        }
        this.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
        this.geo.attributes.position.needsUpdate = true;
        this.geo.attributes.color.needsUpdate = true;
    }

    clear() { this.samples.length = 0; this.geo.setDrawRange(0, 0); }
}
