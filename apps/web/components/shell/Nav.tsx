"use client";
// The instrument bar: wordmark, the instruments, and the live state of the stream.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { fmt, startLive, useLive } from "@/lib/live";

const ROOMS = [
  { href: "/", label: "Field" },
  { href: "/cortex", label: "Cortex" },
  { href: "/lab", label: "Lab" },
  { href: "/ledger", label: "Ledger" },
  { href: "/integrity", label: "Integrity" },
  { href: "/treasury", label: "Treasury" },
  { href: "/rewind", label: "Rewind" },
  { href: "/connectome", label: "Connectome" },
  { href: "/charter", label: "Charter" },
] as const;

export function Nav() {
  const path = usePathname();
  const connected = useLive((s) => s.connected);
  const last = useLive((s) => s.lastEventAt);
  const error = useLive((s) => s.error);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => startLive(), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const age = last ? now - last : null;
  const state = error && !connected ? "relay unreachable" : !connected ? "connecting" : age == null ? "waiting for the first event" : `last event ${fmt.ago(age)} ago`;

  return (
    <header className="nav">
      <Link href="/" className="wordmark" aria-label="Asimog, the Field">
        <Glyph />
        <span>ASIMOG</span>
      </Link>
      <nav aria-label="Instruments">
        <ul>
          {ROOMS.map((r) => (
            <li key={r.href}>
              <Link href={r.href} aria-current={path === r.href ? "page" : undefined} className="micro">
                {r.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p className="live micro" role="status" aria-live="polite">
        <span className="live-mark" data-on={connected && age != null && age < 10_000 ? "yes" : "no"} aria-hidden="true" />
        {state}
      </p>
    </header>
  );
}

/** The mark: a point cloud reduced to seven points around a core. Hairline, cap height. */
function Glyph() {
  const pts = [
    [5, 2], [9, 3.5], [10.5, 8], [8, 11.5], [3.5, 11], [1.5, 6.5], [4, 4.5],
  ];
  return (
    <svg viewBox="0 0 12 13" width="14" height="15" aria-hidden="true">
      {pts.map(([x, y], i) => (
        <line key={i} x1="6" y1="7" x2={x} y2={y} stroke="currentColor" strokeWidth="0.5" opacity="0.5" />
      ))}
      {pts.map(([x, y], i) => (
        <circle key={`p${i}`} cx={x} cy={y} r="0.9" fill="currentColor" />
      ))}
      <circle cx="6" cy="7" r="1.5" fill="none" stroke="currentColor" strokeWidth="0.6" />
    </svg>
  );
}
