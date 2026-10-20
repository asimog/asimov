"use client";
// Connectome Lab (S11.3): the fruit-fly sleeve. Nothing trades yet, so the room shows a static stand-in shape, labelled
// SIMULATED, and the real count of fly events. Spikes would appear only for `fly.action` events.
import { useEffect, useRef } from "react";
import { useRoom } from "@/lib/live";

type Connectome = { fly_events: number; state: string };

/** A fixed, seeded cloud in the rough shape of a fly brain: two lobes and a central body. Not the real connectome. */
function Cloud() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const W = (c.width = 900);
    const H = (c.height = 520);
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    g.fillStyle = "oklch(0.8 0.13 75 / 0.55)";
    for (let i = 0; i < 2400; i++) {
      const lobe = rnd() < 0.42 ? -1 : rnd() < 0.72 ? 1 : 0;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd());
      const x = W / 2 + lobe * 190 + Math.cos(a) * r * (lobe ? 150 : 70);
      const y = H / 2 + Math.sin(a) * r * (lobe ? 190 : 120) + (lobe ? 0 : 30);
      g.fillRect(x, y, 1.6, 1.6);
    }
  }, []);
  return <canvas ref={ref} className="connectome-cloud" role="img" aria-label="A stand-in point cloud shaped like two brain lobes. SIMULATED, not the real connectome." />;
}

export default function ConnectomePage() {
  const { data, error } = useRoom<Connectome>("/v1/connectome", 15_000);
  return (
    <main className="room">
      <header className="room-head">
        <div>
          <h1>A fly brain, on a leash of 1%.</h1>
          <p>The plan: a simulated fruit-fly brain sends buy and sell signals from the same data the strategies read, and trades 1% of the firm's money. It is not built yet, so nothing below is moving.</p>
        </div>
        <dl className="room-kpis">
          <div className="hot"><dt className="micro">Fly events</dt><dd className="num">{data?.fly_events ?? "·"}</dd></div>
          <div><dt className="micro">State</dt><dd className="num">{data?.state ?? "·"}</dd></div>
        </dl>
      </header>
      {error && !data ? <p className="empty">The relay is unreachable ({error}).</p> : null}
      {error && data ? <p className="micro">Stale: the relay stopped answering ({error}); these numbers are from its last answer.</p> : null}
      <section className="room-section" aria-label="Stand-in cloud">
        <h2 className="micro"><span className="chip" data-tone="stress">SIMULATED</span> stand-in shape, not the real connectome</h2>
        <Cloud />
        <p className="empty">Points light only when a fly.action event arrives. There have been none, so nothing here moves. The sleeve will trade on paper first, then at 1% of capital.</p>
      </section>
    </main>
  );
}
