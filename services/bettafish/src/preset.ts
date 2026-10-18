// BettaFish presets by env (docs/07 knobs). A preset sets the defaults; every knob can be overridden on its own.
export type Preset = {
  name: "nano" | "lite" | "full";
  engines: string[];
  forumRounds: number;
  hostEveryN: number;
  report: "signals" | "short" | "full";
  feedEveryMin: number;
};

const BASE: Record<Preset["name"], Omit<Preset, "name">> = {
  nano: { engines: ["insight"], forumRounds: 0, hostEveryN: 0, report: "signals", feedEveryMin: 60 },
  lite: { engines: ["insight", "query"], forumRounds: 2, hostEveryN: 5, report: "short", feedEveryMin: 30 },
  full: { engines: ["insight", "query", "media"], forumRounds: 4, hostEveryN: 5, report: "full", feedEveryMin: 15 },
};

export function presetFromEnv(e: NodeJS.ProcessEnv = process.env): Preset {
  const name = (["nano", "lite", "full"] as const).find((n) => n === (e.BETTAFISH_PRESET ?? "lite")) ?? "lite";
  const b = BASE[name];
  const num = (k: string, d: number) => (e[k] === undefined || e[k] === "" ? d : Number(e[k]));
  return {
    name,
    engines: e.BETTAFISH_ENGINES ? e.BETTAFISH_ENGINES.split(",").map((s) => s.trim()).filter(Boolean) : b.engines,
    forumRounds: num("BETTAFISH_FORUM_ROUNDS", b.forumRounds),
    hostEveryN: e.BETTAFISH_HOST_EVERY_N === "off" ? 0 : num("BETTAFISH_HOST_EVERY_N", b.hostEveryN),
    report: (e.BETTAFISH_REPORT as Preset["report"]) ?? b.report,
    feedEveryMin: num("BETTAFISH_FEED_EVERY_MIN", b.feedEveryMin),
  };
}

/** Engines that exist. The others are named by presets and skipped until their senses exist (docs/07). */
export const IMPLEMENTED = ["insight"];
