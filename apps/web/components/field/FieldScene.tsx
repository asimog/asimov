"use client";
// The Field (docs/11, docs/19): every watched coin is an irregular point cloud, the firm is the Core, open paper
// positions are filaments from the Core. Motion comes only from cues (real events): a callout flares a cloud and drops a
// comet into it, a Jev read sweeps it, a fill draws a filament, a close retracts it. Idle, the field only breathes.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { cues, useLive } from "@/lib/live";
import { CORE, MAX_CLUSTERS, cloudFragment, cloudVertex, cometFragment, cometVertex, dustFragment, dustVertex, lineFragment, lineVertex } from "./shaders";

export type LabelSlot = { el: HTMLElement | null; slot: number };

const hash = (s: string, k: number) => {
  let h = 2166136261 ^ k;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
};

type Slot = { mint: string | null; flare: number; shimmer: number; size: number; seenAt: number };

/** Clusters live on a wide shallow disc; the Core floats above the middle. Positions come from the mint: stable forever. */
function centerOf(mint: string) {
  const a = hash(mint, 1) * Math.PI * 2;
  const r = 9 + Math.sqrt(hash(mint, 2)) * 20;
  return new THREE.Vector3(6 + Math.cos(a) * r * 1.1, (hash(mint, 3) - 0.5) * 9, Math.sin(a) * r * 0.7);
}

function Field({ points, labels }: { points: number; labels: React.MutableRefObject<LabelSlot[]> }) {
  const { size, camera } = useThree();
  const slots = useRef<Slot[]>(Array.from({ length: MAX_CLUSTERS }, () => ({ mint: null, flare: 0, shimmer: 0, size: 0, seenAt: 0 })));
  const bySlot = useRef(new Map<string, number>());
  const lastSeq = useRef(0);
  const lastPick = useRef(-1);
  const temp = useRef(0);
  const group = useRef<THREE.Group>(null);

  // ---------- one buffer of points, split across 64 clusters ----------
  const cloud = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const cl = new Float32Array(points);
    const r1 = new Float32Array(points * 4);
    const r2 = new Float32Array(points * 4);
    const coreN = Math.floor(points * 0.08);
    const per = Math.floor((points - coreN) / (MAX_CLUSTERS - 1));
    let rnd = 1;
    const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < points; i++) {
      cl[i] = i < coreN ? CORE : Math.min(CORE - 1, Math.floor((i - coreN) / per));
      for (let k = 0; k < 4; k++) {
        r1[i * 4 + k] = rand();
        r2[i * 4 + k] = rand();
      }
    }
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points * 3), 3));
    g.setAttribute("aCluster", new THREE.BufferAttribute(cl, 1));
    g.setAttribute("aRand", new THREE.BufferAttribute(r1, 4));
    g.setAttribute("aRand2", new THREE.BufferAttribute(r2, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
    const u = {
      uTime: { value: 0 }, uPx: { value: 300 }, uTemp: { value: 0 },
      uCenter: { value: Array.from({ length: MAX_CLUSTERS }, () => new THREE.Vector4(0, -999, 0, 0)) },
      uState: { value: Array.from({ length: MAX_CLUSTERS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uSeed: { value: Array.from({ length: MAX_CLUSTERS }, (_, i) => i * 7.13) },
    };
    u.uCenter.value[CORE]!.set(0, 5, 0, 2.2);
    u.uState.value[CORE]!.set(0, 0, 2, 1);
    const m = new THREE.ShaderMaterial({ vertexShader: cloudVertex, fragmentShader: cloudFragment, uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return { g, m, u };
  }, [points]);

  const dust = useMemo(() => {
    const n = Math.floor(points / 12);
    const g = new THREE.BufferGeometry();
    const r = new Float32Array(n * 4);
    for (let i = 0; i < r.length; i++) r[i] = Math.random();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aRand", new THREE.BufferAttribute(r, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
    const m = new THREE.ShaderMaterial({ vertexShader: dustVertex, fragmentShader: dustFragment, uniforms: { uTime: { value: 0 }, uPx: { value: 300 }, uTemp: cloud.u.uTemp }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return { g, m };
  }, [points, cloud]);

  // ---------- filaments: Core to every cluster we hold, 24 segments each ----------
  const SEG = 24;
  const lines = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_CLUSTERS * SEG * 2 * 3), 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(MAX_CLUSTERS * SEG * 2), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
    const m = new THREE.ShaderMaterial({ vertexShader: lineVertex, fragmentShader: lineFragment, uniforms: { uTemp: cloud.u.uTemp }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return { g, m, held: new Float32Array(MAX_CLUSTERS), grow: new Float32Array(MAX_CLUSTERS), flick: new Float32Array(MAX_CLUSTERS) };
  }, [cloud]);

  // ---------- comets: a callout falls into its coin's cloud ----------
  const COMETS = 48;
  const comets = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COMETS * 3), 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(COMETS), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
    const m = new THREE.ShaderMaterial({ vertexShader: cometVertex, fragmentShader: cometFragment, uniforms: { uPx: cloud.u.uPx }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return { g, m, live: Array.from({ length: COMETS }, () => ({ t: -1, slot: 0, from: new THREE.Vector3() })), next: 0 };
  }, [cloud]);

  useEffect(() => () => {
    for (const x of [cloud, dust, lines, comets]) (x.g.dispose(), x.m.dispose());
  }, [cloud, dust, lines, comets]);

  /** A coin gets a slot when it first appears; the least recently active coin gives its slot up. */
  const slotFor = (mint: string, now: number) => {
    const have = bySlot.current.get(mint);
    if (have !== undefined) return have;
    let best = 0;
    for (let i = 0; i < CORE; i++) {
      const s = slots.current[i]!;
      if (!s.mint) { best = i; break; }
      if (s.seenAt < slots.current[best]!.seenAt) best = i;
    }
    const s = slots.current[best]!;
    if (s.mint) bySlot.current.delete(s.mint);
    Object.assign(s, { mint, flare: 0, shimmer: 0, size: 0, seenAt: now });
    bySlot.current.set(mint, best);
    const c = centerOf(mint);
    cloud.u.uCenter.value[best]!.set(c.x, c.y, c.z, 0.01);
    cloud.u.uSeed.value[best] = hash(mint, 4) * 1000;
    return best;
  };

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const now = performance.now();
    const px = size.height * 0.085 * Math.min(2, state.gl.getPixelRatio());
    cloud.u.uTime.value = t;
    cloud.u.uPx.value = px;
    dust.m.uniforms.uTime!.value = t;
    dust.m.uniforms.uPx!.value = px;
    const { snap, coins } = useLive.getState();

    // once a second: the 63 most called coins hold the slots; a coin that drops out frees its slot (stable otherwise)
    if (now - lastPick.current > 1000) {
      lastPick.current = now;
      // coins we hold come first (their filaments must have somewhere to land), then the most called
      const held = new Set((snap?.positions ?? []).map((p) => p.mint));
      const pool = new Map(coins);
      for (const m of held) if (!pool.has(m)) pool.set(m, { mint: m, sym: m.slice(0, 4), callout_count: 0, mcap: null, progress: null, wave_p: null, last_trade_at: null, first_callout_at: null });
      const want = [...pool.values()]
        .sort((a, b) => Number(held.has(b.mint)) - Number(held.has(a.mint)) || b.callout_count - a.callout_count || (b.first_callout_at ?? "").localeCompare(a.first_callout_at ?? ""))
        .slice(0, CORE);
      const keep = new Set(want.map((c) => c.mint));
      for (const [mint, i] of bySlot.current)
        if (!keep.has(mint)) {
          bySlot.current.delete(mint);
          Object.assign(slots.current[i]!, { mint: null, flare: 0, shimmer: 0, size: 0 });
          cloud.u.uCenter.value[i]!.set(0, -999, 0, 0);
        }
      for (const c of want) slots.current[slotFor(c.mint, now)]!.size = 1.6 + Math.log1p(c.callout_count) * 1.15;
    }

    // drain real events
    let lastJevSlot = -1;
    for (let k = cues.length - 1; k >= 0 && cues[k]!.seq > lastSeq.current; k--) {
      const cu = cues[k]!;
      const i = cu.mint ? (bySlot.current.get(cu.mint) ?? -1) : -1; // events on coins outside the view move nothing
      if (i >= 0) slots.current[i]!.seenAt = now;
      if (cu.kind === "callout" && i >= 0) {
        slots.current[i]!.flare = 1;
        const c = comets.live[comets.next++ % COMETS]!;
        c.t = 0;
        c.slot = i;
        const ctr = cloud.u.uCenter.value[i]!;
        c.from.set(ctr.x + (hash(cu.mint!, cu.seq) - 0.5) * 18, 34, ctr.z + (hash(cu.mint!, cu.seq + 1) - 0.5) * 8);
        lastJevSlot = i;
      } else if (cu.kind === "trade" && i >= 0) slots.current[i]!.flare = Math.min(1, slots.current[i]!.flare + 0.05 + Math.min(0.25, cu.v * 0.08));
      else if (cu.kind === "watch" && i >= 0) slots.current[i]!.flare = Math.max(slots.current[i]!.flare, 0.5);
      else if (cu.kind === "jev") {
        const j = lastJevSlot >= 0 ? lastJevSlot : [...bySlot.current.values()].at(-1);
        if (j !== undefined && j >= 0) slots.current[j]!.shimmer = 1;
      } else if (cu.kind === "fill" && i >= 0) lines.flick[i] = 1;
      else if (cu.kind === "commit") slots.current[CORE]!.flare = Math.min(1, slots.current[CORE]!.flare + 0.4);
      else if (cu.kind === "post" && i >= 0) lines.flick[i] = 1;
    }
    if (cues.length) lastSeq.current = cues[cues.length - 1]!.seq;

    // held coins: open paper positions
    lines.held.fill(0);
    for (const p of snap?.positions ?? []) {
      const i = bySlot.current.get(p.mint);
      if (i !== undefined) lines.held[i] += p.cost_sol;
    }

    // temperature: the average strategy's paper loss against its own floor (each strategy trades its own book)
    const floorSol = (snap?.floor_frac ?? 0.25) * (snap?.mandate_sol ?? 0.2);
    const net = (snap?.pool.net ?? 0) / Math.max(1, snap?.pool.born ?? 1);
    const target = net >= 0 ? 0 : Math.min(1, -net / Math.max(1e-9, floorSol));
    temp.current += (target - temp.current) * Math.min(1, dt * 2.2);
    cloud.u.uTemp.value = temp.current;

    // per-slot state into uniforms
    const pos = lines.g.attributes.position as THREE.BufferAttribute;
    const alp = lines.g.attributes.aAlpha as THREE.BufferAttribute;
    const core = cloud.u.uCenter.value[CORE]!;
    for (let i = 0; i < MAX_CLUSTERS; i++) {
      const s = slots.current[i]!;
      s.flare = Math.max(0, s.flare - dt * 0.9);
      s.shimmer = Math.max(0, s.shimmer - dt * 4.5);
      const st = cloud.u.uState.value[i]!;
      if (i === CORE) {
        st.set(s.flare, 0, 2, 1);
        continue;
      }
      const ctr = cloud.u.uCenter.value[i]!;
      if (!s.mint) {
        st.set(0, 0, 0, 0);
        continue;
      }
      ctr.w += (s.size - ctr.w) * Math.min(1, dt * 1.5);
      const heldK = lines.held[i]! > 0 ? 1 : 0;
      const idle = Math.min(1, (now - s.seenAt) / 600_000);
      st.set(s.flare, s.shimmer, heldK, 0.35 + 0.65 * (1 - idle * 0.6));

      // filament
      lines.grow[i] += ((heldK ? 1 : 0) - lines.grow[i]!) * Math.min(1, dt * 1.6);
      lines.flick[i] = Math.max(0, lines.flick[i]! - dt * 2.5);
      const g = lines.grow[i]!;
      const bright = Math.min(1, 0.25 + lines.held[i]! * 18) * g + lines.flick[i]! * 0.8;
      for (let k = 0; k < SEG; k++) {
        for (let e = 0; e < 2; e++) {
          const u = Math.min((k + e) / SEG, g);
          const lift = Math.sin(u * Math.PI) * 4;
          const x = core.x + (ctr.x - core.x) * u;
          const y = core.y + (ctr.y - core.y) * u + lift;
          const z = core.z + (ctr.z - core.z) * u;
          const vi = (i * SEG + k) * 2 + e;
          pos.setXYZ(vi, x, y, z);
          alp.setX(vi, g > 0.01 ? bright * (0.35 + 0.65 * Math.sin(u * Math.PI)) * 0.5 : 0);
        }
      }
    }
    pos.needsUpdate = true;
    alp.needsUpdate = true;

    // comets: 1.1 s from the sky into the cloud
    const cp = comets.g.attributes.position as THREE.BufferAttribute;
    const ca = comets.g.attributes.aAlpha as THREE.BufferAttribute;
    for (let k = 0; k < COMETS; k++) {
      const c = comets.live[k]!;
      if (c.t < 0) {
        ca.setX(k, 0);
        continue;
      }
      c.t += dt / 1.1;
      const ctr = cloud.u.uCenter.value[c.slot]!;
      const e = 1 - (1 - Math.min(1, c.t)) ** 3;
      cp.setXYZ(k, c.from.x + (ctr.x - c.from.x) * e, c.from.y + (ctr.y - c.from.y) * e, c.from.z + (ctr.z - c.from.z) * e);
      ca.setX(k, c.t >= 1 ? 0 : 1 - c.t * 0.4);
      if (c.t >= 1) c.t = -1;
    }
    cp.needsUpdate = true;
    ca.needsUpdate = true;

    // labels: the busiest clouds, projected into the DOM (no React render per frame)
    const v = new THREE.Vector3();
    const ranked = [...bySlot.current.entries()].sort((a, b) => (coins.get(b[0])?.callout_count ?? 0) - (coins.get(a[0])?.callout_count ?? 0));
    labels.current.forEach((l, n) => {
      const pair = ranked[n];
      if (!l.el) return;
      if (!pair) {
        l.el.style.opacity = "0";
        return;
      }
      const [mint, i] = pair;
      const ctr = cloud.u.uCenter.value[i]!;
      v.set(ctr.x, ctr.y + ctr.w * 0.9, ctr.z);
      if (group.current) v.applyMatrix4(group.current.matrixWorld);
      v.project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      l.el.style.opacity = visible ? "1" : "0";
      l.el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
      const c = coins.get(mint);
      const text = `$${c?.sym ?? mint.slice(0, 4)} ${c?.callout_count ?? 0}`;
      if (l.el.textContent !== text) l.el.textContent = text;
      l.slot = i;
    });
  });

  return (
    <group ref={group}>
      <points geometry={dust.g} material={dust.m} frustumCulled={false} />
      <points geometry={cloud.g} material={cloud.m} frustumCulled={false} />
      <lineSegments geometry={lines.g} material={lines.m} frustumCulled={false} />
      <points geometry={comets.g} material={comets.m} frustumCulled={false} />
    </group>
  );
}

/** Drag to turn the field; it never turns by itself. */
function DragRig({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  const target = useRef({ y: 0, x: 0 });
  const { gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const start = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const move = (e: PointerEvent) => {
      if (!down) return;
      target.current.y += (e.clientX - down.x) * 0.004;
      target.current.x = Math.max(-0.35, Math.min(0.35, target.current.x + (e.clientY - down.y) * 0.002));
      down = { x: e.clientX, y: e.clientY };
    };
    const end = () => (down = null);
    el.addEventListener("pointerdown", start);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => {
      el.removeEventListener("pointerdown", start);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
  }, [gl]);
  useFrame((_, dt) => {
    if (!g.current) return;
    g.current.rotation.y += (target.current.y - g.current.rotation.y) * Math.min(1, dt * 6);
    g.current.rotation.x += (target.current.x - g.current.rotation.x) * Math.min(1, dt * 6);
  });
  return <group ref={g}>{children}</group>;
}

export default function FieldScene({ labels, mobile }: { labels: React.MutableRefObject<LabelSlot[]>; mobile: boolean }) {
  return (
    <Canvas
      dpr={[1, mobile ? 1.5 : 2]}
      camera={{ position: [-9, 15, 54], fov: 44, near: 0.1, far: 400 }}
      gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ camera }) => camera.lookAt(-9, 1, 0)} // the field sits right of centre, clear of the statement
      aria-hidden="true"
    >
      <DragRig>
        <Field points={mobile ? 40_000 : 180_000} labels={labels} />
      </DragRig>
    </Canvas>
  );
}
