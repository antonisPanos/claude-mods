# time-tracker

A Claude Code mod that tracks how long Claude was active.

## What it tracks

| Measure | How |
| --- | --- |
| Open | Wall-clock time the session was open |
| Claude active | Wall-clock time of each main-loop turn, from prompt to final answer (`turn.complete`'s `durationMs`) |
| Generating | Time each model request spent streaming its response (`turn.step`), summed over the main loop and subagents |
| In tools | Time each tool call took to run (`tool.call`), summed; per-tool breakdown too. `Agent`/`Task` calls are counted under subagents instead |
| In subagents | Wall-clock time of each subagent run |
| Idle | Open minus Claude active |
| Counts | Turns (and how many were interrupted), model requests, tool calls, subagent runs |

Generation and tool times are sums, so parallel tool calls and subagents can add up to
more than the wall clock. A tool call's time can include the wait for your approval when
Claude Code asks for permission.

## Where it shows

- **Status line**: `time: 12m 04s active`, and `time: turn 42s · 12m 04s active` while a turn runs.
- **`/time`**: opens a pane with three columns (this session, today, all time) and the
  slowest tools of the session. Where no pane can be placed, `/time` answers with a text
  summary instead.

## Storage

Each session's totals are written to the mod's store (`$.store`) as `session:<id>` after
every turn and when the session ends. A resumed session keeps adding to its record. "Today"
counts the sessions that started today (local time).

## Develop

```bash
claude --plugin-dir ./mods/time-tracker
```

```bash
claude plugin test mods/time-tracker
```
