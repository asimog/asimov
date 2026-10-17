// Contracts: the one source of truth for events, signals and IDs (docs/04).
// zod schemas here; JSON Schema for Python is emitted from them (see emit.ts).
import { z } from "zod";

export const ID_PREFIXES = {
  observation: "ob",
  event: "ev",
  caller: "cl",
  coin: "cn",
  callout: "co",
  wallet: "wl",
  signal: "sg",
  intent: "in",
  order: "or",
  effect: "ef",
  outcome: "oc",
  score: "sc",
  strategy: "sr",
  position: "ps",
  task: "tn",
  swarm: "sw",
  synthesis: "sy",
  commit: "cm",
  job: "jb",
  thesis: "th",
  house: "hc",
  post: "pq",
} as const;
export type IdKind = keyof typeof ID_PREFIXES;

export const MODES = ["replay", "paper", "live"] as const;
export type Mode = (typeof MODES)[number];

export const SOURCES = [
  "feedreader", "nats", "rpc", "xreader", "reflex", "guard", "trader", "publisher", "treasurer",
  "signer", "scorekeeper", "attention", "strategies", "riskgate", "system", "analyzer",
] as const;

const iso = z.string().datetime({ offset: true });
const num = z.number().finite();
const solAddr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

// ---------- topic bodies ----------
export const CalloutCreated = z.object({
  callout_id: z.string(),
  mint: z.string(),
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  author_wallet: z.string(),
  author_user_id: z.string().nullable(),
  author_handle: z.string().nullable(),
  author_x: z.string().nullable(),
  author_followers: num.nullable(),
  author_total_callouts: num.nullable(),
  text: z.string(),
  media_url: z.string().nullable(),
  mcap_at_call_usd: num.nullable(),
  price_at_call_usd: num.nullable(),
  created_at: iso,
  chain: z.string().nullable(),
  quoted_callout_id: z.string().nullable(),
  author_position: z
    .object({ amount_held: num.nullable(), cost_basis_usd: num.nullable(), pnl_usd: num.nullable() })
    .nullable(),
  via: z.enum(["poll", "push", "history"]), // history: the Index's 30-day backfill; consumers that decide skip it
});
export type CalloutCreated = z.infer<typeof CalloutCreated>;

export const CalloutUpdated = z.object({
  callout_id: z.string(),
  mint: z.string(),
  update_id: z.string(),
  text: z.string(),
  created_at: iso,
});

export const CalloutCounts = z.object({
  callout_id: z.string(),
  mint: z.string(),
  likes: num,
  replies: num,
  comments: num,
  reposts: num,
  quotes: num,
  views: num,
  multiple: num.nullable(),
  max_multiple: num.nullable(),
  mcap_usd: num.nullable(),
});

export const CallerPosition = z.object({
  callout_id: z.string().nullable(),
  mint: z.string(),
  wallet: z.string(),
  is_exited: z.boolean(),
  amount_held: num.nullable(),
  realized_pnl_sol: num.nullable(),
  at: iso,
});

export const Trade = z.object({
  mint: z.string(),
  tx: z.string(),
  slot_index_id: z.string().nullable(),
  ts: iso,
  side: z.enum(["buy", "sell"]),
  wallet: z.string(),
  sol: num,
  usd: num.nullable(),
  tokens: num.nullable(),
  price_sol: num.nullable(),
  price_usd: num.nullable(),
  mcap_usd: num.nullable(),
  on_curve: z.boolean().nullable(),
  program: z.string().nullable(),
});
export type Trade = z.infer<typeof Trade>;

export const CoinSeen = z.object({
  mint: z.string(),
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  mcap_usd: num.nullable(),
  program: z.string().nullable(),
  chain: z.string().nullable(),
});

export const ObservationRaw = z.object({
  kind: z.enum(["http", "ws", "dom", "frame", "tx"]),
  url: z.string(),
  sha256: z.string(),
  bytes: num,
  blob_ref: z.string().nullable(),
  sample: z.string().nullable(),
});

export const SystemNote = z.object({ kind: z.string(), detail: z.unknown() });

export const JevAnswer = z.object({
  pack: z.string(),
  pack_version: z.string(),
  model: z.string(),
  subject: z.string(),
  state_sha256: z.string(),
  answers: z.record(z.string(), z.unknown()),
  latency_ms: num,
  input_tokens: num.nullable(),
});

export const SessionEvent = z.object({
  session: z.string(),
  task_id: z.string().nullable(),
  url: z.string().nullable(),
  state: z.string().nullable(),
  facts: z.record(z.string(), z.unknown()).nullable(),
  boxes: z
    .array(z.object({ ref: z.string(), x: num, y: num, w: num, h: num, label: z.string().nullable() }))
    .nullable(),
});

export const IntentCreated = z.object({
  strategy_id: z.string(),
  mint: z.string(),
  side: z.enum(["buy", "sell"]),
  size_sol: num.nullable(),
  fraction: num.nullable(),
  reason: z.array(z.string()),
  score: num.nullable(),
  board: z.record(z.string(), z.unknown()),
});

export const OrderRejected = z.object({ intent_id: z.string(), reason_code: z.string(), detail: z.string() });

export const GhostFilled = z.object({
  intent_id: z.string(),
  strategy_id: z.string(),
  mint: z.string(),
  side: z.enum(["buy", "sell"]),
  sol: num,
  tokens: num,
  price_sol: num,
  fee_sol: num,
  rent_sol: num,
  slippage_bps: num,
});

export const MarkoutMeasured = z.object({
  fill_id: z.string(),
  mint: z.string(),
  side: z.enum(["buy", "sell"]),
  h1s: num.nullable(),
  h10s: num.nullable(),
  h60s: num.nullable(),
  h5m: num.nullable(),
});

export const CommitMade = z.object({
  commit_id: z.string(),
  kind: z.enum(["hypothesis", "forecast", "decision"]),
  sha256: z.string(),
  reveal_after: iso.nullable(),
});
export const CommitRevealed = z.object({ commit_id: z.string(), content: z.unknown(), matches: z.boolean() });

export const StrategyBorn = z.object({
  strategy_id: z.string(),
  family: z.string(),
  horizon: z.enum(["fast", "medium", "slow"]),
  origin: z.enum(["seed", "mutation", "crossover", "proposal"]),
  parents: z.array(z.string()),
  spec: z.record(z.string(), z.unknown()),
});
export const StrategyRetired = z.object({ strategy_id: z.string(), reason: z.string(), trades: num, lcb: num.nullable() });

export const PositionClosed = z.object({
  position_id: z.string(),
  strategy_id: z.string(),
  mint: z.string(),
  cost_sol: num,
  proceeds_sol: num,
  rent_refund_sol: num,
  net_sol: num,
  held_ms: num,
  exit_reason: z.string(),
});

export const KernelAllocation = z.object({
  round: num,
  hurdle: num,
  shares: z.array(z.object({ strategy_id: z.string(), n: num, mean: num.nullable(), lcb: num.nullable(), sample: num, share: num, stage: z.string() })),
});

/** Callout outcome, methodology ov2 (docs/07 scorekeeper). A correction is a new event with `supersedes`. */
export const OutcomeMeasured = z.object({
  method: z.literal("ov2"),
  callout_id: z.string(),
  mint: z.string(),
  author_wallet: z.string().nullable(),
  horizon_min: num,
  t0: iso,
  call_lag_ms: num.nullable(),
  entry_basis: z.enum(["last_before", "first_after", "none"]),
  price0_sol: num.nullable(),
  price_sol: num.nullable(),
  multiple: num.nullable(),
  peak_multiple: num.nullable(),
  trough_multiple: num.nullable(),
  t_peak_s: num.nullable(),
  net_multiple: num.nullable(),
  ref_sol: num,
  phase: z.enum(["curve", "amm"]).nullable(),
  graduated: z.boolean(),
  trades: num,
  pre_call_trades: num,
  new_callouts: num,
  coverage: z.enum(["ok", "no_entry", "no_trades", "gap"]),
  gaps: z.array(z.string()),
  supersedes: z.string().nullable(),
});

/** A sense knows it missed data (docs/07 coverage). `to: null` means still missing. */
export const SystemGap = z.object({
  source: z.enum(["feed", "feed.push", "trades", "rpc"]),
  scope: z.string().nullable(),
  from: iso,
  to: iso.nullable(),
  reason: z.string(),
});

export const BudgetSpent = z.object({ analyzer: z.string(), units: z.string(), amount: num, job_event_id: z.string().nullable() });

/** Launch features the Scout measured before promoting a coin (docs/23 section 3). All seen at promotion time. */
export const CoinFeatures = z.object({
  from_birth: z.boolean(), // seen from its first trade: only then are bundle features measured
  fresh_known: z.boolean(), // the Index is old enough (INDEX_FRESH_WARMUP_H) to call a wallet new
  age_s: num.nullable(),
  first_slot: num.nullable(),
  creator: z.string().nullable(),
  trades: num,
  buyers: num,
  holders_est: num,
  mcap_usd: num.nullable(),
  bundle_buys: num,
  bundle_wallets: num,
  bundle_share: num,
  fresh_share: num,
  sniper_share: num,
  top_buyer_share: num,
  creator_sold: num,
  smart_buyers: num,
});

/** The Scout promotes a coin into the watched set (docs/06, docs/23). */
export const CoinWatched = z.object({
  mint: z.string(),
  reason: z.enum(["caller_buy", "smart_buy", "heat", "metrics"]),
  wallet: z.string().nullable(),
  buyers_60s: num,
  net_sol_60s: num,
  trigger_tx: z.string().nullable(),
  features: CoinFeatures,
});

/** Largest token accounts of a coin, the bonding curve's own account excluded (docs/23). */
export const HoldersSnapshot = z.object({
  mint: z.string(),
  supply: num,
  top: z.array(z.object({ account: z.string(), amount: num })),
  excluded: z.array(z.string()),
  top10_share: num,
});

/** A new version of Index scores (docs/23 2.4). `smart` carries the wallets strategies may follow. */
export const IndexRefreshed = z.object({
  version: num,
  window_days: num,
  wallets: num,
  coins: num,
  smart: z.array(z.object({ wallet: z.string(), copy_net: num, copy_win_lcb: num, n: num, lead_s: num.nullable(), archetype: z.string() })),
});

/** Why the house calls a coin (docs/09 thesis). Committed before the callout is queued. */
export const ThesisFormed = z.object({
  thesis_id: z.string(),
  mint: z.string(),
  strategy_id: z.string(),
  position_id: z.string(),
  kind: z.enum(["pre_call", "post_call"]),
  claims: z.array(z.object({ class: z.enum(["observed", "computed", "ai_judgment"]), text: z.string() })),
  prediction: z.object({ p: num, horizon_min: num, what: z.string() }),
  plan: z.object({ entry_price_sol: num, size_sol: num, ladder: z.array(z.object({ mult: num, sell: num })), stop: num, max_hold_min: num }),
  invalidation: z.array(z.string()),
  commit_id: z.string(),
});

/** A post for Publisher. `paper: true` is never posted (docs/09). */
export const PostQueued = z.object({
  post_id: z.string(),
  kind: z.enum(["callout", "update", "reply"]),
  mint: z.string(),
  house_id: z.string(),
  thesis_id: z.string().nullable(),
  text: z.string(),
  checks: z.array(z.string()),
  because: z.array(z.string()),
  paper: z.boolean(),
});

export const ScoreUpdated = z.object({
  kind: z.string(),
  horizon_min: num,
  n: num,
  brier: num,
  base_rate: num,
  skill: num.nullable(),
});

export const TOPICS = {
  "observation.raw": ObservationRaw,
  "coin.seen": CoinSeen,
  "callout.created": CalloutCreated,
  "callout.updated": CalloutUpdated,
  "callout.counts": CalloutCounts,
  "caller.position": CallerPosition,
  "trade.curve": Trade,
  "trade.amm": Trade,
  "session.task": SessionEvent,
  "session.read": SessionEvent,
  "session.health": SessionEvent,
  "jev.answer": JevAnswer,
  "intent.created": IntentCreated,
  "intent.ghost_filled": GhostFilled,
  "order.rejected": OrderRejected,
  "markout.measured": MarkoutMeasured,
  "commit.made": CommitMade,
  "commit.revealed": CommitRevealed,
  "position.closed": PositionClosed,
  "strategy.born": StrategyBorn,
  "strategy.retired": StrategyRetired,
  "kernel.allocation": KernelAllocation,
  "outcome.measured": OutcomeMeasured,
  "score.updated": ScoreUpdated,
  "coin.watched": CoinWatched,
  "holders.snapshot": HoldersSnapshot,
  "index.refreshed": IndexRefreshed,
  "budget.spent": BudgetSpent,
  "thesis.formed": ThesisFormed,
  "post.queued": PostQueued,
  "system.note": SystemNote,
  "system.gap": SystemGap,
  "system.schema_drift": SystemNote,
} as const;
export type Topic = keyof typeof TOPICS;
export type BodyOf<T extends Topic> = z.infer<(typeof TOPICS)[T]>;

export const Envelope = z.object({
  id: z.string(),
  topic: z.string(),
  v: z.number().int(),
  event_time: iso,
  seen_time: iso,
  source: z.string(),
  subject: z.string().nullable(),
  causes: z.array(z.string()),
  mode: z.enum(MODES),
  body: z.unknown(),
});
export type Envelope<B = unknown> = Omit<z.infer<typeof Envelope>, "body"> & { body: B };

export const Signal = z.object({
  id: z.string(),
  kind: z.string(),
  subject: z.string(),
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  produced_at: iso,
  valid_until: iso,
  inputs: z.array(z.string()),
  analyzer: z.string(),
});
export type Signal = z.infer<typeof Signal>;

/** Body versions; bump on any change (docs/04). */
export const SCHEMA_VERSION: Record<Topic, number> = {
  ...(Object.fromEntries(Object.keys(TOPICS).map((t) => [t, 1])) as Record<Topic, number>),
  "outcome.measured": 2,
  "system.gap": 2,
  "coin.watched": 2,
};

export function validateBody<T extends Topic>(topic: T, body: unknown): BodyOf<T> {
  return TOPICS[topic].parse(body) as BodyOf<T>;
}

export { solAddr };

/** Canonical JSON (sorted keys, recursively): the only form commit hashes are computed over. */
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (x && typeof x === "object")
    return `{${Object.keys(x)
      .filter((k) => (x as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(x);
}
