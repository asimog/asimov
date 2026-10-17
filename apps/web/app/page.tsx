import { FieldInstrument } from "@/components/field/FieldInstrument";
import { Equity, Markouts, Pool, Positions, Rates, Scores, Tape } from "@/components/hud/Panels";

export default function FieldPage() {
  return (
    <main>
      <FieldInstrument />
      <div className="strip" aria-label="Instrument strip">
        <Tape />
        <Positions />
        <Markouts />
        <Equity />
        <Pool />
        <Scores />
        <Rates />
      </div>
    </main>
  );
}
