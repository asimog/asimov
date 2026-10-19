// The Clock: the only source of time and randomness (AGENTS.md: never Date.now() in analyzers, mind or hands).

import { ID_PREFIXES, type IdKind, type Mode } from "@asimog/contracts";
import { monotonicFactory } from "ulid";

export interface Clock {
  readonly mode: Mode;
  now(): number; // epoch ms
  iso(): string;
  rand(): number; // [0,1)
  id(kind: IdKind): string;
  /** replay only: move virtual time forward (never backward) */
  advance?(toMs: number): void;
  /** Same time, its own random and id stream: each consumer draws only from its own, so their order changes nothing. */
  fork(name: string): Clock;
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

/** A seed for the stream called `name`: FNV-1a over the name, mixed into the parent seed. */
function streamSeed(seed: number, name: string) {
  let h = 0x811c9dc5;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (seed ^ h) >>> 0;
}

function clockOn(mode: Mode, now: () => number, seed: number, advance?: (toMs: number) => void): Clock {
  const rand = mulberry32(seed);
  const forks = new Map<string, Clock>(); // a rebuilt consumer continues its stream, as an uninterrupted one would
  const fork = (name: string) => forks.get(name) ?? forks.set(name, clockOn(mode, now, streamSeed(seed, name), advance)).get(name)!;
  return { mode, now, iso: () => new Date(now()).toISOString(), rand, id: makeIds(now, rand), advance, fork };
}

export function liveClock(mode: Exclude<Mode, "replay">, seed = Date.now()): Clock {
  return clockOn(mode, () => Date.now(), seed);
}

export function replayClock(startMs: number, seed = 42): Clock {
  let t = startMs;
  return clockOn("replay", () => t, seed, (toMs) => {
    if (toMs > t) t = toMs;
  });
}

/** An outside timestamp as ISO, or null when it is not a real time: one bad field skips its item, never the frame. */
export function isoOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
