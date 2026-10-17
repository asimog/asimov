"use client";
// The Cortex (docs/11, docs/19): a procedural point-cloud brain on paper. Each lobe is one lane of the firm; it turns teal
// while its lane writes events (lit for 2 s after each one) and fades back to ink. No mesh, no license: math only.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { LANES, useLive } from "@/lib/live";

/** Lobe centers in brain space (x left-right, y up, z front). Order matches LANES. */
export const LOBES: [number, number, number][] = [
  [0, 1.5, -9.5], // sense: occipital, back
  [0, 6.2, -3.5], // analyze: parietal, top back
  [0, -0.5, 0], // reflex: thalamus, deep centre
  [0, 4.5, 6.5], // decide: frontal
  [0, 1.5, 9.8], // risk: prefrontal, the very front
  [5.5, 6.5, 1], // execute: motor strip
  [7.8, 0.5, 5.2], // publish: Broca's area, side front
  [0, -2.5, -2.5], // memory: hippocampus, low
  [0, -5.5, -7.5], // treasury: cerebellum
  [0, 8.2, 3], // counsel: marked region at the top
];

const vert = /* glsl */ `
uniform float uTime;
uniform float uPx;
uniform float uLit[10];
attribute float aLobe;
attribute float aRand;
varying float vLit;
varying float vA;
void main() {
  int i = int(aLobe + 0.5);
  float lit = uLit[i];
  vec3 p = position + normal * sin(uTime * 0.25 + aRand * 30.0) * 0.04;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.8 + aRand * 0.9 + lit * 0.9) * uPx / max(1.0, -mv.z);
  vLit = lit;
  vA = clamp(1.25 - (-mv.z) / 60.0, 0.25, 1.0);
}
`;
const frag = /* glsl */ `
varying float vLit;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, d);
  vec3 ink = vec3(0.17, 0.16, 0.14);
  vec3 teal = vec3(0.16, 0.56, 0.62);
  gl_FragColor = vec4(mix(ink, teal, vLit), a * vA * (0.42 + vLit * 0.5));
}
`;

function hash(n: number) {
  return Math.abs(Math.sin(n * 127.1) * 43758.5453) % 1;
}

function Brain({ points, labels }: { points: number; labels: React.MutableRefObject<(HTMLElement | null)[]> }) {
  const { size, camera } = useThree();
  const lit = useRef(new Float32Array(LANES.length));
  const grp = useRef<THREE.Group>(null);
  const brain = useMemo(() => {
    const pos = new Float32Array(points * 3);
    const nor = new Float32Array(points * 3);
    const lobe = new Float32Array(points);
    const rnd = new Float32Array(points);
    const v = new THREE.Vector3();
    for (let i = 0; i < points; i++) {
      // a hemisphere surface: deformed ellipsoid, folded by a few sine octaves (gyri and sulci), slightly under the skin
      const u = hash(i + 0.1) * Math.PI * 2;
      const w = Math.acos(2 * hash(i + 0.7) - 1);
      const side = i % 2 ? 1 : -1;
      v.set(Math.sin(w) * Math.cos(u), Math.cos(w), Math.sin(w) * Math.sin(u));
      const fold = 1 + 0.1 * Math.sin(v.x * 9 + v.z * 7) * Math.sin(v.y * 11) + 0.05 * Math.sin(v.z * 23 + v.y * 5) + 0.03 * Math.sin(v.x * 31 + v.y * 17);
      const depth = 0.86 + 0.14 * hash(i + 2.3);
      const p = new THREE.Vector3(Math.abs(v.x) * 4.6 * side + side * 0.6, v.y * 6.4 + (v.z < -0.6 ? -1.2 : 0), v.z * 10.2).multiplyScalar(fold * depth);
      if (p.y < -3.2 && p.z > -4) p.y = -3.2 + (p.y + 3.2) * 0.3; // flatten the base
      pos.set([p.x, p.y, p.z], i * 3);
      const n = p.clone().normalize();
      nor.set([n.x, n.y, n.z], i * 3);
      let best = 0;
      let bd = Infinity;
      LOBES.forEach((c, k) => {
        const d = (Math.abs(p.x) - Math.abs(c[0])) ** 2 + (p.y - c[1]) ** 2 + (p.z - c[2]) ** 2;
        if (d < bd) ((bd = d), (best = k));
      });
      lobe[i] = best;
      rnd[i] = hash(i + 9.9);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("aLobe", new THREE.BufferAttribute(lobe, 1));
    g.setAttribute("aRand", new THREE.BufferAttribute(rnd, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uPx: { value: 200 }, uLit: { value: new Array(10).fill(0) } } });
    return { g, m };
  }, [points]);

  useFrame((state, dt) => {
    const now = Date.now();
    const lanes = useLive.getState().lanes;
    LANES.forEach((l, k) => {
      const on = now - lanes[l].at < 2000 ? 1 : 0;
      lit.current[k] += (on - lit.current[k]!) * Math.min(1, dt * (on ? 8 : 1.2));
      (brain.m.uniforms.uLit!.value as number[])[k] = lit.current[k]!;
    });
    brain.m.uniforms.uTime!.value = state.clock.elapsedTime;
    brain.m.uniforms.uPx!.value = size.height * 0.11 * Math.min(2, state.gl.getPixelRatio());
    const v = new THREE.Vector3();
    LOBES.forEach((c, k) => {
      const el = labels.current[k];
      if (!el || !grp.current) return;
      v.set(c[0] || 0.01, c[1], c[2]).applyMatrix4(grp.current.matrixWorld).project(camera);
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
      el.dataset.lit = lit.current[k]! > 0.3 ? "yes" : "no";
    });
  });

  return (
    <group ref={grp} rotation={[0.16, -0.55, 0]} position={[4, 0, 0]}>
      <points geometry={brain.g} material={brain.m} frustumCulled={false} />
    </group>
  );
}

export default function CortexScene({ labels, mobile }: { labels: React.MutableRefObject<(HTMLElement | null)[]>; mobile: boolean }) {
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 3, 34], fov: 40 }} gl={{ antialias: false, alpha: true }} aria-hidden="true">
      <Brain points={mobile ? 30_000 : 110_000} labels={labels} />
    </Canvas>
  );
}
