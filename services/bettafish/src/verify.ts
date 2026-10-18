// Claim verify (docs/07: "every claim goes through verify against its cited callout; unsupported claims are dropped").
// Deterministic stand-in for the Jev `verify` pack: the cited callouts must exist in the window, belong to the coin the
// claim is about, and share a content word or the ticker with the claim. Core repeats the existence and coin checks.
export type Callout = { callout_id: string; mint: string; symbol: string | null; wallet: string; text: string; created_at: string; hot?: number };

const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9$]{4,}/g) ?? []).map((w) => w.replace(/^\$/, "")));

export function supported(claim: string, cites: string[], byId: Map<string, Callout>, mint?: string): boolean {
  if (!cites.length) return false;
  const cs: Callout[] = [];
  for (const id of cites) {
    const c = byId.get(id);
    if (!c || (mint && c.mint !== mint)) return false;
    cs.push(c);
  }
  const cw = words(claim);
  return cs.some((c) => (c.symbol && cw.has(c.symbol.toLowerCase())) || [...words(c.text)].some((w) => cw.has(w)));
}
