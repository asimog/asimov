// pump.fun NATS over WebSocket with the public web-client subscriber credentials.
import { type NatsConnection, type Subscription, wsconnect } from "@nats-io/nats-core";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";

export type Which = "trades" | "feed";

/** `onGap(fromMs, toMs)` runs on every reconnect with the interval the connection was down (docs/07 coverage). */
export async function natsConnect(which: Which, now: () => number, onGap: (fromMs: number, toMs: number) => void): Promise<NatsConnection> {
  const servers = which === "trades" ? env.str("PUMP_NATS_TRADES_URL") : env.str("PUMP_NATS_FEED_URL");
  const pass = which === "trades" ? env.str("PUMP_NATS_PASS") : env.str("PUMP_NATS_FEED_PASS");
  const nc = await wsconnect({
    servers,
    user: env.str("PUMP_NATS_USER", "subscriber"),
    pass,
    name: `asimog-${which}`,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2000,
    pingInterval: 20_000,
  });
  void (async () => {
    let down: number | null = null;
    for await (const s of nc.status()) {
      log.info("nats status", { which, type: s.type });
      if (s.type === "disconnect" && down == null) down = now();
      if (s.type === "reconnect" && down != null) {
        onGap(down, now());
        down = null;
      }
    }
  })();
  return nc;
}

/** NATS payloads are often a JSON string containing JSON. */
export function decodeJson(data: Uint8Array): unknown {
  let v: unknown = JSON.parse(new TextDecoder().decode(data));
  if (typeof v === "string") v = JSON.parse(v);
  return v;
}

export async function consume(sub: Subscription, fn: (subject: string, data: Uint8Array) => void) {
  for await (const m of sub) {
    try {
      fn(m.subject, m.data);
    } catch (err) {
      log.warn("nats handler", { subject: m.subject, err: String(err) });
    }
  }
}
