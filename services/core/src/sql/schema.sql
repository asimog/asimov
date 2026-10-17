-- Asimog schema (docs/05). Idempotent: safe to run at every boot.
-- tape.* is append-only. Everything in mem/board/mind is a projection rebuildable from the tape.

create schema if not exists tape;
create schema if not exists mem;
create schema if not exists board;
create schema if not exists mind;
create schema if not exists ops;

create table if not exists tape.events (
  id          text not null,
  topic       text not null,
  v           int  not null,
  event_time  timestamptz not null,
  seen_time   timestamptz not null,
  source      text not null,
  subject     text,
  causes      text[] not null default '{}',
  mode        text not null,
  body        jsonb not null,
  primary key (seen_time, id)
) partition by range (seen_time);
create table if not exists tape.events_default partition of tape.events default;
create index if not exists events_topic_seen on tape.events (topic, seen_time);
create index if not exists events_subject_seen on tape.events (subject, seen_time);
create index if not exists events_id on tape.events (id);
create index if not exists events_causes on tape.events using gin (causes);

-- dedupe keys for idempotent senses (e.g. callout:<id>, trade:<tx>:<i>)
create table if not exists tape.dedupe (
  key text primary key,
  event_id text not null,
  at timestamptz not null default now()
);

create table if not exists tape.consumer_offsets (
  consumer        text primary key,
  last_seen_time  timestamptz not null default 'epoch',
  last_id         text not null default '',
  updated_at      timestamptz not null default now()
);

create table if not exists tape.blobs (
  sha256 text primary key,
  bytes  int not null,
  kind   text not null,
  url    text,
  body   bytea not null,
  at     timestamptz not null default now()
);

-- ---------- memory ----------
create table if not exists mem.coins (
  mint text primary key,
  symbol text, name text, image text, program text, chain text,
  first_seen timestamptz not null,
  last_mcap_usd double precision,
  last_price_usd double precision,
  last_trade_at timestamptz,
  callout_count int not null default 0,
  first_callout_at timestamptz,
  first_callout_mcap double precision
);

create table if not exists mem.callers (
  wallet text primary key,
  user_id text, handle text, x_handle text,
  followers double precision,
  total_callouts double precision,
  first_seen timestamptz not null,
  calls_seen int not null default 0,
  last_call_at timestamptz
);

create table if not exists mem.callouts (
  callout_id text primary key,
  mint text not null,
  wallet text not null,
  text text not null,
  media_url text,
  mcap_at_call double precision,
  price_at_call double precision,
  created_at timestamptz not null,
  seen_at timestamptz not null,
  first_on_coin boolean not null,
  opportunity_age_min double precision,
  pre_move_pct double precision,
  quoted_callout_id text,
  likes double precision default 0, replies double precision default 0, reposts double precision default 0,
  quotes double precision default 0, views double precision default 0,
  multiple double precision, max_multiple double precision,
  via text
);
create index if not exists callouts_mint_time on mem.callouts (mint, created_at);
create index if not exists callouts_wallet_time on mem.callouts (wallet, created_at);

create table if not exists mem.callout_updates (
  update_id text primary key,
  callout_id text not null,
  text text not null,
  created_at timestamptz not null
);

create table if not exists mem.bars_1m (
  mint text not null,
  minute timestamptz not null,
  o double precision, h double precision, l double precision, c double precision,
  volume_sol double precision not null default 0,
  buys int not null default 0, sells int not null default 0,
  net_flow_sol double precision not null default 0,
  unique_buyers int not null default 0,
  callouts int not null default 0,
  primary key (mint, minute)
);
create table if not exists mem.bar_buyers (
  mint text not null, minute timestamptz not null, wallet text not null,
  primary key (mint, minute, wallet)
);

-- ---------- board ----------
create table if not exists board.signals (
  id text primary key,
  kind text not null,
  subject text not null,
  value jsonb not null,
  confidence double precision not null,
  produced_at timestamptz not null,
  valid_until timestamptz not null,
  inputs text[] not null default '{}',
  analyzer text not null
);
create index if not exists signals_kind_subject on board.signals (kind, subject, produced_at desc);
create index if not exists signals_produced on board.signals (produced_at);

-- ---------- mind ----------
create table if not exists mind.strategies (
  id text primary key,
  spec jsonb not null,
  family text not null,
  horizon text not null,
  parents text[] not null default '{}',
  origin text not null,
  born_at timestamptz not null,
  retired_at timestamptz,
  retire_reason text
);
create table if not exists mind.stats (
  strategy_id text primary key,
  trades int not null default 0,
  wins int not null default 0,
  net_sum double precision not null default 0,
  net_sq double precision not null default 0,
  equity double precision not null default 0,
  peak double precision not null default 0,
  max_dd double precision not null default 0,
  mk60 double precision[] not null default '{}',
  rets double precision[] not null default '{}',
  stage text not null default 'ghost',
  share double precision not null default 0,
  last_trade_at timestamptz
);
-- one row per open or closed ghost position (per strategy book)
create table if not exists mind.positions (
  id text primary key,
  strategy_id text not null,
  mint text not null,
  callout_id text,
  opened_at timestamptz not null,
  tokens double precision not null,
  tokens_left double precision not null,
  cost_sol double precision not null,
  proceeds_sol double precision not null default 0,
  rent_sol double precision not null,
  entry_price double precision not null,
  exit_bands jsonb not null,
  exits jsonb not null default '[]',
  commit_id text,
  closed_at timestamptz,
  net_sol double precision,
  exit_reason text
);
create index if not exists positions_open on mind.positions (mint) where closed_at is null;
create index if not exists positions_strategy on mind.positions (strategy_id, opened_at);
-- intents wait for the first trade after the modeled latency, then fill at that trade's curve state
create table if not exists mind.intents (
  id text primary key,
  strategy_id text not null,
  mint text not null,
  side text not null,
  size_sol double precision,
  fraction double precision,
  position_id text,
  reason text not null,
  created_at timestamptz not null,
  fill_after timestamptz not null,
  event_id text not null
);
create index if not exists intents_mint on mind.intents (mint, fill_after);
create table if not exists mind.fills (
  id text primary key,
  intent_id text not null,
  strategy_id text not null,
  mint text not null,
  side text not null,
  at timestamptz not null,
  price_sol double precision not null,
  mk jsonb not null default '{}',
  done boolean not null default false
);
create index if not exists fills_open on mind.fills (mint, at) where not done;
create table if not exists mind.coin_callout (
  mint text primary key,
  callout_id text not null,
  author_wallet text,
  at timestamptz not null,
  last_eval timestamptz
);
create table if not exists mind.commits (
  commit_id text primary key,
  kind text not null,
  sha256 text not null,
  content jsonb not null,
  made_at timestamptz not null,
  revealed_at timestamptz
);
create table if not exists mind.desk_clock (
  name text primary key,
  at timestamptz not null,
  round int not null default 0
);
-- scorekeeper: callouts waiting for outcome horizons, and Brier tallies per probability signal
create table if not exists mind.outcome_watch (
  callout_id text primary key,
  event_id text not null,
  mint text not null,
  author text,
  created_at timestamptz not null,
  at timestamptz not null,
  probs jsonb not null,
  done int[] not null default '{}'
);
create index if not exists outcome_watch_mint on mind.outcome_watch (mint);
create table if not exists mind.scores (
  kind text not null,
  horizon_min int not null,
  n int not null default 0,
  brier_sum double precision not null default 0,
  hits int not null default 0,
  p_sum double precision not null default 0,
  primary key (kind, horizon_min)
);
create table if not exists mind.limits (
  version int primary key,
  body jsonb not null,
  set_by text not null,
  set_at timestamptz not null default now()
);

-- ---------- ops ----------
create table if not exists ops.budgets (
  lane text not null,
  hour timestamptz not null,
  units text not null,
  spent double precision not null default 0,
  primary key (lane, hour, units)
);
create table if not exists ops.admin_actions (
  id bigserial primary key,
  action text not null,
  by text not null,
  at timestamptz not null default now(),
  detail jsonb
);
