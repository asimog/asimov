import { FieldInstrument } from "@/components/field/FieldInstrument";
import { Equity, Markouts, Pool, Positions, Rates, Scores, Tape } from "@/components/hud/Panels";
import { SeedSnapshot } from "@/components/hud/SeedSnapshot";
import type { Snapshot } from "@/lib/live";
import { RELAY } from "@/lib/relay";

export const dynamic = "force-dynamic"; // the snapshot is live: never cached into the build

export default async function FieldPage() {
  // a slow relay must not hold the page: past 1.5 s the page paints and the client loads the snapshot itself
  const snap = (await fetch(`${RELAY}/v1/snapshot`, { cache: "no-store", signal: AbortSignal.timeout(1500) }).then((r) => (r.ok ? r.json() : null), () => null)) as Snapshot | null;
  return (
    <main>
      <SeedSnapshot snap={snap} />
      <FieldInstrument />
      <section className="strip" aria-label="Instrument strip">
        <Tape />
        <Positions />
        <Markouts />
        <Equity />
        <Pool />
        <Scores />
        <Rates />
      </section>
    </main>
  );
}
