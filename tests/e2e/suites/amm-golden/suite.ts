// Golden test (docs/14): the miroshark curve port against @pump-fun/pump-sdk, 1,000 buys and 1,000 sells, to the lamport.
import { createRequire } from "node:module";
import path from "node:path";
import { applyBuy, applySell, buyTokens, type Curve, curveFromPrice, FEES, sellSol, START } from "../../../../services/miroshark/src/amm.ts";
import { env } from "../../../../services/core/src/lib/env.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

// the SDK lives in core's dependencies
const req = createRequire(path.join(env.root, "services/core/package.json"));
const sdk = req("@pump-fun/pump-sdk") as Record<string, (a: unknown) => { toString(): string }>;
const BN = req("bn.js") as new (v: string | number) => unknown;
const { PublicKey } = req("@solana/web3.js") as { PublicKey: new (s: string) => unknown };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const creator = new PublicKey("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
const quote = new PublicKey("So11111111111111111111111111111111111111112");
const global = { feeBasisPoints: new BN(Number(FEES.protocolBps)), creatorFeeBasisPoints: new BN(Number(FEES.creatorBps)), creatorFeeConfigurable: false, flatPumpFees: {}, tokenTotalSupply: new BN("1000000000000000") };
const sdkCurve = (c: Curve) => ({
  virtualTokenReserves: new BN(c.vTok.toString()), virtualQuoteReserves: new BN(c.vSol.toString()), realTokenReserves: new BN(c.realTok.toString()), realQuoteReserves: new BN(c.realSol.toString()),
  tokenTotalSupply: new BN("1000000000000000"), complete: false, creator, isMayhemMode: false, isCashbackCoin: false, quoteMint: quote, creatorFeeBps: new BN(0),
});
const args = (c: Curve, amount: bigint) => ({ global, feeConfig: null, mintSupply: new BN("1000000000000000"), bondingCurve: sdkCurve(c), amount: new BN(amount.toString()), quoteMint: quote });

/** A curve somewhere between launch and graduation: price from a log-uniform draw, reserves from the invariant. */
function randomCurve(r: () => number): Curve {
  const price = 2.8e-8 * Math.exp(r() * Math.log(30)); // SOL per token, launch to about 30x
  return curveFromPrice(price);
}

export const suite: Suite = {
  name: "amm-golden",
  proves: "The TypeScript curve port quotes the same lamports and tokens as @pump-fun/pump-sdk on 1,000 buys and 1,000 sells.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const r = mulberry32(2026);
    let buyMiss = 0;
    let sellMiss = 0;
    let firstMiss = "";
    for (let i = 0; i < 1000; i++) {
      const c = i === 0 ? START : randomCurve(r);
      const lamports = BigInt(Math.floor(1e6 + r() * r() * 5e10)); // 0.001 to 50 SOL, small sizes likelier
      const want = BigInt(sdk.getBuyTokenAmountFromSolAmount!(args(c, lamports)).toString());
      const got = buyTokens(c, lamports);
      if (want !== got) {
        buyMiss++;
        firstMiss ||= `buy ${lamports} on vSol ${c.vSol}: sdk ${want}, port ${got}`;
      }
    }
    add("1,000 buy quotes equal the SDK", buyMiss === 0, buyMiss ? `${buyMiss} differ; first: ${firstMiss}` : "0 differ");
    for (let i = 0; i < 1000; i++) {
      const c = i === 0 ? START : randomCurve(r);
      const tokens = BigInt(Math.floor(1e9 + r() * r() * Number(c.vTok) * 0.2));
      const want = BigInt(sdk.getSellSolAmountFromTokenAmount!(args(c, tokens)).toString());
      const got = sellSol(c, tokens);
      if (want !== got) {
        sellMiss++;
        firstMiss ||= `sell ${tokens} on vSol ${c.vSol}: sdk ${want}, port ${got}`;
      }
    }
    add("1,000 sell quotes equal the SDK", sellMiss === 0, sellMiss ? `${sellMiss} differ; first: ${firstMiss}` : "0 differ");

    // state moves: the invariant never shrinks, a buy then a sell never pays out more than went in
    let kShrunk = 0;
    let freeMoney = 0;
    for (let i = 0; i < 300; i++) {
      const c = randomCurve(r);
      const lam = BigInt(Math.floor(1e7 + r() * 2e10));
      const b = applyBuy(c, lam);
      const s = applySell(b.curve, b.tokens);
      if (b.curve.vSol * b.curve.vTok < c.vSol * c.vTok || s.curve.vSol * s.curve.vTok < c.vSol * c.vTok - c.vTok) kShrunk++;
      if (s.lamports >= lam) freeMoney++;
    }
    add("the constant product never shrinks across a buy and a sell", kShrunk === 0, `${kShrunk} of 300`);
    add("a round trip always loses to fees", freeMoney === 0, `${freeMoney} of 300 paid out at least what went in`);
    add("a buy never takes more tokens than the curve has", buyTokens({ ...START, realTok: 1000n }, 10_000_000_000n) === 1000n);
    return { checks, metrics: { buys: 1000, sells: 1000, fees_bps: Number(FEES.protocolBps + FEES.creatorBps) } };
  },
};
