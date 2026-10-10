/** Time spent in one tool, summed over its calls. */
export type ToolTime = { calls: number; ms: number }

/** Everything the tracker sums up, for a session, a day or all time. */
export type Totals = {
  /** Wall-clock time the session was open. */
  wallMs: number
  /** Wall-clock time of main-loop turns: prompt in to final answer. */
  activeMs: number
  /** Time model requests spent streaming a response, every loop summed. */
  generationMs: number
  /** Time tools spent running, summed (parallel calls each count). */
  toolMs: number
  /** Wall-clock time of subagent runs, summed. */
  subagentMs: number
  turns: number
  interruptedTurns: number
  steps: number
  toolCalls: number
  subagentRuns: number
  tools: Record<string, ToolTime>
}

/** The live session: its totals, and the clock segment it is in now. */
export type SessionClock = {
  /** The session id the totals belong to; null until adopted (a fresh start, after a /clear). */
  id: string | null
  /** When the session was first seen (kept across a resume). */
  startedAt: number
  /** When the current process segment began; wall time since is not yet in totals. */
  segmentStartedAt: number
  /** When the running main-loop turn began; null while idle. */
  turnStartedAt: number | null
  totals: Totals
}

/** Earlier sessions summed, read from the store when the pane opens. */
export type History = { today: Totals; all: Totals; sessions: number; loadedAt: number }

/** What a finished or in-progress session leaves in the store. */
export type SessionRecord = { id: string; startedAt: number; updatedAt: number; totals: Totals }

declare module 'claude-code' {
  interface PluginState {
    'time-tracker': {
      session: SessionClock | null
      history: History | null
      now: number
    }
  }
}
