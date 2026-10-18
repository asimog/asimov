<template>
  <!-- Deep-space background — global, sits behind every route.
       Ported from the marketing site (miroshark.xyz). -->
  <div class="space-bg" aria-hidden></div>
  <div class="space-stars" aria-hidden></div>

  <router-view />
  <SiteFooter v-if="showFooter" />
  <DebugPanel />
  <ZhWarningBanner />
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import DebugPanel from './components/DebugPanel.vue'
import ZhWarningBanner from './components/ZhWarningBanner.vue'
import SiteFooter from './components/SiteFooter.vue'

const route = useRoute()
// Footer everywhere except the embeddable widget, which must stay chrome-free.
const showFooter = computed(() => route.name !== 'Embed')
</script>

<style>
/* ═══════════════════════════════════════════════════════════
   MIROSHARK DESIGN SYSTEM — Deep Space + Chrome
   Ported from the marketing site (miroshark.xyz):
   violet nebula background, chrome-metal text, glossy panels,
   glossy metal pill buttons. Geist everywhere.
   ═══════════════════════════════════════════════════════════ */

:root {
  /* ── Brand palette (space-violet) ──
     Legacy token NAMES kept so every scoped <style> that already
     references them inherits the new palette automatically.
       --color-orange  →  bright violet accent
       --color-green   →  soft violet (positive / "yes")
       --color-white   →  deep glossy-panel base
       --color-black   →  light foreground text
       --color-gray    →  panel-on-panel surface
       --color-red     →  soft fuchsia for warnings
   */
  --color-orange: #a78bfa;
  --color-green:  #c4b5fd;
  --color-white:  #110a26;
  --color-black:  #f4f1ff;
  --color-gray:   #1a0f3a;
  --color-amber:  #fcd34d;
  --color-red:    #f0abfc;

  /* Site accent tokens (match website globals.css) */
  --accent: #8b5cf6;
  --accent-bright: #a78bfa;
  --accent-deep: #4c1d95;

  /* Page-level background — deep space. */
  --background: #05030a;
  --foreground: #f4f1ff;

  /* ── 1.4x Modular Spacing Scale ── */
  --space-xs: 6px;
  --space-sm: 11px;
  --space-md: 22px;
  --space-lg: 34px;
  --space-xl: 56px;
  --space-2xl: 84px;

  /* ── Borders ── */
  --border-light: 1px solid rgba(255,255,255,0.08);
  --border-medium: 1px solid rgba(255,255,255,0.12);
  --border-orange: 2px solid var(--color-orange);
  --border-green: 2px solid var(--color-green);

  /* ── Transitions ── */
  --transition-fast: all 0.1s ease;
  --transition-medium: all 0.2s ease;

  /* ── Fonts — Geist, matching the website ──
     (Young Serif / Space Mono retired; tokens repointed so the
     whole app picks up Geist without touching 400+ call sites.) */
  --font-sans:    'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-display: 'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono:    'Geist Mono', ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
}

/* ── Reset ── */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  font-family: var(--font-sans), Arial, Helvetica, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: var(--foreground);
  background-color: var(--background);
}

/* ═══ Deep-space background — global, every route ═══ */
.space-bg {
  position: fixed;
  inset: 0;
  z-index: -2;
  pointer-events: none;
  background:
    radial-gradient(ellipse 55% 45% at 50% 30%, rgba(139, 92, 246, 0.55), transparent 65%),
    radial-gradient(ellipse 70% 50% at 50% 50%, rgba(76, 29, 149, 0.45), transparent 70%),
    radial-gradient(ellipse 40% 30% at 15% 75%, rgba(56, 30, 110, 0.55), transparent 70%),
    radial-gradient(ellipse 35% 30% at 85% 25%, rgba(150, 80, 230, 0.35), transparent 70%),
    linear-gradient(180deg, #050210 0%, #0a0420 45%, #06021a 80%, #02010a 100%);
}

.space-stars {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-image:
    radial-gradient(1px 1px at 12% 18%, rgba(255, 255, 255, 1), transparent 50%),
    radial-gradient(1px 1px at 78% 9%, rgba(255, 255, 255, 0.9), transparent 50%),
    radial-gradient(1.5px 1.5px at 33% 72%, rgba(255, 255, 255, 1), transparent 50%),
    radial-gradient(1px 1px at 62% 38%, rgba(220, 220, 255, 0.85), transparent 50%),
    radial-gradient(1px 1px at 88% 56%, rgba(255, 255, 255, 0.95), transparent 50%),
    radial-gradient(1.5px 1.5px at 22% 88%, rgba(255, 240, 255, 0.75), transparent 50%),
    radial-gradient(1px 1px at 7% 42%, rgba(255, 255, 255, 0.65), transparent 50%),
    radial-gradient(1px 1px at 49% 14%, rgba(255, 255, 255, 1), transparent 50%),
    radial-gradient(1px 1px at 92% 82%, rgba(255, 255, 255, 0.75), transparent 50%),
    radial-gradient(1.5px 1.5px at 41% 51%, rgba(255, 255, 255, 0.65), transparent 50%),
    radial-gradient(1px 1px at 67% 91%, rgba(220, 220, 255, 0.75), transparent 50%),
    radial-gradient(1px 1px at 17% 63%, rgba(255, 255, 255, 0.65), transparent 50%),
    radial-gradient(1px 1px at 55% 78%, rgba(255, 255, 255, 0.8), transparent 50%),
    radial-gradient(1px 1px at 73% 24%, rgba(255, 255, 255, 0.7), transparent 50%),
    radial-gradient(1px 1px at 38% 28%, rgba(255, 255, 255, 0.85), transparent 50%),
    radial-gradient(1px 1px at 96% 38%, rgba(255, 255, 255, 0.7), transparent 50%),
    radial-gradient(1px 1px at 3% 76%, rgba(255, 255, 255, 0.6), transparent 50%);
  background-size: 100% 100%;
  animation: twinkle 6s ease-in-out infinite alternate;
}

/* ── Text Selection ── */
::selection {
  background: var(--accent);
  color: #ffffff;
}
::-moz-selection {
  background: var(--accent);
  color: #ffffff;
}

/* ── Scrollbar — violet on dark ── */
::-webkit-scrollbar {
  width: 11px;
  height: 11px;
}
::-webkit-scrollbar-track {
  background: rgba(10, 6, 26, 0.6);
}
::-webkit-scrollbar-thumb {
  background: rgba(167, 139, 250, 0.35);
  border-radius: 9999px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(167, 139, 250, 0.55);
}

/* ── Global Button Base ── */
button {
  font-family: var(--font-sans);
  cursor: pointer;
  /* House style is the fully-rounded pill. This is only a DEFAULT — any
     button whose own class sets a border-radius overrides it (higher
     specificity), so deliberately-shaped buttons keep their radius while
     the legacy sharp-cornered ones become pills like everything else. */
  border-radius: 9999px;
}

/* Selects share the rounded pill look so dropdowns match the buttons.
   (Default only — a class with its own radius still wins.) */
select {
  border-radius: 9999px;
}

/* Clean, consistent focus: no jarring ring on mouse click; a tasteful
   violet ring for keyboard navigation only. */
button:focus,
a:focus,
input:focus,
select:focus,
textarea:focus {
  outline: none;
}
/* Buttons / links: a crisp keyboard-only ring. */
button:focus-visible,
a:focus-visible {
  outline: 2px solid rgba(167, 139, 250, 0.7);
  outline-offset: 2px;
}
/* Form fields: a soft inset-style glow that hugs the rounded border
   instead of a hard offset ring (which read as a weird double border on
   the pill-shaped selects). */
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.28);
  border-color: rgba(167, 139, 250, 0.7) !important;
}

/* ── Text Opacity Scale (light-on-dark) ── */
.text-primary-100 { color: #ffffff; }
.text-primary-70 { color: rgba(244, 241, 255, 0.85); }
.text-primary-50 { color: rgba(228, 222, 255, 0.7); }
.text-primary-40 { color: rgba(228, 222, 255, 0.6); }
.text-primary-35 { color: rgba(228, 222, 255, 0.5); }

/* ── Warning Stripes Divider ── */
.warning-stripes {
  height: 7px;
  background: repeating-linear-gradient(
    -45deg,
    var(--color-orange),
    var(--color-orange) 11px,
    var(--color-white) 11px,
    var(--color-white) 22px
  );
}

/* ── Background Grid (violet) ── */
.bg-grid {
  background-image:
    linear-gradient(rgba(167, 139, 250, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(167, 139, 250, 0.05) 1px, transparent 1px);
  background-size: 70px 70px;
}

/* ═══════════════════════════════════════════════════════════
   REUSABLE COMPONENTS — ported 1:1 from website globals.css
   Available to every view (chrome text, glossy panel, metal
   pills, chips, orbs, dividers).
   ═══════════════════════════════════════════════════════════ */

/* Chrome metallic display text */
.chrome-text {
  background: linear-gradient(
    180deg,
    #ffffff 0%, #e9e9f5 15%, #b9b9cc 32%, #6e6e85 50%,
    #c8c8dc 68%, #ffffff 85%, #d6d6e8 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-stroke: 1px rgba(255, 255, 255, 0.15);
  filter:
    drop-shadow(0 1px 0 rgba(255, 255, 255, 0.4))
    drop-shadow(0 4px 12px rgba(167, 139, 250, 0.35))
    drop-shadow(0 16px 32px rgba(0, 0, 0, 0.6));
  letter-spacing: -0.04em;
  position: relative;
}
.chrome-text::after {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 30%, rgba(255, 255, 255, 0.85) 50%, transparent 70%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  background-size: 200% 100%;
  animation: chrome-shimmer 5s linear infinite;
  mix-blend-mode: screen;
  pointer-events: none;
}

.chrome-text-sm {
  background: linear-gradient(180deg, #ffffff 0%, #e2dcf6 50%, #b9b0d8 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.5));
  letter-spacing: -0.01em;
}

.chrome-h2 {
  background: linear-gradient(180deg, #ffffff 0%, #e2dcf6 55%, #a99fc8 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.55));
  letter-spacing: -0.015em;
}

/* Floating animation */
.float { animation: float 6s ease-in-out infinite; }

/* Glossy panel */
.glossy-panel {
  position: relative;
  border-radius: 1.5rem;
  padding: 1.5rem;
  background: linear-gradient(180deg, rgba(40, 30, 70, 0.65) 0%, rgba(18, 12, 38, 0.75) 100%);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -1px 0 rgba(0, 0, 0, 0.45),
    0 16px 40px -16px rgba(0, 0, 0, 0.8),
    0 0 60px -20px rgba(139, 92, 246, 0.25);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  overflow: hidden;
  isolation: isolate;
  transition: transform 250ms ease, box-shadow 250ms ease;
}
.glossy-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.02) 30%, transparent 60%);
  pointer-events: none;
}
.glossy-panel:hover {
  transform: translateY(-2px);
  box-shadow:
    0 0 0 1px rgba(167, 139, 250, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    inset 0 -1px 0 rgba(0, 0, 0, 0.45),
    0 20px 48px -16px rgba(0, 0, 0, 0.85),
    0 0 80px -16px rgba(139, 92, 246, 0.45);
}

/* Purple CTA pill */
.metal-cta {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  height: 56px;
  padding: 0 1.75rem;
  border-radius: 9999px;
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: #f8f5ff;
  border: none;
  background: linear-gradient(180deg, #6a4ad6 0%, #4922b8 45%, #2a118a 55%, #4f2dc4 100%);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    inset 0 -1px 0 rgba(0, 0, 0, 0.5),
    0 14px 32px -8px rgba(139, 92, 246, 0.6),
    0 0 60px -10px rgba(167, 139, 250, 0.5),
    0 2px 0 rgba(0, 0, 0, 0.4);
  transition: transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 200ms ease, background 200ms ease;
  overflow: hidden;
  isolation: isolate;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
}
.metal-cta::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0.08) 40%, transparent 55%);
  pointer-events: none;
}
.metal-cta:hover {
  transform: translateY(-2px);
  background: linear-gradient(180deg, #7d5ee8 0%, #5728d4 45%, #3414a3 55%, #5e3bde 100%);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    inset 0 -1px 0 rgba(0, 0, 0, 0.5),
    0 22px 44px -10px rgba(139, 92, 246, 0.75),
    0 0 80px -10px rgba(167, 139, 250, 0.7),
    0 2px 0 rgba(0, 0, 0, 0.4);
}
.metal-cta:active { transform: translateY(0); }

/* Glossy metallic icon / secondary pill */
.metal-btn,
.docs-pill,
.nav-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  color: #f4f1ff;
  background: linear-gradient(180deg, #4a4360 0%, #2a2440 45%, #18132a 55%, #3a3450 100%);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    inset 0 -1px 0 rgba(0, 0, 0, 0.6),
    0 10px 24px -8px rgba(0, 0, 0, 0.8),
    0 2px 0 rgba(0, 0, 0, 0.4);
  transition: transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 200ms ease, background 200ms ease;
  overflow: hidden;
  isolation: isolate;
  border: none;
}
.metal-btn {
  height: 56px;
  width: 56px;
  border-radius: 9999px;
}
.docs-pill {
  height: 56px;
  padding: 0 1.5rem;
  border-radius: 9999px;
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
}
.nav-pill {
  height: 36px;
  padding: 0 0.9rem;
  border-radius: 9999px;
  font-size: 0.82rem;
  font-weight: 600;
  gap: 0.45rem;
}
.metal-btn::before,
.docs-pill::before,
.nav-pill::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.35) 0%, rgba(255, 255, 255, 0.06) 38%, transparent 50%);
  pointer-events: none;
}
.metal-btn:hover,
.docs-pill:hover,
.nav-pill:hover {
  transform: translateY(-2px);
  background: linear-gradient(180deg, #5a5275 0%, #312a48 45%, #1d1734 55%, #463e60 100%);
  box-shadow:
    0 0 0 1px rgba(167, 139, 250, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    inset 0 -1px 0 rgba(0, 0, 0, 0.6),
    0 16px 32px -8px rgba(139, 92, 246, 0.5),
    0 2px 0 rgba(0, 0, 0, 0.4);
}
.metal-btn:active,
.docs-pill:active,
.nav-pill:active { transform: translateY(0); }

/* Eyebrow chip */
.chrome-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  height: 34px;
  padding: 0 1rem;
  border-radius: 9999px;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #e9e6ff;
  background: linear-gradient(180deg, rgba(80, 60, 140, 0.5) 0%, rgba(28, 18, 58, 0.7) 100%);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    inset 0 -1px 0 rgba(0, 0, 0, 0.4),
    0 8px 24px -8px rgba(139, 92, 246, 0.4);
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
}
.chrome-chip::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: radial-gradient(circle at 30% 30%, #ffffff 0%, #a78bfa 60%, #4c1d95 100%);
  box-shadow: 0 0 8px rgba(167, 139, 250, 0.9), 0 0 16px rgba(139, 92, 246, 0.6);
}

/* Bullet orb */
.bullet-orb {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 9999px;
  background: radial-gradient(circle at 30% 30%, #ffffff 0%, #c4b5fd 35%, #8b5cf6 65%, #4c1d95 100%);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.2),
    0 0 12px rgba(167, 139, 250, 0.9),
    0 0 24px rgba(139, 92, 246, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

/* Metal divider */
.metal-rule {
  width: 100%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(167, 139, 250, 0.4) 20%,
    rgba(255, 255, 255, 0.5) 50%,
    rgba(167, 139, 250, 0.4) 80%,
    transparent 100%
  );
  box-shadow: 0 0 16px rgba(167, 139, 250, 0.3);
}

/* ── Animations ── */
@keyframes fade-in {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes shimmer {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

@keyframes chrome-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -100% 0; }
}

@keyframes twinkle {
  from { opacity: 0.55; }
  to { opacity: 1; }
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

@keyframes pulse-border {
  0%, 100% { border-color: var(--color-orange); }
  50% { border-color: var(--color-green); }
}

@keyframes scan {
  0%, 100% { transform: translateY(-50px); opacity: 0; }
  10% { opacity: 0.6; }
  50% { transform: translateY(50px); opacity: 0.6; }
  90% { opacity: 0.6; }
}

.animate-fade-in { animation: fade-in 0.5s ease-out; }
.animate-shimmer { animation: shimmer 2s ease-in-out infinite; }
.animate-pulse-border { animation: pulse-border 2s ease-in-out infinite; }
</style>
