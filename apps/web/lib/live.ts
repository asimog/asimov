"use client";
// Live data: one snapshot from the relay, then the SSE stream. Scenes read cues from a plain queue inside their
// frame loop (no React render per event); panels read the zustand store.
import { useEffect, useState } from "react";
import { create } from "zustand";

export const RELAY = process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:7401";

export type Line = { id: string; t: number; topic: string; mint: string | null; text: string; v?: number; side?: string; family?: string; who?: string };
export type Coin = { mint: string; sym: string; callout_count: number; mcap: number | null; progress: number | null; wave_p: number | null; last_trade_at: string | null; first_callout_at: string | null };
export type Position = { id: string; strategy_id: string; mint: string; cost_sol: number; entry_price: number; opened_at: string; family: string; left_frac: number };
export type Snapshot = {
  now: number;
  mode: string;
  mandate_sol: number;
  floor_frac: number;
  milestone: string;
  counsel_queue: number;
  coins: Coin[];
  positions: Position[];
  pool: { alive: number; born: number; closed: number; net: number; open: number; commits: number; reveals: number };
  equity: [number, number][];
  rates: { callouts: number; jev: number; trades: number; intents: number; refused: number };
  markouts: { h60: number; side: string }[];
  families: { family: string; alive: number; trades: number; net: number }[];
  scores: { kind: string; horizon_min: number; n: number; brier: number; base: number }[];
  tape: Line[];
  viewers: number;
  edges: { a: string; b: string; n: number }[];
  graduated: string[];
};

/** A cue is one real event the scene may show. Scenes drain this queue each frame. */
export type Cue = { seq: number; kind: "callout" | "trade" | "jev" | "fill" | "close" | "refused" | "commit" | "watch" | "post"; mint: string | null; v: number; side?: string; t: number; from?: string; text?: string };
export const cues: Cue[] = [];
let seq = 0;
const cue = (c: Omit<Cue, "seq">) => void cues.push({ ...c, seq: ++seq });

/** The firm's lanes (docs/18), lit on the Cortex while they write events. */
export const LANES = ["sense", "analyze", "reflex", "decide", "risk", "execute", "publish", "memory", "treasury", "counsel"] as const;
export type Lane = (typeof LANES)[number];
const LANE_OF: Record<string, Lane> = {
  "callout.created": "sense", "trade.curve": "sense", "trade.amm": "sense", "coin.watched": "sense", "holders.snapshot": "sense",
  "score.updated": "analyze", "index.refreshed": "analyze", "markout.measured": "analyze",
  "jev.answer": "reflex",
  "intent.created": "decide", "strategy.born": "decide", "strategy.retired": "decide", "kernel.allocation": "decide",
  "order.rejected": "risk",
  "intent.ghost_filled": "execute", "position.closed": "execute",
  "post.queued": "publish", "thesis.formed": "publish",
  "commit.made": "memory", "commit.revealed": "memory",
};

type State = {
  snap: Snapshot | null;
  lines: Line[];
  coins: Map<string, Coin>;
  lastEventAt: number;
  connected: boolean;
  error: string | null;
  price: Map<string, number>;
  lanes: Record<Lane, { at: number; n: number; text: string }>;
};

const emptyLanes = () => Object.fromEntries(LANES.map((l) => [l, { at: 0, n: 0, text: "" }])) as State["lanes"];
export const useLive = create<State>(() => ({ snap: null, lines: [], coins: new Map(), lastEventAt: 0, connected: false, error: null, price: new Map(), lanes: emptyLanes() }));

const QUIET = new Set(["trade.curve", "trade.amm"]);
const lastCoinOf = new Map<string, string>(); // caller wallet -> the last coin they called (this session)
/** Caller links learned from the live stream, added to the snapshot's edges. */
export const liveEdges: { a: string; b: string; n: number }[] = [];
export const graduatedLive = new Set<string>();

function ingest(lines: Line[]) {
  const s = useLive.getState();
  const coins = new Map(s.coins);
  for (const l of lines) {
    const mint = l.mint;
    if (l.topic === "callout.created" && mint) {
      const c = coins.get(mint);
      const sym = l.text.match(/\$(\S+)/)?.[1] ?? mint.slice(0, 4);
      coins.set(mint, c ? { ...c, callout_count: c.callout_count + 1 } : { mint, sym, callout_count: 1, mcap: null, progress: null, wave_p: null, last_trade_at: null, first_callout_at: new Date(l.t).toISOString() });
      // the caller moved: if they called another coin recently, the Field links the two (from = that coin)
      const prev = l.who ? lastCoinOf.get(l.who) : undefined;
      if (l.who) lastCoinOf.set(l.who, mint);
      if (prev && prev !== mint) liveEdges.push({ a: prev, b: mint, n: 1 });
      if (liveEdges.length > 200) liveEdges.splice(0, liveEdges.length - 200);
      cue({ kind: "callout", mint, v: l.v ?? 0, t: l.t, from: prev && prev !== mint ? prev : undefined, text: l.text });
    } else if (QUIET.has(l.topic) && mint) {
      if (l.topic === "trade.amm") graduatedLive.add(mint);
      cue({ kind: "trade", mint, v: l.v ?? 0, side: l.side, t: l.t });
    } else if (l.topic === "jev.answer") cue({ kind: "jev", mint: null, v: l.v ?? 0, t: l.t });
    else if (l.topic === "intent.ghost_filled") cue({ kind: "fill", mint, v: l.v ?? 0, side: l.side, t: l.t });
    else if (l.topic === "position.closed") cue({ kind: "close", mint, v: l.v ?? 0, t: l.t });
    else if (l.topic === "order.rejected") cue({ kind: "refused", mint, v: 0, t: l.t });
    else if (l.topic === "commit.made") cue({ kind: "commit", mint, v: 0, t: l.t });
    else if (l.topic === "coin.watched") cue({ kind: "watch", mint, v: 0, t: l.t });
    else if (l.topic === "post.queued") cue({ kind: "post", mint, v: 0, t: l.t });
  }
  const lanes = { ...s.lanes };
  const now = Date.now();
  for (const l of lines) {
    const lane = LANE_OF[l.topic];
    if (lane) lanes[lane] = { at: now, n: lanes[lane].n + 1, text: QUIET.has(l.topic) ? lanes[lane].text || l.text : l.text };
  }
  if (cues.length > 4000) cues.splice(0, cues.length - 4000);
  const shown = lines.filter((l) => !QUIET.has(l.topic));
  useLive.setState({
    lanes,
    coins,
    lines: shown.length ? [...s.lines, ...shown].slice(-120) : s.lines,
    lastEventAt: lines.length ? lines[lines.length - 1]!.t : s.lastEventAt,
  });
}

let started = false;
export function startLive() {
  if (started || typeof window === "undefined") return;
  started = true;
  const loadSnap = async () => {
    try {
      const r = await fetch(`${RELAY}/v1/snapshot`, { cache: "no-store" });
      if (!r.ok) throw new Error(`relay ${r.status}`);
      const snap = (await r.json()) as Snapshot;
      const coins = new Map(useLive.getState().coins);
      for (const c of snap.coins) coins.set(c.mint, { ...coins.get(c.mint), ...c });
      useLive.setState((s) => ({ snap, coins, lines: s.lines.length ? s.lines : snap.tape, lastEventAt: Math.max(s.lastEventAt, snap.now), error: null }));
    } catch (e) {
      useLive.setState({ error: String((e as Error).message ?? e) });
    }
  };
  void loadSnap();
  setInterval(loadSnap, 5000);
  const es = new EventSource(`${RELAY}/v1/stream`);
  es.addEventListener("hello", () => useLive.setState({ connected: true }));
  es.addEventListener("lines", (ev) => ingest(JSON.parse((ev as MessageEvent).data) as Line[]));
  es.onerror = () => useLive.setState({ connected: false });
}

export const fmt = {
  sol: (v: number, d = 4) => `${v >= 0 ? "" : "−"}${Math.abs(v).toFixed(d)}`,
  signed: (v: number, d = 4) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`,
  k: (v: number | null) => (v == null ? "·" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : `${Math.round(v)}`),
  pct: (v: number | null, d = 0) => (v == null ? "·" : `${(v * 100).toFixed(d)}%`),
  ago: (ms: number) => (ms < 1000 ? "now" : ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3_600_000)} h`),
};

/** A room's read-only payload from the relay, refreshed every few seconds. */
export function useRoom<T>(path: string, everyMs = 5000): { data: T | null; error: string | null } {
  const [state, set] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${RELAY}${path}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`relay answered ${r.status}`);
        const data = (await r.json()) as T;
        if (alive) set({ data, error: null });
      } catch (e) {
        if (alive) set((s) => ({ data: s.data, error: (e as Error).message }));
      }
    };
    void load();
    const t = setInterval(load, everyMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [path, everyMs]);
  return state;
}
