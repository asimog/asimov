// Publisher speaks only under coins we hold (docs/EXECUTION.md 5): a reply on an unheld coin is refused, a held one passes every text check.
import { replyFor } from "../../../../services/core/src/hands/publisher.ts";
import { checkText } from "../../../../services/core/src/hands/text-checks.ts";
import type { Suite } from "../../lib/suite.ts";

const held = { size: 0.02, tokens: 1_000_000, left: 400_000 };
const live = { via: "push" } as const;

export const suite: Suite = {
  name: "publisher-held",
  tier: "fast",
  covers: ["services/core/src/hands/publisher.ts", "services/core/src/hands/text-checks.ts"],
  proves: "A reply under another caller's callout is drafted only while we hold the coin, and it discloses our position.",
  async run() {
    const unheld = replyFor(undefined, live);
    const sold = replyFor({ ...held, left: 0 }, live);
    const old = replyFor(held, { via: "history" });
    const ok = replyFor(held, live);
    const c = ok.ok ? checkText(ok.text, { kind: "reply", paper: true }) : null;
    const undisclosed = checkText("PAPER. We hold this coin.", { kind: "reply", paper: true });
    return {
      checks: [
        { name: "a reply on an unheld coin is refused", pass: !unheld.ok && unheld.reason === "not_held", detail: JSON.stringify(unheld) },
        { name: "a reply after the full exit is refused", pass: !sold.ok && sold.reason === "not_held", detail: JSON.stringify(sold) },
        { name: "a history callout gets no reply", pass: !old.ok, detail: JSON.stringify(old) },
        { name: "a held coin gets a reply that passes every check", pass: !!c?.ok, detail: ok.ok ? `${ok.text} | failed: ${c!.failed.join(",") || "none"}` : JSON.stringify(ok) },
        { name: "a reply without the position is refused", pass: undisclosed.failed.includes("position_disclosed"), detail: undisclosed.failed.join(",") },
      ],
      metrics: { text: ok.ok ? ok.text : null },
    };
  },
};
