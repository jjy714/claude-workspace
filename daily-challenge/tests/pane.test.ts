import { describe, expect, mock, test } from 'claude-code/testing'

const NOON = new Date(2026, 9, 13, 12, 0, 0).getTime()
const PROPS = {
  title: 'Daily Challenge',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

describe('the pane', () => {
  test('buttons: complete, undo, swap and coach', async ($, on) => {
    mock.clock(on, { now: NOON })
    mock.store(on, {})
    const fills: string[] = []
    const closed: string[] = []
    on('prompt.fill', (_$, e) => {
      fills.push(e.text)
      return { isFilled: true } as never
    })
    on('ui.close', (_$, e) => {
      closed.push(e.id)
      return { value: undefined } as never
    })

    const ui = await $.ui.mount({ plugin: 'daily-challenge', surface: 'terminal', component: 'Pane', props: PROPS, requestId: 'daily-challenge' })
    const shows = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined

    expect(await shows(/TODAY'S CHALLENGE/)).toBe(true)
    expect(await ui.find({ key: 'complete' })).toBeDefined()

    const firstTitle = (await ui.find({ type: 'Text', text: /Lead with the goal/ })) !== undefined
    expect(firstTitle).toBe(true)
    await ui.press({ key: 'another' })
    expect(await shows(/Lead with the goal/)).toBe(false)
    expect(await ui.find({ key: 'another' })).toBeDefined()

    await ui.press({ key: 'complete' })
    expect(await shows(/Completed today/)).toBe(true)
    expect(await ui.find({ key: 'complete' })).toBeUndefined()
    expect(await shows(/1 done/)).toBe(true)

    await ui.press({ key: 'undo' })
    expect(await shows(/0 done/)).toBe(true)
    expect(await ui.find({ key: 'complete' })).toBeDefined()

    await ui.press({ key: 'coach' })
    expect(fills.length).toBe(1)
    expect(fills[0].includes('one step at a time')).toBe(true)
    expect(fills[0].includes('wait for me after each step')).toBe(true)
    expect(closed).toEqual(['daily-challenge'])
    await ui.unmount()
  })
})
