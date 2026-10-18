// One short real model call per lane (docs/14 "Slow-mind suites"): `npm run agents:smoke`. A lane without its key
// (LLM_KEY_<LANE> in .env.local) is skipped and said so. Costs a fraction of a cent per lane.
import { Lane, LANES, loadEnv } from "@asimog/lane";

const env = loadEnv();
for (const name of LANES) {
  if (!env[`LLM_KEY_${name}`]) {
    console.log(JSON.stringify({ lane: name, skipped: `no LLM_KEY_${name}` }));
    continue;
  }
  const lane = new Lane(name, { env: { ...env, LLM_STUB: "0" } });
  const r = await lane.ask({ system: "Answer in five words or fewer.", user: "Name one color.", maxTokens: 16 });
  console.log(JSON.stringify({ lane: name, answer: r.text.trim().slice(0, 60), usd: r.usd }));
}
