"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Hud } from "@/components/hud/Hud";
import { useLive } from "@/lib/live";
import type { LabelSlot } from "./FieldScene";

// The WebGL chunk loads after first paint (docs/19 budget); the HUD and strip are real data from the first frame.
const FieldScene = dynamic(() => import("./FieldScene"), { ssr: false });
const LABELS = 12;

export function FieldInstrument() {
  const labels = useRef<LabelSlot[]>(Array.from({ length: LABELS }, (_, slot) => ({ el: null, slot })));
  const [mobile, setMobile] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const coins = useLive((s) => s.coins.size);
  const last = useLive((s) => s.lines.at(-1));

  useEffect(() => {
    setMobile(window.matchMedia("(max-width: 760px)").matches);
    const c = document.createElement("canvas");
    setWebgl(!!(c.getContext("webgl2") ?? c.getContext("webgl")));
  }, []);

  return (
    <section className="field" aria-label="The Field: every watched coin as a cloud of light, the firm at the centre">
      <div className="field-stage">
        {webgl ? <FieldScene labels={labels} mobile={mobile} /> : <p className="empty field-fallback">This browser has no WebGL. Every number below is still live.</p>}
        <div className="field-labels" aria-hidden="true">
          {labels.current.map((l, i) => (
            <span key={i} ref={(el) => void (l.el = el)} className="field-label mono" />
          ))}
        </div>
        <div className="field-thesis">
          <h1>An autonomous firm, trading Pump.fun callouts in public.</h1>
          <p>
            Each cloud is a coin the firm watches. Light falls in when someone calls it; a line runs from the core when the firm holds it. Nothing here moves
            unless something happened.
          </p>
          <p className="micro">
            {coins} coins in view{last ? <> · latest: <span className="mono">{last.text}</span></> : null}
          </p>
        </div>
        <Hud />
        <p className="field-hint micro">Drag to turn</p>
      </div>
    </section>
  );
}
