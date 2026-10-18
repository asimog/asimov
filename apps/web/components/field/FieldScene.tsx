"use client";
// The Field (docs/UI.md, docs/UI.md, docs/inspiration "Survival Field"). Every watched coin is a cloud of fibre in one of two
// regions: still on the bonding curve, or graduated to PumpSwap. Coins that share a caller are joined by strands; the
// firm (the Core) is joined to every coin it holds. Packets are real events: a buy flows into a cloud, a sell flows out,
// a caller moving from one coin to the next runs along their strand, a paper fill runs from the Core. Idle, it breathes.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { cues, graduatedLive, liveEdges, useLive } from "@/lib/live";
import { CORE, MAX_CLUSTERS, cloudFragment, cloudVertex, dustFragment, dustVertex, lineFragment, lineVertex, packetFragment, packetVertex } from "./shaders";

export type Overlay = {
  labels: (HTMLElement | null)[];
  boxes: { el: HTMLElement | null; line: SVGLineElement | null }[];
  regions: (HTMLElement | null)[];
};

const hash = (s: string, k: number) => {
  let h = 2166136261 ^ k;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
};

/** Region A: on the bonding curve. Region B: graduated to PumpSwap. The Core floats between them. */
const REGION = [
  { c: new THREE.Vector3(2, 0, 0), rx: 20, rz: 14 },
  { c: new THREE.Vector3(31, 3, -8), rx: 10, rz: 8 },
];
const CORE_AT = new THREE.Vector3(16, 13, 6);
const centerOf = (mint: string, grad: boolean) => {
  const R = REGION[grad ? 1 : 0]!;
  const a = hash(mint, 1) * Math.PI * 2;
  const r = Math.sqrt(hash(mint, 2));
  return new THREE.Vector3(R.c.x + Math.cos(a) * r * R.rx, R.c.y + (hash(mint, 3) - 0.5) * 9, R.c.z + Math.sin(a) * r * R.rz);
};

type Slot = { mint: string | null; flare: number; shimmer: number; size: number; seenAt: number; grad: boolean };
type Packet = { t: number; dur: number; a: THREE.Vector3; b: THREE.Vector3; lift: number; hot: number; alive: boolean };
type Box = { until: number; slot: number; text: string };

const SEG = 14;
const TRAIL = 6;
const PACKETS = 1400;

/** A point on the strand from a to b: a quadratic arc lifted over the field. */
function arc(a: THREE.Vector3, b: THREE.Vector3, lift: number, u: number, out: THREE.Vector3) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + lift;
  const mz = (a.z + b.z) / 2;
  const v = 1 - u;
  return out.set(v * v * a.x + 2 * v * u * mx + u * u * b.x, v * v * a.y + 2 * v * u * my + u * u * b.y, v * v * a.z + 2 * v * u * mz + u * u * b.z);
}

function Field({ points, overlay }: { points: number; overlay: React.MutableRefObject<Overlay> }) {
  const { size, camera } = useThree();
  const mobileView = size.width < 760;
  const slots = useRef<Slot[]>(Array.from({ length: MAX_CLUSTERS }, () => ({ mint: null, flare: 0, shimmer: 0, size: 0, seenAt: 0, grad: false })));
  const bySlot = useRef(new Map<string, number>());
  const lastSeq = useRef(0);
  const lastPick = useRef(-1);
  const lastNet = useRef("");
  const temp = useRef(0);
  const group = useRef<THREE.Group>(null);
  const boxes = useRef<Box[]>([]);
  const packets = useRef<Packet[]>(Array.from({ length: PACKETS }, () => ({ t: 0, dur: 1, a: new THREE.Vector3(), b: new THREE.Vector3(), lift: 0, hot: 0, alive: false })));
  const nextPacket = useRef(0);
  const reduced = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  // ---------- clouds: one buffer, 64 clusters, drawn twice (points, then the wide faint glow) ----------
  const cloud = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const cl = new Float32Array(points);
    const r1 = new Float32Array(points * 4);
    const r2 = new Float32Array(points * 4);
    const coreN = Math.floor(points * 0.012);
    const per = Math.floor((points - coreN) / (MAX_CLUSTERS - 1));
    let rnd = 7;
    const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < points; i++) {
      cl[i] = i < coreN ? CORE : Math.min(CORE - 1, Math.floor((i - coreN) / per));
      for (let k = 0; k < 4; k++) ((r1[i * 4 + k] = rand()), (r2[i * 4 + k] = rand()));
    }
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points * 3), 3));
    g.setAttribute("aCluster", new THREE.BufferAttribute(cl, 1));
    g.setAttribute("aRand", new THREE.BufferAttribute(r1, 4));
    g.setAttribute("aRand2", new THREE.BufferAttribute(r2, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 300);
    const shared = {
      uTime: { value: 0 }, uPx: { value: 300 }, uTemp: { value: 0 },
      uCenter: { value: Array.from({ length: MAX_CLUSTERS }, () => new THREE.Vector4(0, -999, 0, 0)) },
      uState: { value: Array.from({ length: MAX_CLUSTERS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uSeed: { value: Array.from({ length: MAX_CLUSTERS }, (_, i) => i * 7.13) },
    };
    shared.uCenter.value[CORE]!.set(CORE_AT.x, CORE_AT.y, CORE_AT.z, 2.2);
    shared.uState.value[CORE]!.set(0, 0, 2, 1);
    const mk = (halo: number) => new THREE.ShaderMaterial({ vertexShader: cloudVertex, fragmentShader: cloudFragment, uniforms: { ...shared, uHalo: { value: halo } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return { g, m: mk(0), halo: mk(1), u: shared };
  }, [points]);

  const dust = useMemo(() => {
    const n = Math.floor(points / 10);
    const g = new THREE.BufferGeometry();
    const r = new Float32Array(n * 4);
    for (let i = 0; i < r.length; i++) r[i] = Math.random();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aRand", new THREE.BufferAttribute(r, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 300);
    const m = new THREE.ShaderMaterial({ vertexShader: dustVertex, fragmentShader: dustFragment, uniforms: { uTime: cloud.u.uTime, uPx: cloud.u.uPx, uTemp: cloud.u.uTemp }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return { g, m };
  }, [points, cloud]);

  // ---------- the network: strand bundles between linked coins, filament bundles from the Core ----------
  const MAXV = 420 * 10 * SEG * 2;
  const net = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAXV * 3), 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(MAXV), 1));
    g.setAttribute("aKind", new THREE.BufferAttribute(new Float32Array(MAXV), 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 300);
    const m = new THREE.ShaderMaterial({ vertexShader: lineVertex, fragmentShader: lineFragment, uniforms: { uTemp: cloud.u.uTemp }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return { g, m };
  }, [cloud, MAXV]);

  // ---------- packets ----------
  const pk = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PACKETS * TRAIL * 3), 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(PACKETS * TRAIL), 1));
    g.setAttribute("aHot", new THREE.BufferAttribute(new Float32Array(PACKETS * TRAIL), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 300);
    const m = new THREE.ShaderMaterial({ vertexShader: packetVertex, fragmentShader: packetFragment, uniforms: { uPx: cloud.u.uPx, uTemp: cloud.u.uTemp }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return { g, m };
  }, [cloud]);

  useEffect(() => () => {
    for (const x of [dust, net, pk]) (x.g.dispose(), x.m.dispose());
    cloud.g.dispose();
    cloud.m.dispose();
    cloud.halo.dispose();
  }, [cloud, dust, net, pk]);

  const ctr = (i: number, out = new THREE.Vector3()) => {
    const c = cloud.u.uCenter.value[i]!;
    return out.set(c.x, c.y, c.z);
  };
  const send = (a: THREE.Vector3, b: THREE.Vector3, dur: number, lift: number, hot: number) => {
    const p = packets.current[nextPacket.current++ % PACKETS]!;
    Object.assign(p, { t: 0, dur, lift, hot, alive: true });
    p.a.copy(a);
    p.b.copy(b);
  };

  const slotFor = (mint: string, now: number, grad: boolean) => {
    const have = bySlot.current.get(mint);
    if (have !== undefined) return have;
    let best = 0;
    for (let i = 0; i < CORE; i++) {
      const s = slots.current[i]!;
      if (!s.mint) {
        best = i;
        break;
      }
      if (s.seenAt < slots.current[best]!.seenAt) best = i;
    }
    const s = slots.current[best]!;
    if (s.mint) bySlot.current.delete(s.mint);
    Object.assign(s, { mint, flare: 0, shimmer: 0, size: 0, seenAt: now, grad });
    bySlot.current.set(mint, best);
    const c = centerOf(mint, grad);
    cloud.u.uCenter.value[best]!.set(c.x, c.y, c.z, 0.01);
    cloud.u.uSeed.value[best] = hash(mint, 4) * 1000;
    return best;
  };

  const tmp = useMemo(() => new THREE.Vector3(), []);
  const tmp2 = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const now = performance.now();
    const { snap, coins } = useLive.getState();
    cloud.u.uTime.value = t;
    cloud.u.uPx.value = size.height * 0.11 * Math.min(2, state.gl.getPixelRatio());
    const grads = new Set([...(snap?.graduated ?? []), ...graduatedLive]);

    // once a second: held coins first, then the most called, hold the 63 slots; the network is rebuilt if it changed
    if (now - lastPick.current > 1000) {
      lastPick.current = now;
      const held = new Map<string, number>();
      for (const p of snap?.positions ?? []) held.set(p.mint, (held.get(p.mint) ?? 0) + p.cost_sol);
      const pool = new Map(coins);
      for (const m of held.keys()) if (!pool.has(m)) pool.set(m, { mint: m, sym: m.slice(0, 4), callout_count: 0, mcap: null, progress: null, wave_p: null, last_trade_at: null, first_callout_at: null });
      const want = [...pool.values()]
        .sort((a, b) => Number(held.has(b.mint)) - Number(held.has(a.mint)) || b.callout_count - a.callout_count || (b.first_callout_at ?? "").localeCompare(a.first_callout_at ?? ""))
        .slice(0, CORE);
      const keep = new Set(want.map((c) => c.mint));
      for (const [mint, i] of bySlot.current)
        if (!keep.has(mint) || slots.current[i]!.grad !== grads.has(mint)) {
          bySlot.current.delete(mint);
          Object.assign(slots.current[i]!, { mint: null, flare: 0, shimmer: 0, size: 0 });
          cloud.u.uCenter.value[i]!.set(0, -999, 0, 0);
        }
      for (const c of want) slots.current[slotFor(c.mint, now, grads.has(c.mint))]!.size = 2.6 + Math.log1p(c.callout_count + (held.get(c.mint) ?? 0) * 40) * 1.35;

      // network geometry
      const links = [...(snap?.edges ?? []), ...liveEdges]
        .map((e) => ({ a: bySlot.current.get(e.a), b: bySlot.current.get(e.b), n: e.n }))
        .filter((e): e is { a: number; b: number; n: number } => e.a !== undefined && e.b !== undefined && e.a !== e.b);
      const heldSlots = [...held.entries()].flatMap(([m, sol]) => (bySlot.current.has(m) ? [{ i: bySlot.current.get(m)!, sol }] : []));
      const sig = `${links.map((l) => `${l.a}-${l.b}`).join(",")}|${heldSlots.map((h) => h.i).join(",")}|${[...bySlot.current.values()].join(",")}`;
      if (sig !== lastNet.current) {
        lastNet.current = sig;
        const pos = net.g.attributes.position as THREE.BufferAttribute;
        const alp = net.g.attributes.aAlpha as THREE.BufferAttribute;
        const kind = net.g.attributes.aKind as THREE.BufferAttribute;
        let v = 0;
        const bundle = (A: THREE.Vector3, B: THREE.Vector3, strands: number, alpha: number, k: number, seed: number) => {
          const dist = A.distanceTo(B);
          for (let s = 0; s < strands && v + SEG * 2 <= MAXV; s++) {
            const lift = dist * (0.05 + 0.1 * hash(`${seed}`, s)) + (k ? 1.5 : 0);
            const jx = (hash(`${seed}x`, s) - 0.5) * 2.2;
            const jz = (hash(`${seed}z`, s) - 0.5) * 2.2;
            const a2 = new THREE.Vector3(A.x + jx, A.y, A.z + jz);
            const b2 = new THREE.Vector3(B.x - jx, B.y, B.z - jz);
            for (let q = 0; q < SEG; q++) {
              for (const u of [q / SEG, (q + 1) / SEG]) {
                arc(a2, b2, lift, u, tmp);
                pos.setXYZ(v, tmp.x, tmp.y, tmp.z);
                alp.setX(v, alpha * Math.sin(u * Math.PI) ** 0.6);
                kind.setX(v, k);
                v++;
              }
            }
          }
        };
        for (const l of links) bundle(ctr(l.a), ctr(l.b), 4 + Math.min(8, l.n * 2), 0.035 + Math.min(0.06, l.n * 0.015), 0, l.a * 97 + l.b);
        for (const h of heldSlots) bundle(CORE_AT, ctr(h.i), 7, 0.06 + Math.min(0.14, h.sol * 2), 1, h.i * 13);
        net.g.setDrawRange(0, v);
        pos.needsUpdate = true;
        alp.needsUpdate = true;
        kind.needsUpdate = true;
      }
    }

    // ---------- real events become motion ----------
    const fresh = [];
    for (let k = cues.length - 1; k >= 0 && cues[k]!.seq > lastSeq.current; k--) fresh.push(cues[k]!);
    if (cues.length) lastSeq.current = cues[cues.length - 1]!.seq;
    let lastCalled = -1;
    for (const cu of fresh.reverse()) {
      const i = cu.mint ? (bySlot.current.get(cu.mint) ?? -1) : -1;
      if (i >= 0) slots.current[i]!.seenAt = now;
      const c = i >= 0 ? ctr(i) : null;
      const r = i >= 0 ? cloud.u.uCenter.value[i]!.w : 0;
      if (cu.kind === "callout" && c) {
        slots.current[i]!.flare = 1;
        lastCalled = i;
        // the call falls in from above; if the caller came from another coin, a bright packet runs along their strand
        send(new THREE.Vector3(c.x + (Math.random() - 0.5) * 20, c.y + 36, c.z + (Math.random() - 0.5) * 10), c, 1.2, 0, 1);
        const from = cu.from ? bySlot.current.get(cu.from) : undefined;
        if (from !== undefined) send(ctr(from), c, 1.6, c.distanceTo(ctr(from)) * 0.25, 1);
        boxes.current = [...boxes.current.filter((b) => b.until > now && b.slot !== i), { until: now + 5200, slot: i, text: cu.text ?? "" }].slice(-3);
      } else if (cu.kind === "trade" && c) {
        slots.current[i]!.flare = Math.min(1, slots.current[i]!.flare + 0.04 + Math.min(0.2, cu.v * 0.06));
        // a buy flows in from outside the cloud, a sell flows out of it; brightness follows the SOL
        const dir = tmp2.set(Math.random() - 0.5, Math.random() * 0.6 - 0.1, Math.random() - 0.5).normalize();
        const rim = c.clone().addScaledVector(dir, r * (2.2 + Math.random()));
        if (cu.side === "sell") send(c, rim, 0.9, 0.5, Math.min(1, cu.v * 2) * 0.4);
        else send(rim, c, 0.9, 0.5, Math.min(1, cu.v * 2) * 0.6);
      } else if (cu.kind === "watch" && c) slots.current[i]!.flare = Math.max(slots.current[i]!.flare, 0.6);
      else if (cu.kind === "jev") {
        const j = lastCalled >= 0 ? lastCalled : [...bySlot.current.values()].at(-1);
        if (j !== undefined) slots.current[j]!.shimmer = 1;
      } else if (cu.kind === "fill" && c) send(cu.side === "sell" ? c : CORE_AT, cu.side === "sell" ? CORE_AT : c, 1.4, CORE_AT.distanceTo(c) * 0.25 + 2, 1);
      else if (cu.kind === "close" && c) send(c, CORE_AT, 1.4, CORE_AT.distanceTo(c) * 0.25 + 2, 0.8);
      else if (cu.kind === "post" && c) send(CORE_AT, c, 1.1, CORE_AT.distanceTo(c) * 0.25 + 2, 1);
      else if (cu.kind === "commit") slots.current[CORE]!.flare = Math.min(1, slots.current[CORE]!.flare + 0.35);
    }

    // temperature: the average strategy's paper loss against its own floor (each strategy trades its own book)
    const floorSol = (snap?.floor_frac ?? 0.25) * (snap?.mandate_sol ?? 0.2);
    const avgNet = (snap?.pool.net ?? 0) / Math.max(1, snap?.pool.born ?? 1);
    const target = avgNet >= 0 ? 0 : Math.min(1, -avgNet / Math.max(1e-9, floorSol));
    temp.current += (target - temp.current) * Math.min(1, dt * 2.2);
    cloud.u.uTemp.value = temp.current;

    // per-slot state
    const heldNow = new Set((snap?.positions ?? []).map((p) => p.mint));
    for (let i = 0; i < MAX_CLUSTERS; i++) {
      const s = slots.current[i]!;
      s.flare = Math.max(0, s.flare - dt * 0.8);
      s.shimmer = Math.max(0, s.shimmer - dt * 4.5);
      const st = cloud.u.uState.value[i]!;
      if (i === CORE) {
        st.set(s.flare, 0, 2, 1);
        continue;
      }
      if (!s.mint) {
        st.set(0, 0, 0, 0);
        continue;
      }
      const c = cloud.u.uCenter.value[i]!;
      c.w += (s.size - c.w) * Math.min(1, dt * 1.2);
      const idle = Math.min(1, (now - s.seenAt) / 900_000);
      st.set(s.flare, s.shimmer, heldNow.has(s.mint) ? 1 : 0, 0.45 + 0.55 * (1 - idle * 0.7));
    }

    // packets: a head and a fading trail along the arc
    const pp = pk.g.attributes.position as THREE.BufferAttribute;
    const pa = pk.g.attributes.aAlpha as THREE.BufferAttribute;
    const ph = pk.g.attributes.aHot as THREE.BufferAttribute;
    for (let k = 0; k < PACKETS; k++) {
      const p = packets.current[k]!;
      if (p.alive) {
        p.t += dt / p.dur;
        if (p.t >= 1) p.alive = false;
      }
      for (let s = 0; s < TRAIL; s++) {
        const vi = k * TRAIL + s;
        if (!p.alive) {
          pa.setX(vi, 0);
          continue;
        }
        const u = Math.max(0, 1 - (1 - Math.min(1, p.t)) ** 2 - s * 0.035);
        arc(p.a, p.b, p.lift, u, tmp);
        pp.setXYZ(vi, tmp.x, tmp.y, tmp.z);
        pa.setX(vi, (1 - s / TRAIL) * (0.35 + p.hot * 0.65) * (p.t > 0.85 ? (1 - p.t) / 0.15 : 1));
        ph.setX(vi, s === 0 ? p.hot : 0);
      }
    }
    pp.needsUpdate = true;
    pa.needsUpdate = true;
    ph.needsUpdate = true;

    // the field turns very slowly while you watch (not under reduced motion); a drag turns it further
    if (group.current && !reduced) group.current.rotation.y = Math.sin(t * 0.021) * 0.22;

    // ---------- DOM overlay: labels, callout boxes with leader lines, region captions ----------
    const o = overlay.current;
    const proj = (v: THREE.Vector3) => {
      if (group.current) v.applyMatrix4(group.current.matrixWorld);
      v.project(camera);
      return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height, on: v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 };
    };
    // the busiest coins get labels, never two within 90 px of each other
    const ranked = [...bySlot.current.entries()].sort((a, b) => (coins.get(b[0])?.callout_count ?? 0) - (coins.get(a[0])?.callout_count ?? 0));
    const placed: { x: number; y: number }[] = [];
    let r = 0;
    o.labels.forEach((el) => {
      if (!el) return;
      let pair: [string, number] | undefined;
      let q = { x: 0, y: 0, on: false };
      while (r < ranked.length) {
        const cand = ranked[r++]!;
        const c = cloud.u.uCenter.value[cand[1]]!;
        const qq = proj(tmp.set(c.x, c.y + c.w * 0.9, c.z));
        if (qq.on && placed.every((p) => Math.hypot(p.x - qq.x, p.y - qq.y) > 90)) {
          pair = cand;
          q = qq;
          placed.push(qq);
          break;
        }
      }
      if (!pair) {
        el.style.opacity = "0";
        return;
      }
      const [mint] = pair;
      el.style.opacity = "1";
      el.style.transform = `translate(${q.x}px, ${q.y}px)`;
      const coin = coins.get(mint);
      const text = `$${coin?.sym ?? mint.slice(0, 4)} · ${coin?.callout_count ?? 0}`;
      if (el.textContent !== text) el.textContent = text;
    });
    const live = boxes.current.filter((b) => b.until > now);
    o.boxes.forEach((bx, n) => {
      const b = live[n];
      if (!bx.el || !bx.line) return;
      if (!b) {
        bx.el.style.opacity = "0";
        bx.line.style.opacity = "0";
        return;
      }
      const c = cloud.u.uCenter.value[b.slot]!;
      const q = proj(tmp.set(c.x, c.y, c.z));
      // boxes stack in rows under the HUD; each leader line drops to its cloud
      const x2 = Math.max(size.width * 0.36, Math.min(size.width - 300, q.x + 40));
      const y2 = (mobileView ? 170 : 104) + n * 50;
      const fade = Math.min(1, (b.until - now) / 600);
      bx.el.style.opacity = String(fade);
      bx.el.style.transform = `translate(${x2}px, ${y2}px)`;
      if (bx.el.dataset.text !== b.text) {
        bx.el.dataset.text = b.text;
        bx.el.textContent = b.text;
      }
      bx.line.setAttribute("x1", String(q.x));
      bx.line.setAttribute("y1", String(q.y));
      bx.line.setAttribute("x2", String(x2));
      bx.line.setAttribute("y2", String(y2 + 14));
      bx.line.style.opacity = String(fade);
    });
    REGION.forEach((R, n) => {
      const el = o.regions[n];
      if (!el) return;
      const q = proj(tmp.set(R.c.x - R.rx * 0.6, R.c.y - 8, R.c.z + R.rz));
      el.style.opacity = q.on ? "1" : "0";
      el.style.transform = `translate(${Math.min(q.x, size.width - el.offsetWidth - 24)}px, ${q.y}px)`; // never off the right edge
    });
  });

  return (
    <group ref={group}>
      <points geometry={dust.g} material={dust.m} frustumCulled={false} />
      <lineSegments geometry={net.g} material={net.m} frustumCulled={false} />
      <points geometry={cloud.g} material={cloud.halo} frustumCulled={false} />
      <points geometry={cloud.g} material={cloud.m} frustumCulled={false} />
      <points geometry={pk.g} material={pk.m} frustumCulled={false} />
    </group>
  );
}

/** Drag to turn the field further. */
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
      target.current.x = Math.max(-0.3, Math.min(0.3, target.current.x + (e.clientY - down.y) * 0.002));
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

export default function FieldScene({ overlay, mobile }: { overlay: React.MutableRefObject<Overlay>; mobile: boolean }) {
  return (
    <Canvas
      dpr={[1, mobile ? 1.5 : 2]}
      camera={{ position: mobile ? [4, 30, 82] : [-8, 24, 58], fov: mobile ? 56 : 46, near: 0.1, far: 500 }}
      gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ camera }) => camera.lookAt(mobile ? 6 : -9, 3, 0)} // the field sits right, the statement left
      aria-hidden="true"
    >
      <DragRig>
        <Field points={mobile ? 60_000 : 240_000} overlay={overlay} />
      </DragRig>
    </Canvas>
  );
}
