// The Clock: the only source of time and randomness (AGENTS.md: never Date.now() in analyzers, mind or hands).
import { monotonicFactory } from "ulid";
import { ID_PREFIXES, type IdKind, type Mode } from "@asimog/contracts";

export interface Clock {
  readonly mode: Mode;
  now(): number; // epoch ms
  iso(): string;
  rand(): number; // [0,1)
  id(kind: IdKind): string;
  /** replay only: move virtual time forward (never backward) */
  advance?(toMs: number): void;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeIds(now: () => number, rand: () => number) {
  const ulid = monotonicFactory(rand);
  return (kind: IdKind) => `${ID_PREFIXES[kind]}_${ulid(now())}`;
}

export function liveClock(mode: Exclude<Mode, "replay">, seed = Date.now()): Clock {
  const rand = mulberry32(seed);
  const now = () => Date.now();
  const id = makeIds(now, rand);
  return { mode, now, iso: () => new Date(now()).toISOString(), rand, id };
}

export function replayClock(startMs: number, seed = 42): Clock {
  let t = startMs;
  const rand = mulberry32(seed);
  const now = () => t;
  const id = makeIds(now, rand);
  return {
    mode: "replay",
    now,
    iso: () => new Date(t).toISOString(),
    rand,
    id,
    advance(toMs: number) {
      if (toMs > t) t = toMs;
    },
  };
}

/** An outside timestamp as ISO, or null when it is not a real time: one bad field skips its item, never the frame. */
export function isoOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
