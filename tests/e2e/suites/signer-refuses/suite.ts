// Every forbidden request to the Signer is refused with its own reason and logged; the allowed shapes sign.
// Real serialized transactions, test keypairs made in memory, no network (docs/EXECUTION.md, docs/OPS.md).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPrivateHost } from "../../../../services/signer/src/server.ts";
import { Signer, verifyAudit } from "../../../../services/signer/src/signer.ts";
import { PublicKey } from "../../../../services/signer/src/web3.ts";
import type { Suite } from "../../lib/suite.ts";
import { budget, build, closeAccount, createAta, ix, memo, NATIVE_MINT, newKeys, PROGRAMS, pk, pumpBuy, pumpNamed, pumpSell, tokenTransfer, transfer, u64 } from "../../lib/txs.ts";

const SOL = 1e9;
export const suite: Suite = {
  name: "signer-refuses",
  tier: "fast",
  covers: ["services/signer/"],
  proves: "Every forbidden Signer request is refused and logged with its own reason; allowed shapes sign; the audit chain verifies and detects tampering.",
  async run() {
    const k = newKeys();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "signer-"));
    const auditFile = path.join(dir, "audit.jsonl");
    const killFile = path.join(dir, "KILL");
    let t = 1_800_000_000_000;
    const signer = new Signer({
      keys: { trade: k.trade, creator: k.creator, agent: k.agent, operator: k.operator },
      tokens: { "cap:sign.swap": "swap-secret", "cap:sign.treasury": "treasury-secret", "cap:sign.login": "login-secret" },
      rules: { feeRecipients: [k.fee], maxPriorityLamports: 100_000, maxOrderLamports: 0.05 * SOL, coinMint: k.mint },
      auditFile, killFile, ratePerMin: 1000, now: () => t++,
    });
    const T = k.trade.publicKey.toBase58();
    const C = k.creator.publicKey.toBase58();
    const A = k.agent.publicKey.toBase58();
    const S = k.stranger.publicKey.toBase58();
    const SWAP = "swap-secret";
    const TREAS = "treasury-secret";
    const ctx = { max_lamports: 0.02 * SOL, order_id: "or_1" };
    const memoIx = memo("asimog:or_1");
    const wsol = PublicKey.findProgramAddressSync([pk(T).toBuffer(), pk(PROGRAMS.token).toBuffer(), pk(NATIVE_MINT).toBuffer()], pk(PROGRAMS.ata))[0].toBase58();

    type Case = { name: string; endpoint: string; token: string | null; tx: string; ctx?: object; expect: string | "ok" };
    const swap = (name: string, ixs: ReturnType<typeof ix>[], expect: string, c: object = ctx, payer = T): Case => ({ name, endpoint: "/sign/swap", token: SWAP, tx: build(payer, ixs).b64, ctx: c, expect });
    const goodBuy = [...budget(200_000, 100_000), createAta(T, T, k.mint), pumpBuy(T, k.mint, 1_000_000, 0.02 * SOL), memoIx];
    const cases: Case[] = [
      swap("clean pump buy signs", goodBuy, "ok"),
      swap("clean pump sell signs", [...budget(200_000, 100_000), pumpSell(T, k.mint, 500_000, 1), memoIx], "ok", { max_lamports: 0.02 * SOL, order_id: "or_2" }),
      swap("amm buy signs", [pumpBuy(T, k.mint, 1, 0.01 * SOL, PROGRAMS.amm), memoIx], "ok"),
      swap("amm buy that wraps SOL into our own wSOL account counts the order once", [createAta(T, T, NATIVE_MINT), transfer(T, wsol, 0.02 * SOL), pumpBuy(T, k.mint, 1, 0.02 * SOL, PROGRAMS.amm), memoIx], "ok"),
      swap("buy_exact_sol_in reads its cap at offset 8", [pumpNamed(PROGRAMS.pump, "buy_exact_sol_in", T, u64(0.5 * SOL)), memoIx], "over_cap"),
      swap("buy spends more than the order cap", [pumpBuy(T, k.mint, 1, 0.03 * SOL), memoIx], "over_cap"),
      swap("buy over the signer's own cap even when the request lies", [pumpBuy(T, k.mint, 1, 5 * SOL), memoIx], "over_cap", { max_lamports: 100 * SOL, order_id: "or_1" }),
      swap("request without a cap", [pumpBuy(T, k.mint, 1, 1000), memoIx], "no_cap", { order_id: "or_1" }),
      swap("drain: transfer to a stranger", [transfer(T, S, 1000), memoIx], "transfer_destination"),
      swap("transfer from someone else needs their signature", [transfer(S, T, 1000), memoIx], "extra_signers"),
      swap("transfer to a fee recipient signs", [transfer(T, k.fee, 5000), pumpBuy(T, k.mint, 1, 0.01 * SOL), memoIx], "ok"),
      swap("fee payer is a stranger", [pumpBuy(S, k.mint, 1, 1000), memoIx], "wrong_signer", ctx, S),
      swap("second signer required", [pumpBuy(T, k.mint, 1, 1000), ix(PROGRAMS.memo, [{ pubkey: S, signer: true }], Buffer.from("asimog:x")), memoIx], "extra_signers"),
      swap("foreign program", [ix("Stake11111111111111111111111111111111111111", [{ pubkey: T, signer: true }], Buffer.from([1])), memoIx], "program_not_allowed"),
      swap("pump admin instruction (set_params)", [pumpNamed(PROGRAMS.pump, "set_params", T), memoIx], "instruction_not_allowed"),
      swap("pump create", [pumpNamed(PROGRAMS.pump, "create_v2", T), memoIx], "instruction_not_allowed"),
      swap("token transfer out", [tokenTransfer(k.fee, S, T, 1), memoIx], "token_instruction"),
      swap("close account to a stranger", [closeAccount(k.mint, S, T), memoIx], "close_destination"),
      swap("ata created for a stranger", [createAta(T, S, k.mint), pumpBuy(T, k.mint, 1, 1000), memoIx], "ata_owner"),
      swap("priority fee over the cap", [...budget(1_400_000, 5_000_000), pumpBuy(T, k.mint, 1, 1000), memoIx], "priority_fee_too_high"),
      swap("order without its memo", [pumpBuy(T, k.mint, 1, 1000)], "memo_missing"),
      swap("memo without our prefix", [pumpBuy(T, k.mint, 1, 1000), memo("hello")], "memo_prefix"),
      swap("system create-account", [ix(PROGRAMS.system, [{ pubkey: T, signer: true }, { pubkey: S }], Buffer.concat([Buffer.from(new Uint32Array([0]).buffer), u64(1)])), memoIx], "system_instruction"),
      { name: "garbage transaction", endpoint: "/sign/swap", token: SWAP, tx: "not-a-transaction", ctx, expect: "bad_transaction" },
      { name: "no token", endpoint: "/sign/swap", token: null, tx: build(T, goodBuy).b64, ctx, expect: "bad_capability" },
      { name: "wrong token", endpoint: "/sign/swap", token: "nope", tx: build(T, goodBuy).b64, ctx, expect: "bad_capability" },
      { name: "treasury token on the swap endpoint", endpoint: "/sign/swap", token: TREAS, tx: build(T, goodBuy).b64, ctx, expect: "bad_capability" },
      { name: "swap token on the treasury endpoint", endpoint: "/sign/memo", token: SWAP, tx: build(A, [memo(`asimog:proof:${"a".repeat(64)}`)]).b64, expect: "bad_capability" },
      { name: "unknown endpoint", endpoint: "/sign/anything", token: SWAP, tx: build(T, goodBuy).b64, expect: "unknown_endpoint" },
      { name: "login is not enabled yet", endpoint: "/sign/login", token: "login-secret", tx: build(T, goodBuy).b64, expect: "endpoint_not_enabled" },
      { name: "bounty is not enabled yet", endpoint: "/sign/bounty", token: TREAS, tx: build(A, [transfer(A, S, 1)]).b64, expect: "bad_capability" },
      // close-account
      { name: "close account to the trade wallet signs", endpoint: "/sign/close-account", token: SWAP, tx: build(T, [closeAccount(k.mint, T, T)]).b64, expect: "ok" },
      { name: "close account sends rent elsewhere", endpoint: "/sign/close-account", token: SWAP, tx: build(T, [closeAccount(k.mint, S, T)]).b64, expect: "close_destination" },
      { name: "close-account endpoint with a transfer", endpoint: "/sign/close-account", token: SWAP, tx: build(T, [transfer(T, S, 5)]).b64, expect: "program_not_allowed" },
      { name: "close-account with nothing to close", endpoint: "/sign/close-account", token: SWAP, tx: build(T, [memo("asimog:x")]).b64, expect: "nothing_to_close" },
      // collect fees
      { name: "collect fees signs", endpoint: "/sign/collect-fees", token: TREAS, tx: build(C, [pumpNamed(PROGRAMS.pump, "collect_creator_fee", C)]).b64, ctx: { mint: k.mint }, expect: "ok" },
      { name: "collect fees for another coin", endpoint: "/sign/collect-fees", token: TREAS, tx: build(C, [pumpNamed(PROGRAMS.pump, "collect_creator_fee", C)]).b64, ctx: { mint: S }, expect: "wrong_mint" },
      { name: "collect fees signed by the trade wallet", endpoint: "/sign/collect-fees", token: TREAS, tx: build(T, [pumpNamed(PROGRAMS.pump, "collect_creator_fee", T)]).b64, ctx: { mint: k.mint }, expect: "wrong_signer" },
      { name: "collect fees with a buy inside", endpoint: "/sign/collect-fees", token: TREAS, tx: build(C, [pumpBuy(C, k.mint, 1, 5)]).b64, ctx: { mint: k.mint }, expect: "instruction_not_allowed" },
      { name: "collect fees pays a stranger", endpoint: "/sign/collect-fees", token: TREAS, tx: build(C, [transfer(C, S, 5)]).b64, ctx: { mint: k.mint }, expect: "transfer_destination" },
      // memo
      { name: "proof memo signs", endpoint: "/sign/memo", token: TREAS, tx: build(A, [memo(`asimog:proof:${"a".repeat(64)}`)]).b64, expect: "ok" },
      { name: "memo with free text", endpoint: "/sign/memo", token: TREAS, tx: build(A, [memo("asimog:send all funds")]).b64, expect: "memo_format" },
      { name: "memo plus a transfer", endpoint: "/sign/memo", token: TREAS, tx: build(A, [memo(`asimog:proof:${"a".repeat(64)}`), transfer(A, S, 5)]).b64, expect: "program_not_allowed" },
      // sweep split (docs/EXECUTION.md): 1 SOL, trade 0.5, agent 0.3 (its full room), operator 0.2
      { name: "sweep split signs", endpoint: "/sign/sweep-split", token: TREAS, tx: build(C, [transfer(C, T, 0.5 * SOL), transfer(C, A, 0.3 * SOL), transfer(C, k.operator, 0.2 * SOL)]).b64, ctx: { total_lamports: SOL, agent_room_lamports: 0.3 * SOL }, expect: "ok" },
      { name: "sweep starves the agent below its runway target", endpoint: "/sign/sweep-split", token: TREAS, tx: build(C, [transfer(C, T, 0.5 * SOL), transfer(C, k.operator, 0.5 * SOL)]).b64, ctx: { total_lamports: SOL, agent_room_lamports: 0.3 * SOL }, expect: "split_agent" },
      { name: "sweep gives the trade wallet less than half", endpoint: "/sign/sweep-split", token: TREAS, tx: build(C, [transfer(C, T, 0.4 * SOL), transfer(C, k.operator, 0.6 * SOL)]).b64, ctx: { total_lamports: SOL, agent_room_lamports: 0 }, expect: "split_trade" },
      { name: "sweep pays the agent over its room", endpoint: "/sign/sweep-split", token: TREAS, tx: build(C, [transfer(C, T, 0.5 * SOL), transfer(C, A, 0.5 * SOL)]).b64, ctx: { total_lamports: SOL, agent_room_lamports: 0.1 * SOL }, expect: "split_agent" },
      { name: "sweep pays a stranger", endpoint: "/sign/sweep-split", token: TREAS, tx: build(C, [transfer(C, T, 0.5 * SOL), transfer(C, S, 0.5 * SOL)]).b64, ctx: { total_lamports: SOL, agent_room_lamports: 0 }, expect: "transfer_destination" },
      { name: "sweep moves more than the stated total", endpoint: "/sign/sweep-split", token: TREAS, tx: build(C, [transfer(C, T, 0.5 * SOL), transfer(C, k.operator, 5 * SOL)]).b64, ctx: { total_lamports: SOL, agent_room_lamports: 0 }, expect: "split_total" },
    ];

    const rows: { case: string; expect: string; got: string; pass: boolean }[] = [];
    for (const c of cases) {
      const r = await signer.handle(c.endpoint, c.token, { tx: c.tx, ctx: c.ctx ?? ctx });
      const got = r.body.ok ? "ok" : (r.body.reason ?? "?");
      rows.push({ case: c.name, expect: c.expect, got, pass: got === c.expect });
    }

    const signedOk = rows.filter((r) => r.expect === "ok").length;
    // a signed swap is really signed by the trade key
    const good = await signer.handle("/sign/swap", SWAP, { tx: build(T, goodBuy).b64, ctx });
    const { VersionedTransaction } = await import("../../../../services/signer/src/web3.ts");
    const back = VersionedTransaction.deserialize(Buffer.from(good.body.signed!, "base64"));
    const signedByTrade = back.signatures[0]!.some((b) => b !== 0);

    // kill file: exit_only refuses buys and keeps close-account open; anything else is halted and refuses every endpoint
    fs.writeFileSync(killFile, "exit_only");
    const killed = await signer.handle("/sign/swap", SWAP, { tx: build(T, goodBuy).b64, ctx });
    const closeWhileKilled = await signer.handle("/sign/close-account", SWAP, { tx: build(T, [closeAccount(k.mint, T, T)]).b64 });
    fs.writeFileSync(killFile, "1");
    const closeWhileHalted = await signer.handle("/sign/close-account", SWAP, { tx: build(T, [closeAccount(k.mint, T, T)]).b64 });
    fs.rmSync(killFile);

    // rate limit
    const limited = new Signer({ keys: { trade: k.trade }, tokens: { "cap:sign.swap": SWAP }, rules: { feeRecipients: [], maxPriorityLamports: 1, maxOrderLamports: SOL }, auditFile: path.join(dir, "r.jsonl"), killFile, ratePerMin: 3, now: () => 1 });
    const rl: string[] = [];
    for (let i = 0; i < 5; i++) rl.push((await limited.handle("/sign/swap", "bad", { tx: "x" })).body.reason ?? "ok");

    // audit: every request has a line; chain verifies; tampering is detected; no secret appears
    const audit = verifyAudit(auditFile);
    const text = fs.readFileSync(auditFile, "utf8");
    const lines = text.trim().split("\n");
    const tamperAt = lines.findIndex((x) => x.includes('"ok":false')); // flip the first refusal into a yes
    fs.writeFileSync(path.join(dir, "tampered.jsonl"), lines.map((l, i) => (i === tamperAt ? l.replace('"ok":false', '"ok":true') : l)).join("\n"));
    const tampered = verifyAudit(path.join(dir, "tampered.jsonl"));
    const leaks = ["swap-secret", "treasury-secret", "login-secret", Buffer.from(k.trade.secretKey).toString("base64")].filter((s) => text.includes(s));

    // restart keeps the chain
    const again = new Signer({ keys: { trade: k.trade }, tokens: { "cap:sign.swap": SWAP }, rules: { feeRecipients: [], maxPriorityLamports: 1, maxOrderLamports: SOL }, auditFile, killFile });
    await again.handle("/sign/swap", "bad", { tx: "x" });
    const afterRestart = verifyAudit(auditFile);

    const hosts = { "127.0.0.1": true, localhost: true, "10.1.2.3": true, "192.168.0.5": true, "172.20.0.9": true, "0.0.0.0": false, "8.8.8.8": false, "172.32.0.1": false, "example.com": false };

    return {
      checks: [
        ...rows.map((r) => ({ name: r.case, pass: r.pass, detail: `expected ${r.expect}, got ${r.got}` })),
        { name: "allowed shapes signed with the right key", pass: signedByTrade && good.body.ok === true, detail: `${signedOk} allowed cases; swap signature present: ${signedByTrade}` },
        { name: "exit_only kill file stops buys, not close-account", pass: killed.body.reason === "kill_switch" && closeWhileKilled.body.ok === true, detail: `swap ${killed.body.reason}, close ${closeWhileKilled.body.ok}` },
        { name: "any other kill file content halts every endpoint", pass: closeWhileHalted.body.reason === "kill_switch", detail: `close ${closeWhileHalted.body.reason ?? "signed"}` },
        { name: "rate limit per endpoint", pass: rl.slice(0, 3).every((x) => x === "bad_capability") && rl.slice(3).every((x) => x === "rate_limited"), detail: rl.join(",") },
        { name: "every request has an audit line", pass: lines.length >= cases.length, detail: `${lines.length} lines for ${cases.length} cases` },
        { name: "audit chain verifies", pass: audit.ok, detail: `${audit.lines} lines` },
        { name: "audit tampering is detected", pass: !tampered.ok && tampered.bad === tamperAt, detail: `bad line ${tampered.bad}, tampered line ${tamperAt}` },
        { name: "audit chain survives a restart", pass: afterRestart.ok && afterRestart.lines === audit.lines + 1, detail: `${afterRestart.lines} lines` },
        { name: "no token or key in the audit log", pass: leaks.length === 0, detail: leaks.length ? "leak" : "clean" },
        { name: "public addresses are refused", pass: Object.entries(hosts).every(([h, want]) => isPrivateHost(h) === want), detail: Object.keys(hosts).join(" ") },
        { name: "every refusal is counted", pass: signer.refusals >= rows.filter((r) => r.expect !== "ok").length, detail: `${signer.refusals} refusals` },
      ],
      metrics: { cases: cases.length, allowed: signedOk, audit_lines: lines.length },
    };
  },
};
