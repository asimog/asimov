"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Panel, Tape } from "@/components/hud/Panels";
import { fmt, LANES, type Lane, useLive } from "@/lib/live";

const CortexScene = dynamic(() => import("@/components/cortex/CortexScene"), { ssr: false });

const NAMES: Record<Lane, { name: string; does: string }> = {
  sense: { name: "Sense", does: "Feed Reader, Scout, Chain Reader, Backfill" },
  analyze: { name: "Analyze", does: "Scores, markouts, Index refreshes" },
  reflex: { name: "Reflex", does: "Jev reads each callout" },
  decide: { name: "Decide", does: "Strategy pool, kernel, evolution" },
  risk: { name: "Risk", does: "Risk Gate refusals" },
  execute: { name: "Execute", does: "Paper fills and closes" },
  publish: { name: "Publish", does: "Theses, callouts, replies under held coins" },
  memory: { name: "Memory", does: "Commits and reveals" },
  treasury: { name: "Treasury", does: "Sweeps and proofs (from S6)" },
  counsel: { name: "Counsel", does: "Waits for the human counsel" },
};

export default function CortexPage() {
  const labels = useRef<(HTMLElement | null)[]>([]);
  const [mobile, setMobile] = useState(false);
  const lanes = useLive((s) => s.lanes);
  const snap = useLive((s) => s.snap);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setMobile(window.matchMedia("(max-width: 760px)").matches);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const active = LANES.filter((l) => now - lanes[l].at < 10_000).length;

  return (
    <main>
      <section className="cortex-stage" aria-label="The Cortex: the firm's lanes as lobes of a brain">
        <CortexScene labels={labels} mobile={mobile} />
        <div className="cortex-labels" aria-hidden="true">
          {LANES.map((l, k) => (
            <span key={l} ref={(el) => void (labels.current[k] = el)} className="cortex-label micro">
              {NAMES[l].name}
            </span>
          ))}
        </div>
        <header className="cortex-head">
          <h1>What the firm is doing right now.</h1>
          <p>Each lobe is one lane of the firm. It lights while that lane writes to the Tape and goes dark when it stops.</p>
          <dl className="room-kpis">
            <div className="hot"><dt className="micro">Lanes active, 10 s</dt><dd className="num">{active}/{LANES.length}</dd></div>
            <div><dt className="micro">Waits for counsel</dt><dd className="num">{snap?.counsel_queue ?? "·"}</dd></div>
          </dl>
        </header>
      </section>
      <div className="strip">
        <Panel title="Lanes">
          <table className="mini">
            <thead><tr><th scope="col">Lane</th><th scope="col">Events</th><th scope="col">Last</th></tr></thead>
            <tbody>
              {LANES.map((l) => (
                <tr key={l} data-lit={now - lanes[l].at < 2000 ? "yes" : "no"}>
                  <th scope="row"><span className="mono">{NAMES[l].name}</span> <span className="lane-does">{NAMES[l].does}</span></th>
                  <td className="num">{lanes[l].n}</td>
                  <td className="num">{lanes[l].at ? fmt.ago(now - lanes[l].at) : "·"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Latest per lane">
          <ul className="lane-last">
            {LANES.filter((l) => lanes[l].text).map((l) => (
              <li key={l}><span className="micro">{NAMES[l].name}</span><span>{lanes[l].text}</span></li>
            ))}
            {!LANES.some((l) => lanes[l].text) ? <li className="empty">Lanes report here as events arrive on the stream.</li> : null}
          </ul>
        </Panel>
        <Tape max={30} />
      </div>
    </main>
  );
}
