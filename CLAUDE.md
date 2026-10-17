@AGENTS.md

## Claude Code notes

- Project skills load from `.claude/skills/`. For UI work start with `impeccable`; for motion use `find-animation-opportunities` then `animate`; for 3D use the `r3f-*` skills; for Pump.fun use `swap`, `coin-fees`, `create-coin`; for browsing and E2E site checks use `agent-browser`; for Railway use `use-railway`; for Jev packs use `typesafe-ai` and read the matching cookbook in `.upstream/sites/typesafe/cookbooks/`.
- Write code with the `ponytail` skill's mindset. Review with `ponytail-review` before saying done.
- `.upstream/` (prior-art repos and site mirrors) is skipped by default searches. Use `rg --no-ignore --hidden` when you mean to look there.
