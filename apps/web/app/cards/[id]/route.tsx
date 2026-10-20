// Share card (docs/UI.md): a 1200 x 630 PNG for one callout. It names no caller. Colours are the dark world's.
import { ImageResponse } from "next/og";

import { RELAY } from "@/lib/relay";

const C = { ground: "#16120e", panel: "#211b15", line: "#3a3228", bone: "#ece6da", soft: "#9a917f", amber: "#e6b450", crimson: "#c8503c" };

type Card = { sym: string; mcap_usd: number | null; age_min: number | null; signals: { label: string; value: string }[]; net_multiple: number | null; ref_sol: number; ladder: string | null; commit: string | null; position: string };

const k = (v: number | null) => (v == null ? "n/a" : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await fetch(`${RELAY}/v1/card/${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(5000) }).catch(() => null); // a hung relay fails the card, never hangs it
  if (!res) return new Response("relay unreachable", { status: 503 });
  if (!res.ok) return new Response("no such card", { status: 404 });
  const c = (await res.json()) as Card;
  const up = (c.net_multiple ?? 0) >= 1;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.ground, color: C.bone, padding: 56, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", color: C.soft, fontSize: 24, letterSpacing: 4 }}>
          <span>ASIMOG · PAPER</span>
          <span>{c.commit ? `commit ${c.commit}` : "no commit"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 28 }}>
          <span style={{ fontSize: 112, fontWeight: 700, color: C.amber }}>{c.sym}</span>
          <span style={{ fontSize: 30, color: C.soft, marginLeft: 32 }}>
            called at {k(c.mcap_usd)}{c.age_min != null ? `, ${c.age_min < 1 ? "first mention" : `${Math.round(c.age_min)} min after the first mention`}` : ""}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 28 }}>
          {(c.signals ?? []).slice(0, 4).map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", background: C.panel, border: `1px solid ${C.line}`, padding: "14px 22px", marginRight: 16, marginBottom: 16, minWidth: 250 }}>
              <span style={{ fontSize: 22, color: C.soft }}>{s.label}</span>
              <span style={{ fontSize: 44, fontWeight: 700 }}>{s.value}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexGrow: 1 }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 24, color: C.soft, maxWidth: 700 }}>
            <span>House position: {c.position}</span>
            <span style={{ marginTop: 6 }}>{c.ladder ? `Exit plan: ${c.ladder}` : "Exit plan: none written"}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontSize: 22, color: C.soft }}>5 min, {c.ref_sol} SOL reference, after costs</span>
            <span style={{ fontSize: 84, fontWeight: 700, color: up ? C.amber : C.crimson }}>{c.net_multiple == null ? "n/a" : `${c.net_multiple.toFixed(2)}x`}</span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
