@AGENTS.md

## Claude Code notes

- `AGENTS.md` is the map: the thesis, the repo map, how to add a module, the rules. Start there; open a doc only when the task touches it.
- `.upstream/` is skipped by default searches; use `rg --no-ignore --hidden` when you mean to look there.
- Before saying done on code: `npx tsc -p services/core --noEmit`, then `ponytail-review` on the diff.
