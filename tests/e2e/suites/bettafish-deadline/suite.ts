// A BettaFish run whose model never answers ends at its deadline as failed instead of holding its slot forever.
// The real worker; its Insight engine points at a server that accepts every request and never replies.
import http from "node:http";
import { runBettafish } from "../../lib/bettafish.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "bettafish-deadline",
  tier: "slow",
  covers: ["services/bettafish/engine/asimog_worker.py"],
  proves: "With the model hung, a BettaFish run fails at BETTAFISH_RUN_DEADLINE_S instead of holding its MAX_CONCURRENT slot forever.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const held: http.ServerResponse[] = [];
    const hang = http.createServer((_req, res) => void held.push(res));
    await new Promise<void>((ok) => hang.listen(0, "127.0.0.1", ok));
    const url = `http://127.0.0.1:${(hang.address() as { port: number }).port}`;
    const t0 = Date.now();
    const r = await runBettafish("bfdeadline", "insight", { INSIGHT_ENGINE_BASE_URL: url, KEYWORD_OPTIMIZER_BASE_URL: url, BETTAFISH_RUN_DEADLINE_S: "5", BETTAFISH_MAX_CONCURRENT: "1" });
    try {
      add("the worker started", r.healthy, r.healthy ? "healthy" : r.log.slice(-400));
      const ms = Date.now() - t0;
      add("the hung run fails at its deadline", r.job?.state === "failed" && String(r.job?.error).includes("run deadline"), `${r.job?.state}: ${r.job?.error} after ${ms} ms`);
      const runs = await r.w.sql`select count(*)::int n from slow.jobs where state = 'running'`;
      add("no job is left running", runs[0]!.n === 0, `${runs[0]!.n} running`);
      return { checks, metrics: { ms } };
    } finally {
      for (const res of held) res.destroy();
      hang.close();
      await r.close();
    }
  },
};
