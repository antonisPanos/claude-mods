import type { SessionClock, Totals } from '../types'

/** Tools whose run is a subagent's: their time is counted under subagents. */
export const AGENT_TOOLS = new Set(['Agent', 'Task'])

export const emptyTotals = (): Totals => ({
  wallMs: 0,
  activeMs: 0,
  generationMs: 0,
  toolMs: 0,
  subagentMs: 0,
  turns: 0,
  interruptedTurns: 0,
  steps: 0,
  toolCalls: 0,
  subagentRuns: 0,
  tools: {},
})

export const addTotals = (a: Totals, b: Totals): Totals => {
  const tools = { ...a.tools }
  for (const [name, time] of Object.entries(b.tools)) {
    const prior = tools[name] ?? { calls: 0, ms: 0 }
    tools[name] = { calls: prior.calls + time.calls, ms: prior.ms + time.ms }
  }

  return {
    wallMs: a.wallMs + b.wallMs,
    activeMs: a.activeMs + b.activeMs,
    generationMs: a.generationMs + b.generationMs,
    toolMs: a.toolMs + b.toolMs,
    subagentMs: a.subagentMs + b.subagentMs,
    turns: a.turns + b.turns,
    interruptedTurns: a.interruptedTurns + b.interruptedTurns,
    steps: a.steps + b.steps,
    toolCalls: a.toolCalls + b.toolCalls,
    subagentRuns: a.subagentRuns + b.subagentRuns,
    tools,
  }
}

export const addToolCall = (totals: Totals, tool: string, ms: number): Totals => {
  const prior = totals.tools[tool] ?? { calls: 0, ms: 0 }

  return {
    ...totals,
    toolCalls: totals.toolCalls + 1,
    toolMs: AGENT_TOOLS.has(tool) ? totals.toolMs : totals.toolMs + ms,
    tools: { ...totals.tools, [tool]: { calls: prior.calls + 1, ms: prior.ms + ms } },
  }
}

/** The session's totals with the open segment's wall time folded in. */
export const liveTotals = (session: SessionClock, now: number): Totals => ({
  ...session.totals,
  wallMs: session.totals.wallMs + Math.max(0, now - session.segmentStartedAt),
})

/** Closes the open segment at `now`, so its wall time is in the totals. */
export const foldSegment = (session: SessionClock, now: number): SessionClock => ({
  ...session,
  segmentStartedAt: now,
  totals: liveTotals(session, now),
})

/** `1h 02m`, `3m 07s`, `42s`, `0s`. */
export const formatDuration = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  if (h > 0) return `${h}h ${pad(m)}m`
  if (m > 0) return `${m}m ${pad(s)}s`
  return `${s}s`
}

/** Local calendar day of a timestamp, `YYYY-MM-DD`. */
export const dayOf = (ms: number): string => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The tools that took longest, longest first. */
export const topTools = (totals: Totals, count: number) =>
  Object.entries(totals.tools)
    .sort(([, a], [, b]) => b.ms - a.ms)
    .slice(0, count)
