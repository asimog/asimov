-- Asimog schema (docs/generated/tables.md). Idempotent: safe to run at every boot.
-- tape.* is append-only. Everything in mem/board/mind is a projection rebuildable from the tape.

create schema if not exists tape;
create schema if not exists mem;
create schema if not exists board;
create schema if not exists mind;
create schema if not exists ops;
create schema if not exists idx;
create schema if not exists hands;
create schema if not exists books;

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
-- the pre-call analyzer reads a caller's own buys (docs/PIPELINE.md precall)
create index if not exists events_trade_wallet on tape.events ((body->>'wallet'), seen_time) where topic in ('trade.curve', 'trade.amm');

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

-- where each feed walk stopped (docs/PIPELINE.md feed): a restart walks only what it has not read
create table if not exists tape.feed_cursors (
  name       text primary key,
  newest_at  timestamptz,
  oldest_at  timestamptz,
  token      text,
  updated_at timestamptz not null default now()
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
  first_callout_mcap double precision,
  watched_at timestamptz,
  watch_reason text
);

alter table mem.coins add column if not exists watched_at timestamptz, add column if not exists watch_reason text;

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
-- columns added after the first databases were made (create table if not exists does not add them)
alter table mind.outcome_watch add column if not exists event_id text, add column if not exists author text, add column if not exists created_at timestamptz;
alter table mind.coin_callout add column if not exists last_eval timestamptz;
-- Brier sums per UTC day of resolution; readers sum the trailing SCORE_WINDOW_DAYS (scoresAsOf in scorekeeper.ts)
create table if not exists mind.score_days (
  kind text not null,
  horizon_min int not null,
  day date not null,
  n int not null default 0,
  brier_sum double precision not null default 0,
  hits int not null default 0,
  p_sum double precision not null default 0,
  primary key (kind, horizon_min, day)
);
-- pre-call: known-caller buys waiting for their horizon (docs/PIPELINE.md precall); desk coins in play before a callout
-- probabilities waiting for their horizon: pre-call per coin and buying caller (id mint:caller), slow-mind kinds per signal
create table if not exists mind.prob_watch (
  id text primary key,
  kind text not null,
  mint text not null,
  caller text,
  at timestamptz not null,
  p double precision not null,
  horizon_min int not null,
  done boolean not null default false,
  hit int
);
create table if not exists mind.coin_precall (
  mint text primary key,
  caller text not null,
  at timestamptz not null,
  last_eval timestamptz
);
-- house callouts (docs/EXECUTION.md): one open per coin
create table if not exists mind.house (
  house_id text primary key,
  mint text not null,
  position_id text not null unique,
  strategy_id text not null,
  thesis_id text not null,
  opened_at timestamptz not null,
  closed_at timestamptz
);
create unique index if not exists house_open on mind.house (mint) where closed_at is null;
create table if not exists mind.limits (
  version int primary key,
  body jsonb not null,
  set_by text not null,
  set_at timestamptz not null default now()
);
-- owner lists, one version per load (ctl lists load); the newest version of each kind is in force
create table if not exists mind.lists (
  kind text not null,
  version int not null,
  items text[] not null,
  set_by text not null,
  set_at timestamptz not null default now(),
  primary key (kind, version)
);

-- ---------- ops ----------
-- soul versions on a hash chain (docs/SYSTEM.md): chain = sha256(prev chain + sha256(body))
create table if not exists ops.soul_versions (
  version int primary key,
  sha256 text not null,
  prev_sha256 text,
  chain_sha256 text not null,
  body text not null,
  reason text not null,
  by text not null,
  at timestamptz not null default now()
);

-- ---------- index (docs/PIPELINE.md): rolling 30-day record of wallets and coins from the whole firehose ----------
create table if not exists idx.wallet_coin (
  wallet text not null,
  mint text not null,
  buys int not null default 0,
  sells int not null default 0,
  sol_in double precision not null default 0,
  sol_out double precision not null default 0,
  tok_in double precision not null default 0,
  tok_out double precision not null default 0,
  first_buy_at timestamptz,
  first_buy_price double precision,
  copy_price double precision,       -- the first price we could have bought at after our latency
  peak_after double precision,       -- the highest price seen since the wallet's first buy
  mark_price double precision,       -- the price INDEX_MIN_AGE_MIN after the first buy: what copy value is marked at
  first_sell_at timestamptz,
  early_slot boolean not null default false,
  last_at timestamptz not null,
  primary key (wallet, mint)
);
alter table idx.wallet_coin add column if not exists peak_after double precision, add column if not exists mark_price double precision; -- older databases (no data migration)
create index if not exists wallet_coin_last on idx.wallet_coin (last_at);
create index if not exists wallet_coin_mint on idx.wallet_coin (mint);
create table if not exists idx.coin (
  mint text primary key,
  first_seen_at timestamptz not null,
  first_slot bigint,
  creator text,
  curve_account text,
  last_price double precision,
  peak_price double precision,
  last_at timestamptz not null,
  trades int not null default 0,
  bundle_buys int not null default 0,
  bundle_sol double precision not null default 0,
  graduated boolean not null default false
);
create table if not exists idx.wallet (
  wallet text primary key,
  version int not null,
  n int not null,
  copy_net double precision,
  copy_win_lcb double precision,
  early_right double precision,
  lead_s double precision,
  archetype text not null,
  seed text,                          -- where we first heard of it: leaderboard, top_trader, firehose
  refreshed_at timestamptz not null
);
-- the wallets the Scout matches buys against (docs/PIPELINE.md Scout): memory keeps only a bounded hot set of these
create table if not exists idx.scout_wallet (
  wallet text primary key,
  role text not null,                 -- caller or smart; a wallet that is both is a caller
  at timestamptz not null
);
create table if not exists idx.seed (
  wallet text primary key,
  source text not null,
  detail jsonb,
  seen_at timestamptz not null
);

-- ---------- hands and books (docs/EXECUTION.md, 10, 15) ----------
create table if not exists hands.orders (
  order_id text primary key,
  intent_id text not null,
  state text not null,
  tx_sig text,
  memo text not null,
  mint text,
  strategy_id text,
  close_pending boolean not null default false,
  attempts int not null default 0,
  next_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table hands.orders add column if not exists attempts int not null default 0, add column if not exists next_at timestamptz, add column if not exists created_at timestamptz not null default now();
-- an event the Trader cannot process is parked here instead of blocking every later order
create table if not exists hands.dead_letters (
  event_id text primary key,
  consumer text not null,
  error text not null,
  at timestamptz not null default now()
);
create table if not exists books.entries (
  entry_id text primary key,
  seen_time timestamptz not null,
  kind text not null,
  tx_sig text,
  legs jsonb not null
);
create table if not exists books.balances (account text primary key, lamports bigint not null default 0);
create table if not exists books.lots (
  seq bigserial primary key,
  strategy_id text not null,
  mint text not null,
  tokens double precision not null,
  cost_sol double precision not null
);
create index if not exists lots_open on books.lots (strategy_id, mint, seq);
create table if not exists books.realized (strategy_id text not null, day text not null, realized_sol double precision not null default 0, primary key (strategy_id, day));
create table if not exists books.proofs (
  n int primary key,
  hour text not null unique,
  sha256 text not null,
  prev_sha256 text not null,
  body jsonb not null,
  memo_sig text
);
create table if not exists ops.kill (
  id int primary key default 1 check (id = 1),
  state text not null default 'running' check (state in ('running', 'exit_only', 'halted')),
  reason text,
  by text,
  at timestamptz
);
alter table ops.kill add column if not exists state text not null default 'running' check (state in ('running', 'exit_only', 'halted'));
insert into ops.kill (id) values (1) on conflict do nothing;
-- automatic kill trigger counts survive a restart (docs/SYSTEM.md 5.4)
create table if not exists ops.kill_counts (
  cause text not null,
  at timestamptz not null,
  event_id text primary key
);

-- ===== slow mind read surface (docs/SLOW-MIND.md section 4). Read-only views for BettaFish and MiroShark; the role slow_reader
-- can SELECT here and nowhere else. `SET slow.as_of = '<iso>'` pins a replay's now; nothing seen after it is shown.
create schema if not exists slow;
create table if not exists mem.callout_replies (
  reply_id text primary key, callout_id text not null, wallet text, handle text, text text not null,
  likes double precision default 0, created_at timestamptz not null, seen_at timestamptz not null
);
create table if not exists slow.reports (
  report_id text primary key, producer text not null, kind text not null, subject text not null,
  window_from timestamptz, window_to timestamptz, preset text, sha256 text not null, summary text not null,
  cites text[] not null default '{}', parent_reports text[] not null default '{}', ir jsonb, markdown text,
  published_at timestamptz not null
);
create index if not exists reports_subject on slow.reports (subject, published_at desc);
create table if not exists slow.jobs (
  id text primary key, engine text not null, kind text not null, subject text not null, preset text not null,
  slot text not null, state text not null default 'queued', cost_usd double precision not null default 0,
  started_at timestamptz, finished_at timestamptz, error text, result jsonb, unique (engine, kind, subject, slot)
);
create table if not exists slow.cursors (name text primary key, seen_time timestamptz, event_id text);
create or replace function slow.as_of() returns timestamptz language sql stable as
  $$ select coalesce(nullif(current_setting('slow.as_of', true), '')::timestamptz, now()) $$;

create or replace view slow.pumpfun_callout as
  select c.callout_id note_id, c.text content, '$' || coalesce(k.symbol, left(c.mint, 4)) title,
         coalesce(r.handle, left(c.wallet, 6)) nickname, c.wallet user_id,
         c.likes::bigint liked_count, c.replies::bigint comment_count, (c.reposts + c.quotes)::bigint share_count, c.views::bigint viewd_count,
         (extract(epoch from c.created_at) * 1000)::bigint create_time, 'https://pump.fun/coin/' || c.mint note_url,
         coalesce(k.symbol, '') || ' ' || c.mint source_keyword,
         c.mint, c.mcap_at_call, c.opportunity_age_min, c.pre_move_pct, c.first_on_coin, c.media_url, c.created_at, c.seen_at
  from mem.callouts c left join mem.coins k using (mint) left join mem.callers r on r.wallet = c.wallet
  where c.seen_at <= slow.as_of();

create or replace view slow.pumpfun_callout_comment as
  select reply_id comment_id, callout_id note_id, text content, coalesce(handle, left(wallet, 6)) nickname, wallet user_id,
         likes::bigint like_count, (extract(epoch from created_at) * 1000)::bigint create_time
  from mem.callout_replies where seen_at <= slow.as_of();

create or replace view slow.pumpfun_update as
  select u.update_id comment_id, u.callout_id note_id, u.text content, (extract(epoch from u.created_at) * 1000)::bigint create_time
  from mem.callout_updates u where u.created_at <= slow.as_of();

create or replace view slow.pumpfun_caller as
  select r.wallet, r.handle, r.followers, r.calls_seen, r.first_seen, r.last_call_at,
         (select s.value from board.signals s where s.kind = 'caller.dna' and s.subject = r.wallet and s.produced_at <= slow.as_of() order by s.produced_at desc limit 1) dna
  from mem.callers r where r.first_seen <= slow.as_of();

create or replace view slow.pumpfun_coin as
  select k.mint, k.symbol, k.name, k.image, k.first_seen, k.last_mcap_usd, k.callout_count, k.first_callout_at,
         (select s.value from board.signals s where s.kind = 'curve.progress' and s.subject = k.mint and s.produced_at <= slow.as_of() order by s.produced_at desc limit 1) curve,
         (select s.value from board.signals s where s.kind = 'risk.state' and s.subject = k.mint and s.produced_at <= slow.as_of() order by s.produced_at desc limit 1) risk
  from mem.coins k where k.first_seen <= slow.as_of();

create or replace view slow.pumpfun_trade_flow as
  select mint, minute, o, h, l, c, volume_sol, buys, sells, net_flow_sol, unique_buyers, callouts
  from mem.bars_1m where minute < slow.as_of();

create or replace view slow.media as
  with m as (
    select 'callout:' || callout_id media_id, media_url url, 'callout' kind, mint, callout_id from mem.callouts where media_url is not null and seen_at <= slow.as_of()
    union all
    select 'coin:' || mint, image, 'coin', mint, null from mem.coins where image is not null and first_seen <= slow.as_of()
  )
  select m.*, c.body->>'sha256' sha256, c.body->>'mime' mime
  from m left join lateral (select body from tape.events e where e.topic = 'media.cached' and e.subject = m.media_id and e.seen_time <= slow.as_of() limit 1) c on true;

create or replace view slow.report_feed as
  select report_id, producer, kind, subject, window_from, window_to, preset, sha256, summary, cites, parent_reports, ir, markdown, published_at
  from slow.reports where published_at <= slow.as_of();

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'slow_reader') then create role slow_reader login; end if;
end $$;
grant usage on schema slow to slow_reader;
grant select on slow.pumpfun_callout, slow.pumpfun_callout_comment, slow.pumpfun_update, slow.pumpfun_caller, slow.pumpfun_coin,
  slow.pumpfun_trade_flow, slow.media, slow.report_feed to slow_reader;
grant execute on function slow.as_of() to slow_reader;
-- views run with their owner's rights, so slow_reader needs nothing on mem or board
