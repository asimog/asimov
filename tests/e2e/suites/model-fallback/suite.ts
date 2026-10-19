// E4 (docs/OPS.md "Models"): the shipped config/models.json passes its schema and gives each agent a chain ending in the
// fallbacks; a lane whose primary fails answers from the next model, on LLM_FALLBACK_KEY; when every model fails the error
// names each one. Through the real Lane and ChatOpenAI against a local OpenAI-shaped server, so nothing leaves the machine.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Lane } from "../../../../packages/lane/src/index.ts";
import { configValues, modelChain } from "../../../../services/core/src/lib/config.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

type Hit = { model: string; key: string };

/** /chat/completions: a model named `fail-*` answers 500, any other answers "ok from <model>". */
async function fakeProvider() {
  const hits: Hit[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { model } = JSON.parse(body || "{}") as { model: string };
      hits.push({ model, key: String(req.headers.authorization ?? "").replace("Bearer ", "") });
      res.setHeader("content-type", "application/json");
      if (model.startsWith("fail-")) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: { message: "upstream down" } }));
        return;
      }
      res.end(JSON.stringify({ id: "x", object: "chat.completion", created: 0, model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: `ok from ${model}` } }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, hits, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export const suite: Suite = {
  name: "model-fallback",
  tier: "fast",
  covers: ["packages/lane/", "config/models.json"],
  proves: "E4: each agent's model chain comes from config/models.json; a failing primary falls back to the next model on LLM_FALLBACK_KEY in one short run, and an all-fail names every model.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });

    const models = configValues().models;
    const chain = modelChain(models, "postmortem");
    add("the shipped models.json gives an agent its model, then the fallback chain", chain[0] === (models.agents.postmortem ?? models.default) && chain.slice(1).join() === models.fallback.join() && chain.length >= 2, chain.join(" > "));

    const p = await fakeProvider();
    try {
      const env = { LLM_BASE_URL: p.url, LLM_KEY_THINK: "primary-key", LLM_FALLBACK_KEY: "fallback-key", LLM_STUB: "0" };
      const lane = new Lane("THINK", { env, models: ["fail-primary", "free-a", "free-b"], capUsdHour: 1 });
      const t0 = performance.now();
      const r = await lane.ask({ system: "s", user: "u", maxTokens: 8 });
      const ms = Math.round(performance.now() - t0);
      add("a failing primary falls back to the next model", r.text === "ok from free-a", r.text);
      add("primary on the lane key, fallback on LLM_FALLBACK_KEY, one call each", JSON.stringify(p.hits) === JSON.stringify([{ model: "fail-primary", key: "primary-key" }, { model: "free-a", key: "fallback-key" }]), JSON.stringify(p.hits));
      add("the fallback is immediate (no client retries)", ms < 3000, `${ms} ms`);
      add("the fallback call is metered", lane.calls === 1 && r.usd > 0, `calls ${lane.calls} usd ${r.usd}`);

      p.hits.length = 0;
      const dead = new Lane("THINK", { env, models: ["fail-primary", "fail-free"], capUsdHour: 1 });
      const err = await dead.ask({ system: "s", user: "u" }).then(() => "", (e: Error) => e.message);
      add("when every model fails, the error names each one", err.includes("fail-primary") && err.includes("fail-free"), err);

      const nokey = new Lane("THINK", { env: { ...env, LLM_FALLBACK_KEY: "" }, models: ["fail-primary", "free-a"], capUsdHour: 1 });
      const err2 = await nokey.ask({ system: "s", user: "u" }).then(() => "", (e: Error) => e.message);
      add("a fallback without LLM_FALLBACK_KEY is skipped and named", err2.includes("LLM_FALLBACK_KEY"), err2);
    } finally {
      await p.close();
    }
    return { checks, metrics: {} };
  },
};
