// D7, fix plan 5.14 (AGENTS.md Money: ASIMOG_MODE comes from the owner's config): a stub model is refused when ASIMOG_MODE=live,
// naming the setting, and allowed in paper. Through the real Lane constructor every thinking agent and engine lane uses.
import { Lane } from "../../../../packages/lane/src/index.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

/** The error a lane's construction throws, or null. */
const refusal = (o: ConstructorParameters<typeof Lane>[1]) => {
  try {
    new Lane("SYNTH", o);
    return null;
  } catch (err) {
    return String((err as Error).message);
  }
};

export const suite: Suite = {
  name: "stub-live",
  tier: "fast",
  covers: ["packages/lane/"],
  proves: "Fix plan 5.14: a lane with a stub model (LLM_STUB or a scripted stub) refuses to start when ASIMOG_MODE=live, naming the setting; in paper the stub is allowed.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const live = [refusal({ env: { LLM_STUB: "1", ASIMOG_MODE: "live" } }), refusal({ env: { ASIMOG_MODE: "live" }, stub: () => "{}" })];
    add("a stub model in live mode is refused, naming the setting", live.every((m) => !!m && m.includes("LLM_STUB") && m.includes("ASIMOG_MODE=live")), live.join(" | "));
    const paper = refusal({ env: { LLM_STUB: "1", ASIMOG_MODE: "paper" } });
    const lane = paper === null ? new Lane("SYNTH", { env: { LLM_STUB: "1", ASIMOG_MODE: "paper" } }) : null;
    add("a stub model in paper mode is allowed", paper === null && lane?.stubbed === true, paper ?? `stubbed ${lane?.stubbed}`);
    return { checks, metrics: {} };
  },
};
