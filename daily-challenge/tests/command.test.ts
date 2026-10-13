import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const NOON = new Date(2026, 9, 13, 12, 0, 0).getTime()

const run = ($: Engine, args: string) =>
  $.command.run({
    command: 'challenge',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 100 },
  })

describe('the /challenge command', () => {
  test('done marks today complete, replies with streak and total, and saves it', async ($, on) => {
    const clock = mock.clock(on, { now: NOON })
    mock.store(on, {})

    const first = await run($, 'done')
    expect(first.text).toBe("Marked today's challenge complete. Streak: 1 day. Completed: 1 of 365.")
    const again = await run($, 'done')
    expect(again.text?.startsWith("Today's challenge was already complete.")).toBe(true)

    await clock.advance(24 * 3600 * 1000)
    const next = await run($, 'done')
    expect(next.text).toBe("Marked today's challenge complete. Streak: 2 days. Completed: 2 of 365.")
  })

  test('another swaps the challenge and says which one', async ($, on) => {
    mock.clock(on, { now: NOON })
    mock.store(on, {})
    const reply = await run($, 'another')
    expect(reply.text?.startsWith('Swapped for today: ')).toBe(true)
    expect(reply.text?.includes('Lead with the goal')).toBe(false)
  })

  test('opening the pane answers at once and opens it in the background', async ($, on) => {
    mock.clock(on, { now: NOON })
    mock.store(on, {})
    const opened: string[] = []
    on('ui.open', (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } } as never
    })
    const reply = await run($, '')
    expect(reply.text).toBe('Opening your daily challenge.')
    for (let turn = 0; turn < 500 && opened.length === 0; turn += 1) await Promise.resolve()
    expect(opened).toEqual(['daily-challenge'])
  })

  test('an unknown word gets a plain hint, and a failure gets a plain sentence', async ($, on) => {
    mock.clock(on, { now: NOON })
    on('store.get', () => {
      throw new Error('store is down')
    })
    const hint = await run($, 'banana')
    expect(hint.text).toBe('Try /challenge, /challenge done or /challenge another.')
    const failed = await run($, 'done')
    expect(failed.text).toBe('Daily Challenge hit a problem and did nothing. Please try again.')
  })
})

describe('the band button', () => {
  test('opens the pane', async ($, on) => {
    mock.clock(on, { now: NOON })
    mock.store(on, {})
    const opened: string[] = []
    on('ui.open', (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } } as never
    })
    const props = {
      hasSurvey: false,
      isWorking: false,
      maxRows: 5,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 5 },
      view: {},
    } as const
    const ui = await $.ui.mount({ plugin: 'daily-challenge', surface: 'terminal', component: 'AbovePrompt', props })
    await ui.press({ key: 'open' })
    expect(opened).toEqual(['daily-challenge'])
    await ui.unmount()
  })
})
