// The Strategy Pool on the fixture tape: seeds load, strategies evaluate, the gate decides, ghosts fill and close.

import { seedSpecs } from "../../../../services/core/src/mind/seeds.ts";
import { everyReplayChecks } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "strategies-replay",
  tier: "slow",
  covers: ["services/core/src/mind/"],
  proves: "30 seed strategies load and evaluate on the tape; every intent is gated; ghost fills, exits, rent refunds, markouts and allocation rounds happen with costs counted.",
  tape: true,
  async run(ctx) {
    const r = await ctx.replay();
    const sql = r.sql;
    const [pool] = await sql`select count(*)::int total, count(*) filter (where origin = 'seed')::int seeds, count(*) filter (where retired_at is null)::int alive from mind.strategies`;
    const counts = Object.fromEntries((await sql`select topic, count(*)::int n from tape.events where topic in ('intent.created','order.rejected','intent.ghost_filled','position.closed','markout.measured','kernel.allocation','commit.made','commit.revealed') group by 1`).map((x) => [x.topic, x.n]));
    const reasons = await sql`select body->>'reason_code' code, count(*)::int n from tape.events where topic = 'order.rejected' group by 1 order by 2 desc`;
    const families = await sql`
      select s.family, s.horizon, count(p.*)::int trades, round(sum(p.net_sol)::numeric, 6)::float net_sol,
        round(avg(case when p.net_sol > 0 then 1 else 0 end)::numeric, 3)::float hit_rate, round(avg(p.rent_sol)::numeric, 8)::float rent_each
      from mind.positions p join mind.strategies s on s.id = p.strategy_id where p.closed_at is not null group by 1, 2 order by 4 desc nulls last`;
    const exits = await sql`select split_part(exit_reason, ':', 3) reason, count(*)::int n, round(avg(net_sol)::numeric, 6)::float avg_net from mind.positions where closed_at is not null group by 1 order by 2 desc`;
    const top = await sql`select strategy_id, trades, round((net_sum / greatest(trades, 1))::numeric, 4)::float mean_ret, round(equity::numeric, 6)::float net_sol, round(max_dd::numeric, 6)::float max_dd, stage, round(share::numeric, 4)::float share
      from mind.stats where trades > 0 order by equity desc limit 10`;
    const mk = await sql`select body->>'side' side, count(*)::int n, round(avg((body->>'h1s')::float)::numeric, 1)::float h1s, round(avg((body->>'h10s')::float)::numeric, 1)::float h10s,
      round(avg((body->>'h60s')::float)::numeric, 1)::float h60s, round(avg((body->>'h5m')::float)::numeric, 1)::float h5m from tape.events where topic = 'markout.measured' group by 1`;
    const [rent] = await sql`select count(*)::int closes, count(*) filter (where (body->>'rent_refund_sol')::float > 0)::int refunded,
      round(sum((body->>'net_sol')::float)::numeric, 6)::float net_sol from tape.events where topic = 'position.closed'`;
    const [costs] = await sql`select round(sum((body->>'fee_sol')::float)::numeric, 6)::float fees_sol, round(avg((body->>'slippage_bps')::float)::numeric, 1)::float avg_slippage_bps from tape.events where topic = 'intent.ghost_filled'`;
    const [open] = await sql`select count(*)::int n from mind.positions where closed_at is null`;
    const gated = (counts["order.rejected"] ?? 0) + (counts["intent.ghost_filled"] ?? 0) + (await sql`select count(*)::int n from mind.intents`)[0]!.n;
    const checks = [
      ...(await everyReplayChecks(sql, r.netCalls)),
      { name: "every seed loads", pass: pool!.seeds === seedSpecs().length, detail: `${pool!.seeds} seeds, ${pool!.alive} alive, ${pool!.total} total` },
      { name: "intents created", pass: (counts["intent.created"] ?? 0) > 0, detail: `${counts["intent.created"] ?? 0} intents` },
      { name: "every intent gated, filled or pending", pass: gated >= (counts["intent.created"] ?? 0), detail: `${gated} decided of ${counts["intent.created"] ?? 0}` },
      { name: "ghost positions closed", pass: (counts["position.closed"] ?? 0) > 0, detail: `${counts["position.closed"] ?? 0} closed, ${open!.n} open at the end` },
      { name: "rent refunded on every close", pass: rent!.closes === rent!.refunded, detail: `${rent!.refunded} of ${rent!.closes}` },
      { name: "markouts measured", pass: (counts["markout.measured"] ?? 0) > 0, detail: `${counts["markout.measured"] ?? 0} markouts` },
      { name: "allocation rounds ran", pass: (counts["kernel.allocation"] ?? 0) >= 3, detail: `${counts["kernel.allocation"] ?? 0} rounds` },
    ];
    return { checks, metrics: { replay: { ms: r.ms, db: r.db }, pool, counts, rejections: reasons, families, exits, top_strategies: top, markouts_bps: mk, closes: rent, costs, desk: r.consumers.desk } };
  },
};
