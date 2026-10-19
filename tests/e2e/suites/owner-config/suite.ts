// The owner owns the config (fix plan Phase 2): a limit set with the admin token changes the next gate decision, a list
// load blocks what it names and is on the Tape with its count, a bad token changes nothing, a malformed env value
// stops boot with the key's name. Mocked chain.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "../../../../services/core/src/lib/env.ts";
import { loadList, setLimit, showLimits } from "../../../../services/core/src/mind/owner.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";
import { world } from "../../lib/world.ts";

const ADMIN = "admin-secret";

export const suite: Suite = {
  name: "owner-config",
  tier: "fast",
  covers: ["services/core/src/mind/owner.ts", "services/core/src/mind/risk.ts", "services/core/src/cli/ctl.ts", "config/"],
  proves: "ctl limits and ctl lists change the next live gate decision, need the admin token and are on the Tape; a malformed env value stops boot with a named error.",
  async run() {
    const checks: Check[] = [];
    const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
    const w = await world("owner");
    const rejected = async (code: string) => (await w.topic("order.rejected")).filter((e) => e.body.reason_code === code).length;
    const orders = async () => (await w.topic("order.created")).length;
    try {
      const file = JSON.parse(fs.readFileSync(path.join(env.root, "config", "limits.default.json"), "utf8")) as Record<string, number>;
      const shown = await showLimits(w.sql);
      const same = Object.keys(file).every((k) => shown.limits[k] === file[k]) && shown.defaults_in_force.length === Object.keys(file).length;
      check("limits show reads the defaults from config/limits.default.json", same, `${shown.defaults_in_force.length} defaults in force`);
      await w.fund(w.wallets.trade, 0.2);
      await w.intent("buy", { size_sol: 0.015 });
      await w.settle();
      check("a 0.015 SOL buy passes under the default 0.02 cap", (await orders()) === 1, `${await orders()} orders`);
      await w.intent("sell");
      await w.settle();

      let refused = 0;
      for (const t of [undefined, "wrong"]) try { await setLimit(w.sql, w.tape, t, "max_order_sol", "0.01", ADMIN); } catch { refused++; }
      check("limits set refuses a missing or wrong admin token", refused === 2 && (await w.sql`select 1 from mind.limits`).length === 0, `${refused} of 2 refused`);
      const set = await setLimit(w.sql, w.tape, ADMIN, "max_order_sol", "0.01", ADMIN);
      await w.settle();
      const changed = await w.topic("limits.changed");
      check("limits set writes a new version and emits limits.changed", set.version === 1 && changed.length === 1 && changed[0]!.body.value === 0.01, JSON.stringify(set));
      await w.intent("buy", { size_sol: 0.015 });
      await w.settle();
      check("the next 0.015 SOL buy is refused at the new 0.01 cap", (await rejected("order_cap")) === 1 && (await orders()) === 2, `${await rejected("order_cap")} order_cap rejections`);

      let badList = false;
      try { await loadList(w.sql, w.tape, ADMIN, "blocked_mints", "not-an-address\n", ADMIN); } catch { badList = true; }
      check("a list with a line that is not a base58 address is refused whole", badList && (await w.topic("lists.loaded")).length === 0, "refused");
      const loaded = await loadList(w.sql, w.tape, ADMIN, "blocked_mints", `# coins we never buy\n${w.mint}\n${w.mint}\n`, ADMIN);
      await w.settle();
      const ev = await w.topic("lists.loaded");
      check("lists load emits lists.loaded with the right count", ev.length === 1 && ev[0]!.body.count === 1 && loaded.count === 1, JSON.stringify(loaded));
      await w.intent("buy", { size_sol: 0.005 });
      await w.settle();
      check("a coin on the loaded blocklist is refused", (await rejected("blocklisted")) === 1, `${await rejected("blocklisted")} blocklisted rejections`);

      const probe = spawnSync(process.execPath, ["--import", "tsx", "-e", `import("./services/core/src/lib/env.ts").then(({ env }) => env.int("KILL_SIGNER_REFUSALS"))`], {
        cwd: env.root, env: { ...process.env, KILL_SIGNER_REFUSALS: "three" }, encoding: "utf8",
      });
      check("a malformed env number stops boot and names the key", probe.status !== 0 && probe.stderr.includes("KILL_SIGNER_REFUSALS"), (probe.stderr.match(/env KILL_SIGNER_REFUSALS[^\n]*/) ?? [`exit ${probe.status}`])[0]);
    } finally {
      await w.close();
    }
    return { checks, metrics: { root: path.basename(env.root) } };
  },
};
