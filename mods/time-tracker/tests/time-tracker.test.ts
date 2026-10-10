import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { SessionRecord } from '../types'
import { formatDuration } from '../hooks/totals'

const SESSION_ID = 'session-1'

/** The engine beneath the plugin: the answers a session would give. */
const world = (on: On, entries: Record<string, unknown> = {}) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 10, 12) })
  const store = new Map(Object.entries(entries))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.id', () => ({ value: SESSION_ID }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no surface in a test' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', async () => {
    await clock.sleep(3_000)
    return { result: 'ok' }
  })

  const record = () => store.get(`session:${SESSION_ID}`) as SessionRecord

  return { clock, record }
}

const start = { cwd: '/repo', surface: null, isInteractive: true } as const

test('formats durations', () => {
  expect(formatDuration(0)).toBe('0s')
  expect(formatDuration(42_000)).toBe('42s')
  expect(formatDuration(187_000)).toBe('3m 07s')
  expect(formatDuration(3_720_000)).toBe('1h 02m')
})

test('counts a turn, its tool time and its wall time into the stored record', async ($, on) => {
  const { clock, record: stored } = world(on)
  await $.session.start(start)

  await clock.advance(10_000)
  await $.turn.start({ text: 'hi', turnId: 't1' })

  const call = $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(3_000)
  await call

  await clock.advance(2_000)
  await $.turn.complete({
    answer: 'done',
    durationMs: 5_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })

  const record = stored()
  expect(record.totals.activeMs).toBe(5_000)
  expect(record.totals.turns).toBe(1)
  expect(record.totals.toolCalls).toBe(1)
  expect(record.totals.toolMs).toBe(3_000)
  expect(record.totals.tools.Bash).toEqual({ calls: 1, ms: 3_000 })
  expect(record.totals.wallMs).toBe(15_000)
})

test('counts subagent turns apart from main turns', async ($, on) => {
  const { clock, record: stored } = world(on)
  await $.session.start(start)

  await $.turn.complete({
    answer: 'report',
    durationMs: 8_000,
    isAborted: false,
    turnId: 'sub',
    agentId: 'agent-1',
    reason: 'answer',
  })
  await clock.advance(1_000)
  await $.turn.complete({
    answer: '',
    durationMs: 9_000,
    isAborted: true,
    turnId: 't1',
    reason: 'aborted',
  })

  const record = stored()
  expect(record.totals.subagentMs).toBe(8_000)
  expect(record.totals.subagentRuns).toBe(1)
  expect(record.totals.activeMs).toBe(9_000)
  expect(record.totals.turns).toBe(1)
  expect(record.totals.interruptedTurns).toBe(1)
})

test('a resumed session keeps counting from its stored record', async ($, on) => {
  const prior: SessionRecord = {
    id: SESSION_ID,
    startedAt: 1,
    updatedAt: 2,
    totals: {
      wallMs: 60_000,
      activeMs: 20_000,
      generationMs: 0,
      toolMs: 0,
      subagentMs: 0,
      turns: 2,
      interruptedTurns: 0,
      steps: 0,
      toolCalls: 0,
      subagentRuns: 0,
      tools: {},
    },
  }
  const { record: stored } = world(on, { [`session:${SESSION_ID}`]: prior })
  await $.session.start(start)

  await $.turn.complete({
    answer: 'ok',
    durationMs: 4_000,
    isAborted: false,
    turnId: 't3',
    reason: 'answer',
  })

  const record = stored()
  expect(record.startedAt).toBe(1)
  expect(record.totals.activeMs).toBe(24_000)
  expect(record.totals.turns).toBe(3)
})

test('/time answers with a summary where no pane is placed', async ($, on) => {
  world(on, {
    'session:older': {
      id: 'older',
      startedAt: 0,
      updatedAt: 0,
      totals: {
        wallMs: 0,
        activeMs: 3_600_000,
        generationMs: 0,
        toolMs: 0,
        subagentMs: 0,
        turns: 10,
        interruptedTurns: 0,
        steps: 0,
        toolCalls: 0,
        subagentRuns: 0,
        tools: {},
      },
    },
  })
  await $.session.start(start)

  const answer = await $.command.run({
    command: 'time',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })

  expect(answer.text).toContain('This session:')
  expect(answer.text).toContain('All time:')
  expect(answer.text).toContain('Claude active 1h 00m over 10 turns')
})

test('the pane draws the three columns on every surface that places panes', async ($, on) => {
  const { clock } = world(on)
  await $.session.start(start)
  await $.turn.complete({
    answer: 'ok',
    durationMs: 65_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })
  await clock.advance(1_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'time-tracker',
      surface,
      component: 'Pane',
      requestId: 'time-tracker',
      props: {
        title: 'Time tracker',
        isFocused: false,
        bodyColumns: 80,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Text', text: /All time/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Claude active\s+1m 05s/ })).toBeDefined()
    await ui.unmount()
  }
})
