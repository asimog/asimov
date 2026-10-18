# Design

The visual world is **Instrument**, defined in `docs/UI.md` (tokens, one dark world, bans) and `docs/UI.md` (instruments, event-to-motion map). This file records how the built site applies it; when they disagree, docs/UI.md wins and this file is fixed.

## One dark world

Every room is dark and uniform (owner, 2026-10-17): warm black ground, bone text, amber for money, positions, live state and the one hot number, crimson for stress, teal only for Cortex lobes.

## Structure

- One dominant form per room, then an instrument strip of equal-height panels (`components/hud/Panels.tsx`) or ruled tables (`.ruled`).
- KPI rows: caps micro-label over a Plex Sans Condensed numeral; at most one numeral in the accent.
- Room heads: one plain sentence as the heading (no eyebrow, no kicker), a short paragraph, KPIs right.

## Type

IBM Plex Mono (labels, data, tape), IBM Plex Sans Condensed (numerals, headings), IBM Plex Sans (body), self-hosted by `next/font`. Brief-pinned by docs/UI.md.

## Motion

- Scene motion only from cues (real events) in `lib/live.ts`: callout → flare and a falling comet; trade → small flare; Jev read → sweep; fill or post → filament flicker; held coin → filament; Scout promotion → flare; commit → Core flare. Idle: breathing only.
- Temperature: the average strategy's paper loss against its floor, amber to crimson, damped over about 1.5 s.
- UI motion: tape lines enter with `@starting-style`; skeletons breathe; no hover motion. Everything inside `prefers-reduced-motion: no-preference`.

## Components

| Piece | File |
|---|---|
| Field (GPU clouds, filaments, comets, projected labels) | `components/field/FieldScene.tsx`, `shaders.ts` |
| Cortex (procedural brain, lobes per lane) | `components/cortex/CortexScene.tsx` |
| Lab arc (commits inward, reveal rays outward) | `app/lab/page.tsx` |
| HUD, strip panels with loading, empty and stale states | `components/hud/` |
| Nav (sets mode, live state), footer, legal shell, Markdown for protected texts | `components/shell/` |

Radius 0 (chips 2 px), no shadows, 1 px rules, 4 px spacing base, 44 px touch targets.
