"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Hud } from "@/components/hud/Hud";
import { graduatedLive, useLive } from "@/lib/live";
import type { Overlay } from "./FieldScene";

// The WebGL chunk loads after first paint (docs/UI.md budget); the HUD and strip are real data from the first frame.
const FieldScene = dynamic(() => import("./FieldScene"), { ssr: false });
const LABELS = 14;
const BOXES = 3;

export function FieldInstrument() {
  const overlay = useRef<Overlay>({ labels: [], boxes: Array.from({ length: BOXES }, () => ({ el: null, line: null })), regions: [] });
  const [mobile, setMobile] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const coins = useLive((s) => s.coins);
  const snap = useLive((s) => s.snap);
  const lines = useLive((s) => s.lines);

  useEffect(() => {
    setMobile(window.matchMedia("(max-width: 760px)").matches);
    const c = document.createElement("canvas");
    setWebgl(!!(c.getContext("webgl2") ?? c.getContext("webgl")));
  }, []);

  const grads = new Set([...(snap?.graduated ?? []), ...graduatedLive]);
  const onCurve = [...coins.keys()].filter((m) => !grads.has(m)).length;
  const graduated = [...coins.keys()].filter((m) => grads.has(m)).length;
  const links = snap?.edges.length ?? 0;
  const calls = lines.filter((l) => l.topic === "callout.created").length;

  return (
    <section className="field" aria-label="The Field: every watched coin as a cloud of light, the firm at the centre">
      <div className="field-stage">
        {webgl ? <FieldScene overlay={overlay} mobile={mobile} /> : <p className="empty field-fallback">This browser has no WebGL. Every number below is still live.</p>}
        <svg className="field-leaders" aria-hidden="true">
          {overlay.current.boxes.map((b, i) => (
            <line key={i} ref={(el) => void (b.line = el)} />
          ))}
        </svg>
        <div className="field-labels" aria-hidden="true">
          {Array.from({ length: LABELS }, (_, i) => (
            <span key={i} ref={(el) => void (overlay.current.labels[i] = el)} className="field-label mono" />
          ))}
          {overlay.current.boxes.map((b, i) => (
            <span key={`b${i}`} ref={(el) => void (b.el = el)} className="field-box mono" />
          ))}
          <span ref={(el) => void (overlay.current.regions[0] = el)} className="field-region micro">
            Region A · on the bonding curve · {onCurve} coins
          </span>
          <span ref={(el) => void (overlay.current.regions[1] = el)} className="field-region micro">
            Region B · graduated to PumpSwap · {graduated} coins
          </span>
        </div>
        <div className="field-thesis">
          <h1>An autonomous firm, trading Pump.fun callouts in public.</h1>
          <p>
            Each cloud is a coin the firm watches; strands join coins that share a caller. Every point of light that moves is a trade, a callout or a
            decision, as it happens.
          </p>
        </div>
        <Hud />
        <dl className="field-legend micro" aria-label="Field legend">
          <div><dt>Field</dt><dd>{snap ? "live" : "loading"}</dd></div>
          <div><dt>Caller links</dt><dd className="num">{links}</dd></div>
          <div><dt>Callouts this visit</dt><dd className="num">{calls}</dd></div>
          <div><dt>Mode</dt><dd>{snap?.mode ?? "·"}</dd></div>
        </dl>
      </div>
    </section>
  );
}
