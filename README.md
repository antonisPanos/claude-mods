# claude-mods

[Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview): plugins whose
TypeScript hooks run inside Claude Code to draw panes, add commands and react to tool
calls, turns and prompts.

This repository is a plugin marketplace. Each mod lives in its own folder under `mods/`
and is listed in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json).

| Mod | What it does |
| --- | --- |
| [time-tracker](mods/time-tracker) | Tracks how long Claude was active: turns, model generation, tool runs and subagents, per session, per day and in total. |

## Install

In a Claude Code terminal session:

```
/plugin install time-tracker --marketplace antonisPanos/claude-mods
```

Answer `y` to add the marketplace, then pick a scope.

## Layout

```
.claude-plugin/marketplace.json   lists every mod in mods/
mods/<name>/
  .claude-plugin/plugin.json      the mod's manifest
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              the hooks module: export const register: Register
  types/index.d.ts                the mod's $.state contract (when it keeps state)
  tests/*.test.ts                 run with `claude plugin test mods/<name>`
```

`.claude-plugin/types/` inside a mod is written by Claude Code each time it loads the mod
and is git-ignored.

## Developing a mod

Load a mod from its folder for one session (edits hot-reload):

```bash
claude --plugin-dir ./mods/time-tracker
```

Or add this checkout as a local marketplace, so `/reload-plugins` re-reads your edits:

```bash
claude plugin marketplace add ./
```

Before committing:

```bash
claude plugin validate mods/time-tracker
```

```bash
claude plugin test mods/time-tracker
```

To add a mod, create `mods/<name>/` with the files above and add an entry to
`.claude-plugin/marketplace.json` with `"source": "./mods/<name>"`.
