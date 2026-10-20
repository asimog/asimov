// Contracts: the one source of truth for events, signals and IDs (docs/generated/topics.md).
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
  "signer", "scorekeeper", "attention", "strategies", "riskgate.paper", "riskgate.live", "system", "analyzer", "bettafish", "miroshark", "agents", "soul", "slow-bridge", "wiki",
] as const;
export type Source = (typeof SOURCES)[number];

const iso = z.string().datetime({ offset: true });
const num = z.number().finite();

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

export const CalloutReply = z.object({
  callout_id: z.string(), mint: z.string(), reply_id: z.string(), parent_id: z.string().nullable(), wallet: z.string().nullable(),
  handle: z.string().nullable(), text: z.string(), likes: z.number(), media_url: z.string().nullable(), created_at: iso,
});
/** A callout whose text matches an earlier callout's (E7a): found by the Librarian's embeddings, checked and written by core. */
export const CalloutCopy = z.object({ callout_id: z.string(), copy_of: z.string(), mint: z.string().nullable(), similarity: z.number().min(0).max(1), model: z.string() });
export const MediaCached = z.object({
  media_id: z.string(), kind: z.enum(["callout", "coin"]), mint: z.string(), callout_id: z.string().nullable(), url: z.string(),
  sha256: z.string(), bytes: z.number().int(), mime: z.string(),
});
export const CalloutUpdated = z.object({
  callout_id: z.string(),
  mint: z.string(),
  update_id: z.string(),
  text: z.string(),
  created_at: iso,
});

/** An item the door refused, sampled by a hash so a second run samples the same ones. Callout or launch. */
export const FilterSampled = z.object({
  reason: z.enum([
    "unknown_chain", "chain", "min_position", "min_mcap", "max_mcap",
    "blocked_creator", "blocked_mint", "blocked_wallet",
    "dev_buy", "block0_snipers", "bundle", "unknown_dev_buy", "unknown_block0_snipers", "unknown_bundle", "unknown_creator",
  ]),
  source: z.string(),
  chain: z.string().nullable(),
  callout: z.object({
    callout_id: z.string(),
    mint: z.string(),
    position_usd: num.nullable(),
    mcap_usd: num.nullable(),
  }).nullable().default(null),
  launch: z.object({
    mint: z.string(),
    watch_reason: z.string(),
    wallet: z.string().nullable(),
    facts: z.record(z.string(), z.unknown()),
  }).nullable().default(null),
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
  /** the AMM pool's SOL reserve after the trade (NATS `quoteReserves` on a `pump_amm` trade); null on the curve or when unknown */
  pool_sol: num.nullable(),
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

/** One closed Tape partition was exported, read back and verified, then dropped (docs/tasks/B6-archiver.md). */
export const TapeArchived = z.object({
  partition: z.string(),
  file: z.string(),
  rows: z.number().int(),
  sha256: z.string(),
  target: z.string(),
  from: iso,
  to: iso,
  at: iso,
});

/** NATS and the RPC pool disagree about a launch fact (docs/PIPELINE.md). RPC wins; the coin is re-checked. */
export const SourceDisagree = z.object({
  mint: z.string(),
  fact: z.string(),
  nats: z.unknown(),
  rpc: z.unknown(),
  at: iso,
});

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

/** Why a coin is in play (docs/STRATEGY.md section 3), recorded on every decision so results split by it. */
export const IN_PLAY = ["callout", "precall", "smart_buy", "scout"] as const;
export type InPlay = (typeof IN_PLAY)[number];
export const IntentCreated = z.object({
  strategy_id: z.string(),
  mint: z.string(),
  side: z.enum(["buy", "sell"]),
  size_sol: num.nullable(),
  fraction: num.nullable(),
  reason: z.array(z.string()),
  /** the in-play reason of the entry; a sell carries its position's */
  in_play: z.enum(IN_PLAY).nullable(),
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
  /** what a buy at this fill pays to get out again (exit fee, priority fees both ways), in bps; the fee-adjusted markout is h - cost_bps. 0 for a sell */
  cost_bps: num,
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

/** A family's calibration map (docs/STRATEGY.md section 4), emitted when it changes. */
export const CalibrationMap = z.object({
  family: z.string(),
  version: z.number().int(),
  decisions: z.number().int(),
  bins: z.array(z.object({ lo: num, hi: num, n: z.number().int(), win: num, mean: num, payoff: num.nullable() })),
});

export const KernelAllocation = z.object({
  round: num,
  hurdle: num,
  shares: z.array(z.object({ strategy_id: z.string(), n: num, mean: num.nullable(), lcb: num.nullable(), sample: num, share: num, stage: z.string() })),
});

/** Callout outcome, methodology ov2 (docs/PIPELINE.md scorekeeper). A correction is a new event with `supersedes`. */
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

/** A sense knows it missed data (docs/PIPELINE.md coverage). `to: null` means still missing. */
export const SystemGap = z.object({
  source: z.enum(["feed", "feed.push", "trades", "rpc"]),
  scope: z.string().nullable(),
  from: iso,
  to: iso.nullable(),
  reason: z.string(),
});

/** Untrusted text refused by the Guard's rules before any model read it (C11). */
export const GuardRefused = z.object({ subject: z.string(), where: z.string(), rules: z.array(z.string()).min(1) });
/** A model budget ran out for this hour; its packs fall back to math signals until the next hour (C11). */
export const BudgetExhausted = z.object({ analyzer: z.string(), hour: iso, used: num, cap: num });
export const BudgetSpent = z.object({ analyzer: z.string(), units: z.string(), amount: num, job_event_id: z.string().nullable() });

/** Launch features the Scout measured before promoting a coin (docs/PIPELINE.md section 3). All seen at promotion time. */
export const CoinFeatures = z.object({
  from_birth: z.boolean(), // seen from its first trade: only then are bundle features measured
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
  /** SOL the creator bought first in the launch window; null when the coin did not join at birth. */
  dev_buy_sol: num.nullable(),
  /** share of SOL bought in the first slot by wallets other than the creator; null when not seen from birth. */
  block0_sniper_share: num.nullable(),
  sniper_share: num,
  top_buyer_share: num,
  creator_sold: num,
  smart_buyers: num,
});

/** The Scout promotes a coin into the watched set (docs/PIPELINE.md, docs/PIPELINE.md). */
export const CoinWatched = z.object({
  mint: z.string(),
  reason: z.enum(["caller_buy", "smart_buy", "follow", "heat", "metrics"]),
  wallet: z.string().nullable(),
  /** set when a followed wallet is also marked sniper, bundler or dev by the Index, so the owner can prune the list */
  note: z.string().nullable().default(null),
  buyers_60s: num,
  net_sol_60s: num,
  trigger_tx: z.string().nullable(),
  features: CoinFeatures,
  /** the creator's record at promotion (C9): launches in 7 days, past coins and how many were rugs; null when the creator is unknown */
  creator_record: z.object({ launches_7d: num, past: num, rugs: num, rug_rate: num.nullable() }).nullable(),
});

/** A watched coin left the watched set (docs/PIPELINE.md): the chain recheck disagreed and the launch filter failed. */
export const CoinUnwatched = z.object({ mint: z.string(), reason: z.string(), by: z.enum(["rpc_recheck", "owner"]) });

/** A coin's first AMM trade: it left the bonding curve (docs/PIPELINE.md, Chain Reader). One per coin. */
export const CoinGraduated = z.object({
  mint: z.string(),
  tx: z.string(),
  price_sol: num.nullable(),
  at: iso,
});

/** Largest token accounts of a coin, the bonding curve's own account excluded (docs/PIPELINE.md). */
export const HoldersSnapshot = z.object({
  mint: z.string(),
  supply: num,
  top: z.array(z.object({ account: z.string(), amount: num })),
  excluded: z.array(z.string()),
  top10_share: num,
  features: CoinFeatures.nullish(), // the Index's launch features as of the snapshot, so risk.state moves with it
});

/** A new version of Index scores (docs/PIPELINE.md 2.4). `smart` carries the wallets strategies may follow. */
export const IndexRefreshed = z.object({
  version: num,
  window_days: num,
  wallets: num,
  coins: num,
  smart: z.array(z.object({ wallet: z.string(), copy_net: num, copy_win_lcb: num, n: num, lead_s: num.nullable(), archetype: z.string() })),
});

/** Why the house calls a coin (docs/EXECUTION.md thesis). Committed before the callout is queued. */
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

/** A post for Publisher. `paper: true` is never posted (docs/EXECUTION.md). */
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

/** A known caller bought a coin they have not called (docs/SYSTEM.md pre-call watch). `trade_id` is the buy's event. */
export const PrecallDetected = z.object({
  mint: z.string(),
  caller: z.string(),
  trade_id: z.string(),
  buy_sol: num,
  p: num,
  horizon_min: num,
});

export const ScoreUpdated = z.object({
  kind: z.string(),
  horizon_min: num,
  n: num,
  brier: num,
  base_rate: num,
  skill: num.nullable(),
});

// ---------- slow mind (docs/generated/topics.md: synthesis, swarm, agents, soul) ----------
const Cites = z.array(z.string()).min(1);
export const SynthesisFeed = z.object({
  synthesis_id: z.string(),
  window_min: num,
  preset: z.string(),
  narratives: z.array(z.object({ title: z.string(), summary: z.string(), cites: Cites })),
  coin_stances: z.array(z.object({ mint: z.string(), symbol: z.string().nullable(), stance: z.enum(["bullish", "bearish", "neutral", "avoid"]), why: z.string(), cites: Cites })),
  suspicious: z.array(z.object({ pattern: z.string(), text: z.string(), cites: Cites })),
  claims_total: num,
  claims_dropped: num,
});
/** Computed in core from the callouts cited by the feed's kept bullish and bearish (or avoid) stances (docs/DECISIONS.md, D6). */
export const MoodFeed = z.object({
  synthesis_id: z.string(), mood: num.min(-1).max(1), label: z.enum(["fearful", "calm", "greedy"]), n_callouts: num, n_bullish: num, n_bearish: num, bull_share: num.min(0).max(1),
});
export const SynthesisCoin = z.object({
  synthesis_id: z.string(),
  mint: z.string(),
  stance: z.enum(["bullish", "bearish", "neutral", "avoid"]),
  narrative: z.string(),
  claims: z.array(z.object({ text: z.string(), cites: Cites })),
  claims_total: num,
  claims_dropped: num,
  preset: z.string(),
});
export const ForumLine = z.object({ synthesis_id: z.string(), round: num, agent: z.enum(["insight", "query", "media", "host"]), text: z.string(), cites: z.array(z.string()) });
export const SwarmWaveP = z.object({ swarm_id: z.string(), mint: z.string(), wave_p: num.min(0).max(1), samples: num, preset: z.string(), usd: num, truncated: z.boolean() });
export const SwarmImpact = z.object({ swarm_id: z.string(), mint: z.string(), d_callers: num, d_net_sol: num, samples: num, truncated: z.boolean() });
/** Where a simulated post was made: the Pump.fun world or the Twitter stand-in beside it (docs/SLOW-MIND.md M1). */
export const SwarmPlatform = z.enum(["pumpfun", "twitter"]);
export const SwarmPost = z.object({ swarm_id: z.string(), mint: z.string(), branch: z.enum(["A", "B"]), platform: SwarmPlatform, round: num, agent: z.string(), archetype: z.string(), text: z.string(), simulated: z.literal(true) });
export const ProposalStrategy = z.object({ proposal_id: z.string(), by: z.string(), spec: z.record(z.string(), z.unknown()), why: z.array(z.string()), because: z.array(z.string()) });
export const JevqProposed = z.object({ question_id: z.string(), pack: z.string(), text: z.string(), type: z.enum(["yes_no", "probability"]), by: z.string() });
export const ReportDrafted = z.object({ report_id: z.string(), day: z.string(), text: z.string(), checks: z.array(z.string()) });
export const IntegrityText = z.object({ finding_id: z.string(), text: z.string(), checks: z.array(z.string()) });
export const OpsAlert = z.object({ severity: z.enum(["info", "warn", "page"]), text: z.string(), finding: z.string() });
export const SwarmBeliefs = z.object({
  swarm_id: z.string(), mint: z.string(), topic: z.string(), simulated: z.literal(true),
  branches: z.record(z.string(), z.array(z.array(z.object({ round: z.number().int(), stance: z.record(z.string(), z.number()) })))),
});
/** One version of a wiki page (E3, docs/PIPELINE.md 9): every number written by code; a new version only when the body changes. */
export const WikiPage = z.object({
  slug: z.string(), kind: z.enum(["caller", "coin"]), version: z.number().int().min(1), mint: z.string().nullable(),
  sha256: z.string(), body: z.string(), as_of: iso,
  /** the numbers the body was rendered from: rendering them again gives the same bytes */
  data: z.record(z.string(), z.unknown()),
});
/** The Wiki writer's prose for one page version, labelled AI judgment and passed through the public-text check. */
export const WikiProse = z.object({ slug: z.string(), version: z.number().int().min(1), text: z.string(), checks: z.array(z.string()) });
export const ReportPublished = z.object({
  report_id: z.string(), producer: z.string(), kind: z.enum(["feed", "coin", "swarm"]), subject: z.string(), window_from: iso.nullable(), window_to: iso.nullable(),
  preset: z.string(), sha256: z.string(), summary: z.string(), cites: z.array(z.string()), parent_reports: z.array(z.string()), simulated: z.boolean(), cites_dropped: z.number().int(),
});
/** The escalation gate's choice (docs/SLOW-MIND.md section 3). `control` coins record the choice with no job; room (quota, caps) is the Bridge's. */
export const JevEscalated = z.object({
  subject: z.string(), gate_reasons: z.array(z.string()), job: z.enum(["synthesis_coin", "swarm_run"]).nullable(), voi: z.number(),
  stage: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]), arm: z.enum(["run", "control"]),
});
export const OpsRestartRequested = z.object({ scope: z.string(), reason: z.string() });
export const OpsStopRequested = z.object({ action: z.enum(["pause", "kill"]), scope: z.string(), reason: z.string() });
export const SoulUpdated = z.object({ version: num, sha256: z.string(), prev_sha256: z.string().nullable(), chain_sha256: z.string(), reason: z.string(), by: z.string(), diff_ref: z.string().nullable() });
export const JobEvent = z.object({ job_id: z.string(), agent: z.string(), trigger_event: z.string().nullable(), cost_usd: num.optional(), result_ref: z.string().optional(), error: z.string().optional() });


// ---------- hands, books, kill (docs/EXECUTION.md, 10, 15) ----------
export const OrderCreated = z.object({
  order_id: z.string(),
  intent_id: z.string(),
  strategy_id: z.string(),
  mint: z.string(),
  side: z.enum(["buy", "sell"]),
  size_sol: num.nullable(),
  fraction: num.min(0).max(1).nullable(),
  max_slippage_bps: num.min(0).max(2000),
  limits_version: num,
});
export const OrderSubmitted = z.object({ order_id: z.string(), tx_sig: z.string(), route: z.enum(["curve", "amm"]), submitted_at: iso });
export const OrderFilled = z.object({
  order_id: z.string(),
  intent_id: z.string(),
  strategy_id: z.string(),
  mint: z.string(),
  side: z.enum(["buy", "sell"]),
  tx_sig: z.string(),
  tokens: num,
  sol: num,
  fee_sol: num,
  price_sol: num,
  slot: num,
  rent_sol: num,
});
export const SignerRefused = z.object({ job: z.string(), reason: z.string() });
export const OrderFailed = z.object({ order_id: z.string(), tx_sig: z.string().nullable(), error: z.string(), retryable: z.boolean() });
export const PositionChanged = z.object({
  order_id: z.string(),
  strategy_id: z.string(),
  mint: z.string(),
  tokens: num,
  closed: z.boolean(),
  account_closed: z.boolean(),
  rent_back_sol: num,
});
export const LedgerEntry = z.object({
  entry_id: z.string(),
  kind: z.enum(["deposit", "close_account", "sweep_collect", "sweep_split", "memo", "fee"]),
  tx_sig: z.string().nullable(),
  legs: z.array(z.object({ account: z.string(), lamports: z.number().int() })),
});
export const FeesSwept = z.object({
  sweep_id: z.string(),
  collect_sig: z.string().nullable(),
  split_sig: z.string().nullable(),
  collected_lamports: z.number().int(),
  to_trade_lamports: z.number().int(),
  to_agent_lamports: z.number().int(),
  to_operator_lamports: z.number().int(),
});
export const BooksReconciled = z.object({
  hour: z.string(),
  ok: z.boolean(),
  degraded: z.boolean().optional(),
  wallets: z.array(z.object({ wallet: z.string(), ledger_lamports: z.number().int(), chain_lamports: z.number().int() })),
});
export const KILL_CAUSES = ["owner", "daily_loss", "signer_refusals", "fill_drift", "feed_gap", "books", "ops_stop"] as const;
/** running: buys and sells; exit_only: sells only; halted: nothing signs (docs/SYSTEM.md 5.4) */
export const KILL_STATES = ["running", "exit_only", "halted"] as const;
export type KillState = (typeof KILL_STATES)[number];
export const KillChanged = z.object({ state: z.enum(KILL_STATES), reason: z.string(), by: z.enum([...KILL_CAUSES, "admin"]) });
/** Owner lists (docs/SYSTEM.md section 6), loaded with `ctl lists load`; the Risk Gate reads the blocked and own ones. */
export const LIST_KINDS = ["smart_wallets", "caller_wallets", "follow_wallets", "blocked_creators", "blocked_wallets", "blocked_mints", "own_mints", "own_wallets"] as const;
export type ListKind = (typeof LIST_KINDS)[number];
export const LimitsChanged = z.object({ version: z.number().int(), key: z.string(), value: z.unknown(), by: z.literal("admin") });
export const ListsLoaded = z.object({ kind: z.enum(LIST_KINDS), version: z.number().int(), count: z.number().int(), sha256: z.string(), by: z.literal("admin") });
/** Pipeline config files (docs/OPS.md section 1); each boot writes one `config.loaded` per file, and replays read it from the Tape. */
export const CONFIG_FILES = ["feeds", "filters", "limits.default", "models", "retention", "schedules"] as const;
export type ConfigFile = (typeof CONFIG_FILES)[number];
export const ConfigLoaded = z.object({ file: z.enum(CONFIG_FILES), sha256: z.string(), value: z.unknown() });
export const ProofPublished = z.object({ n: z.number().int(), hour: z.string(), sha256: z.string(), prev_sha256: z.string(), memo_sig: z.string().nullable() });

export const TOPICS = {
  "observation.raw": ObservationRaw,
  "coin.seen": CoinSeen,
  "callout.created": CalloutCreated,
  "callout.updated": CalloutUpdated,
  "callout.reply": CalloutReply,
  "callout.copy": CalloutCopy,
  "media.cached": MediaCached,
  "callout.counts": CalloutCounts,
  "filter.sampled": FilterSampled,
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
  "order.created": OrderCreated,
  "order.submitted": OrderSubmitted,
  "order.filled": OrderFilled,
  "order.failed": OrderFailed,
  "signer.refused": SignerRefused,
  "position.changed": PositionChanged,
  "ledger.entry": LedgerEntry,
  "fees.swept": FeesSwept,
  "books.reconciled": BooksReconciled,
  "kill.changed": KillChanged,
  "limits.changed": LimitsChanged,
  "lists.loaded": ListsLoaded,
  "config.loaded": ConfigLoaded,
  "proof.published": ProofPublished,
  "markout.measured": MarkoutMeasured,
  "commit.made": CommitMade,
  "commit.revealed": CommitRevealed,
  "position.closed": PositionClosed,
  "strategy.born": StrategyBorn,
  "strategy.retired": StrategyRetired,
  "kernel.allocation": KernelAllocation,
  "calibration.map": CalibrationMap,
  "outcome.measured": OutcomeMeasured,
  "score.updated": ScoreUpdated,
  "precall.detected": PrecallDetected,
  "coin.watched": CoinWatched,
  "coin.unwatched": CoinUnwatched,
  "coin.graduated": CoinGraduated,
  "holders.snapshot": HoldersSnapshot,
  "index.refreshed": IndexRefreshed,
  "budget.spent": BudgetSpent,
  "guard.refused": GuardRefused,
  "budget.exhausted": BudgetExhausted,
  "thesis.formed": ThesisFormed,
  "post.queued": PostQueued,
  "synthesis.feed": SynthesisFeed,
  "mood.feed": MoodFeed,
  "synthesis.coin": SynthesisCoin,
  "synthesis.forum_line": ForumLine,
  "swarm.wave_p": SwarmWaveP,
  "swarm.impact": SwarmImpact,
  "swarm.post": SwarmPost,
  "proposal.strategy": ProposalStrategy,
  "jevq.proposed": JevqProposed,
  "report.drafted": ReportDrafted,
  "integrity.text": IntegrityText,
  "ops.alert": OpsAlert,
  "ops.stop_requested": OpsStopRequested,
  "ops.restart_requested": OpsRestartRequested,
  "report.published": ReportPublished,
  "wiki.page": WikiPage,
  "wiki.prose": WikiProse,
  "swarm.beliefs": SwarmBeliefs,
  "jev.escalated": JevEscalated,
  "soul.updated": SoulUpdated,
  "job.queued": JobEvent,
  "job.started": JobEvent,
  "job.done": JobEvent,
  "system.note": SystemNote,
  "system.gap": SystemGap,
  "system.schema_drift": SystemNote,
  "system.source_disagree": SourceDisagree,
  "tape.archived": TapeArchived,
} as const;
export type Topic = keyof typeof TOPICS;
export type BodyOf<T extends Topic> = z.infer<(typeof TOPICS)[T]>;

export const Envelope = z.object({
  id: z.string(),
  topic: z.string(),
  v: z.number().int(),
  event_time: iso,
  seen_time: iso,
  source: z.enum(SOURCES),
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

/** Body versions; bump on any change (docs/generated/topics.md). */
/** Tape partition class (docs/tasks/B6-partitions.md). Hot inputs are pruned first; kept inputs are small; derived is rebuilt. */
export type TapeClass = "inputs_hot" | "inputs_kept" | "derived";
export const TAPE_CLASSES: TapeClass[] = ["inputs_hot", "inputs_kept", "derived"];
export const TOPIC_CLASS: Record<Topic, TapeClass> = {
  "observation.raw": "inputs_hot", "coin.seen": "inputs_hot", "callout.created": "inputs_hot", "callout.updated": "inputs_hot",
  "callout.reply": "inputs_hot", "media.cached": "inputs_hot", "callout.counts": "inputs_hot", "caller.position": "inputs_hot",
  "trade.curve": "inputs_hot", "trade.amm": "inputs_hot", "session.task": "inputs_hot", "session.read": "inputs_hot", "session.health": "inputs_hot",
  "filter.sampled": "inputs_kept", "coin.watched": "inputs_kept", "coin.unwatched": "inputs_kept", "coin.graduated": "inputs_kept",
  "config.loaded": "inputs_kept", "lists.loaded": "inputs_kept", "limits.changed": "inputs_kept", "kill.changed": "inputs_kept",
  "system.note": "inputs_kept", "system.gap": "inputs_kept", "system.schema_drift": "inputs_kept", "system.source_disagree": "inputs_kept",
  "ops.stop_requested": "inputs_kept", "ops.restart_requested": "inputs_kept", "tape.archived": "inputs_kept",
  "jev.answer": "derived", "intent.created": "derived", "intent.ghost_filled": "derived", "order.rejected": "derived",
  "order.created": "derived", "order.submitted": "derived", "order.filled": "derived", "order.failed": "derived",
  "signer.refused": "derived", "position.changed": "derived", "ledger.entry": "derived", "fees.swept": "derived",
  "books.reconciled": "derived", "proof.published": "derived", "markout.measured": "derived", "calibration.map": "derived", "commit.made": "derived",
  "commit.revealed": "derived", "position.closed": "derived", "strategy.born": "derived", "strategy.retired": "derived",
  "kernel.allocation": "derived", "outcome.measured": "derived", "score.updated": "derived", "precall.detected": "derived",
  "holders.snapshot": "derived", "index.refreshed": "derived", "budget.spent": "derived", "guard.refused": "derived", "budget.exhausted": "derived", "thesis.formed": "derived",
  "post.queued": "derived", "synthesis.feed": "derived", "mood.feed": "derived", "synthesis.coin": "derived",
  "synthesis.forum_line": "derived", "swarm.wave_p": "derived", "swarm.impact": "derived", "swarm.post": "derived",
  "proposal.strategy": "derived", "jevq.proposed": "derived", "report.drafted": "derived", "integrity.text": "derived",
  "ops.alert": "derived", "report.published": "derived", "wiki.page": "derived", "wiki.prose": "derived", "callout.copy": "derived", "swarm.beliefs": "derived",
  "jev.escalated": "derived", "soul.updated": "derived", "job.queued": "derived", "job.started": "derived", "job.done": "derived",
};

export const SCHEMA_VERSION: Record<Topic, number> = {
  ...(Object.fromEntries(Object.keys(TOPICS).map((t) => [t, 1])) as Record<Topic, number>),
  "outcome.measured": 2,
  "system.gap": 2,
  "coin.watched": 4,
  "tape.archived": 1,
};

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
