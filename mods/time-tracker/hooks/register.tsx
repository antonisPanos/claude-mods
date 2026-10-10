import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { History, SessionClock, SessionRecord, Totals } from '../types'
import {
  addToolCall,
  addTotals,
  dayOf,
  emptyTotals,
  foldSegment,
  formatDuration,
  liveTotals,
  topTools,
} from './totals'

const PANE = 'time-tracker'
const RECORD = 'session:'

const session = atom({ plugin: 'time-tracker', key: 'session' } as const, null)
const history = atom({ plugin: 'time-tracker', key: 'history' } as const, null)
const now = atom({ plugin: 'time-tracker', key: 'now' } as const, 0)

const freshClock = (at: number): SessionClock => ({
  id: null,
  startedAt: at,
  segmentStartedAt: at,
  turnStartedAt: null,
  totals: emptyTotals(),
})

/** Applies `change` to the session's clock, if there is one. */
const touch = ($: EngineInterface, change: (clock: SessionClock) => SessionClock) =>
  update($, session, clock => (clock === null ? clock : change(clock)))

/**
 * Ties the clock to the current session id and writes its record to the store.
 *
 * A clock not yet tied to this id (a fresh start, a /clear, a resume) first
 * takes on whatever the store already holds for the id, so a resumed session
 * keeps counting from where it stopped instead of overwriting its record.
 */
const flush = async ($: EngineInterface) => {
  const id = await $.session.id()
  const at = await $.clock.now()
  const held = await read($, session)
  const prior =
    held !== null && held.id !== id
      ? ((await $.store.get(RECORD + id)) as SessionRecord | undefined)
      : undefined

  const clock = await touch($, held => {
    const adopted =
      held.id === id
        ? held
        : {
            ...held,
            id,
            startedAt: prior?.startedAt ?? held.startedAt,
            totals: prior ? addTotals(prior.totals, held.totals) : held.totals,
          }

    return foldSegment(adopted, at)
  })

  if (clock === null) return

  const record: SessionRecord = {
    id,
    startedAt: clock.startedAt,
    updatedAt: at,
    totals: clock.totals,
  }
  await $.store.set(RECORD + id, record)
}

/** Sums every stored session but the current one: today's and all time. */
const loadHistory = async ($: EngineInterface): Promise<History> => {
  const id = await $.session.id()
  const at = await $.clock.now()
  const today = dayOf(at)
  let todayTotals = emptyTotals()
  let allTotals = emptyTotals()
  let sessions = 0

  for (const key of await $.store.keys()) {
    if (!key.startsWith(RECORD) || key === RECORD + id) continue

    const record = (await $.store.get(key)) as SessionRecord | undefined
    if (record === undefined) continue

    sessions += 1
    allTotals = addTotals(allTotals, record.totals)
    if (dayOf(record.startedAt) === today) {
      todayTotals = addTotals(todayTotals, record.totals)
    }
  }

  return { today: todayTotals, all: allTotals, sessions, loadedAt: at }
}

const statusText = (clock: SessionClock, at: number) => {
  const active = formatDuration(clock.totals.activeMs)

  return clock.turnStartedAt === null
    ? `time: ${active} active`
    : `time: turn ${formatDuration(at - clock.turnStartedAt)} · ${active} active`
}

const summary = (label: string, totals: Totals) =>
  [
    `${label}:`,
    `  open ${formatDuration(totals.wallMs)}, Claude active ${formatDuration(totals.activeMs)} over ${totals.turns} turns`,
    `  generating ${formatDuration(totals.generationMs)} over ${totals.steps} requests`,
    `  tools ${formatDuration(totals.toolMs)} over ${totals.toolCalls} calls, subagents ${formatDuration(totals.subagentMs)} over ${totals.subagentRuns} runs`,
  ].join('\n')

export const register: Register = on => {
  let ticks = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'time',
      description: 'Show how long Claude was active: this session, today and all time',
    })

    const at = await $.clock.now()
    // A hot reload fires session.start again: keep the clock it already has.
    await update($, session, clock => clock ?? freshClock(at))
    await flush($)

    $.clock.every(1000, () => {
      void (async () => {
        const at = await $.clock.now()
        const clock = await read($, session)
        if (clock === null) return

        $.ui.status(statusText(clock, at))
        // Redraw the pane every second while a turn runs, every 15 s while idle.
        ticks += 1
        if (clock.turnStartedAt !== null || ticks % 15 === 0) {
          await update($, now, () => at)
        }
      })().catch(() => undefined)
    })

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const at = await $.clock.now()
    await touch($, clock => ({ ...clock, turnStartedAt: at }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await touch($, clock => ({
        ...clock,
        totals: {
          ...clock.totals,
          subagentMs: clock.totals.subagentMs + e.durationMs,
          subagentRuns: clock.totals.subagentRuns + 1,
        },
      }))

      return next(e)
    }

    await touch($, clock => ({
      ...clock,
      turnStartedAt: null,
      totals: {
        ...clock.totals,
        activeMs: clock.totals.activeMs + e.durationMs,
        turns: clock.totals.turns + 1,
        interruptedTurns: clock.totals.interruptedTurns + (e.isAborted ? 1 : 0),
      },
    }))
    await flush($)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    try {
      return yield* next(e)
    } finally {
      const ms = (await $.clock.now()) - startedAt
      await touch($, clock => ({
        ...clock,
        totals: {
          ...clock.totals,
          generationMs: clock.totals.generationMs + ms,
          steps: clock.totals.steps + 1,
        },
      }))
    }
  })

  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    try {
      return await next(e)
    } finally {
      const ms = (await $.clock.now()) - startedAt
      await touch($, clock => ({ ...clock, totals: addToolCall(clock.totals, String(e.tool), ms) }))
    }
  }).catch(($, e, next) => next(e)) // only observes: a failure never holds up the tool

  on('session.end', async ($, e, next) => {
    await flush($)

    // A /clear or a resume goes on under another id: start that one's clock afresh.
    if (e.reason === 'clear' || e.reason === 'resume') {
      const at = await $.clock.now()
      await update($, session, () => freshClock(at))
    }

    return next(e)
  })

  on('command.run', { command: 'time' }, async $ => {
    await flush($)
    const loaded = await loadHistory($)
    await update($, history, () => loaded)
    await update($, now, () => loaded.loadedAt)
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Time tracker' })

    const clock = await read($, session)
    const current = clock === null ? emptyTotals() : clock.totals

    return {
      text: isPlaced
        ? 'Time tracker pane opened.'
        : [
            summary('This session', current),
            summary('Today', addTotals(loaded.today, current)),
            summary('All time', addTotals(loaded.all, current)),
          ].join('\n'),
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const clock = await read($, session)
    const loaded = await read($, history)
    const at = await read($, now)

    const current = clock === null ? emptyTotals() : liveTotals(clock, at)
    const past = loaded ?? { today: emptyTotals(), all: emptyTotals(), sessions: 0, loadedAt: at }
    const columns: Array<[string, Totals]> = [
      ['Session', current],
      ['Today', addTotals(past.today, current)],
      ['All time', addTotals(past.all, current)],
    ]

    const rows: Array<[string, (t: Totals) => string]> = [
      ['Open', t => formatDuration(t.wallMs)],
      ['Claude active', t => formatDuration(t.activeMs)],
      ['  generating', t => formatDuration(t.generationMs)],
      ['  in tools', t => formatDuration(t.toolMs)],
      ['  in subagents', t => formatDuration(t.subagentMs)],
      ['Idle', t => formatDuration(Math.max(0, t.wallMs - t.activeMs))],
      ['Turns', t => String(t.turns)],
      ['  interrupted', t => String(t.interruptedTurns)],
      ['Model requests', t => String(t.steps)],
      ['Tool calls', t => String(t.toolCalls)],
      ['Subagent runs', t => String(t.subagentRuns)],
    ]

    const label = 16
    const cell = 11
    const pad = (text: string, width: number) => text.padEnd(width)
    const padLeft = (text: string, width: number) => text.padStart(width)

    return (
      <Box flexDirection="column">
        {clock?.turnStartedAt != null && (
          <Text color="green">Turn running: {formatDuration(at - clock.turnStartedAt)}</Text>
        )}
        <Text bold>
          {pad('', label)}
          {columns.map(([name]) => padLeft(name, cell)).join('')}
        </Text>
        {rows.map(([name, value]) => (
          <Text>
            {pad(name, label)}
            {columns.map(([, totals]) => padLeft(value(totals), cell)).join('')}
          </Text>
        ))}
        <Text> </Text>
        <Text bold>Slowest tools this session</Text>
        {topTools(current, 6).length === 0 && <Text dimColor>No tool calls yet.</Text>}
        {topTools(current, 6).map(([tool, time]) => (
          <Text>
            {pad(tool.length > label - 1 ? tool.slice(0, label - 2) + '…' : tool, label)}
            {padLeft(formatDuration(time.ms), cell)}
            {padLeft(`${time.calls} calls`, cell)}
          </Text>
        ))}
        <Text> </Text>
        <Text dimColor>
          {past.sessions} earlier sessions on record. Tool and generation times are summed, so parallel
          work can add up to more than the wall clock.
        </Text>
      </Box>
    )
  })
}
