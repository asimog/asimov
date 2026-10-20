"use client";
// The server's snapshot, in the store before the first paint, so the Field opens on real numbers instead of placeholders.
import { useRef } from "react";
import { applySnapshot, type Snapshot, useLive } from "@/lib/live";

export function SeedSnapshot({ snap }: { snap: Snapshot | null }) {
  const seeded = useRef(false);
  if (!seeded.current && snap && !useLive.getState().snap) applySnapshot(snap);
  seeded.current = true;
  return null;
}
