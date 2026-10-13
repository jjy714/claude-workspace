import { expect, mock, test } from 'claude-code/testing'

const PANE_PROPS = {
  title: 'Road Trip',
  isFocused: true,
  bodyColumns: 100,
  placement: 'inline',
  scroll: { bodyRows: 28, contentRows: 28, maxOffset: 0, offset: 0 },
  view: { agentId: undefined },
} as any

const ORIGIN = { kind: 'composer' }
const PRES = { isFullscreen: false, columns: 120 }

const setup = ($: any, on: any) => {
  const clock = mock.clock(on)
  mock.store(on)
  const closed: string[] = []
  const opened: string[] = []
  on('ui.open', (_$: any, e: any) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$: any, e: any) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.blit', () => ({ value: { isBlitted: true } }))
  on('session.start', () => ({ cwd: '/' }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  return { clock, closed, opened }
}

const mountPane = ($: any) =>
  $.ui.mount({
    plugin: 'road-trip',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'road-trip',
    props: PANE_PROPS,
    viewport: { columns: 120, rows: 40, isFullscreen: false },
  })

test('7. turn.complete shows the Arrived card; turn.start drives on', async ($, on) => {
  const { clock } = setup($, on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const out = await $.command.run({ command: 'roadtrip', args: '', origin: ORIGIN, presentation: PRES } as any)
  expect(out.text).toContain('Road Trip')
  let ui = await mountPane($)
  // driving: steer + pause buttons
  expect(await ui.find({ key: 'left' })).toBeDefined()
  expect(await ui.find({ key: 'keep' })).toBeUndefined()
  await clock.advance(3500)

  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'ok', durationMs: 5, isAborted: false } as any)
  await ui.unmount()
  ui = await mountPane($)
  expect(await ui.find({ key: 'keep' })).toBeDefined()
  expect(await ui.find({ key: 'close' })).toBeDefined()

  // a subagent finishing does not count
  await $.turn.start({ text: 'next job', turnId: 't2' })
  await ui.unmount()
  ui = await mountPane($)
  expect(await ui.find({ key: 'keep' })).toBeUndefined()
  expect(await ui.find({ key: 'left' })).toBeDefined()
  await ui.unmount()
})

test('subagents finishing do not show the Arrived card', async ($, on) => {
  const { clock } = setup($, on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'roadtrip', args: '', origin: ORIGIN, presentation: PRES } as any)
  await clock.advance(500)
  await $.turn.complete({ turnId: 't1', agentId: 'sub-1', reason: 'answer', answer: 'ok', durationMs: 5, isAborted: false } as any)
  const ui = await mountPane($)
  expect(await ui.find({ key: 'keep' })).toBeUndefined()
  await ui.unmount()
})

test('9. /roadtrip off closes the pane and /roadtrip then refuses until /roadtrip on', async ($, on) => {
  const { clock, closed, opened } = setup($, on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'roadtrip', args: 'play', origin: ORIGIN, presentation: PRES } as any)
  expect(opened).toEqual(['road-trip'])

  const off = await $.command.run({ command: 'roadtrip', args: 'off', origin: ORIGIN, presentation: PRES } as any)
  expect(off.text).toContain('off')
  await clock.advance(50)
  expect(closed).toContain('road-trip')

  const refused = await $.command.run({ command: 'roadtrip', args: '', origin: ORIGIN, presentation: PRES } as any)
  expect(refused.text).toContain('/roadtrip on')
  expect(opened.length).toBe(1)

  await $.command.run({ command: 'roadtrip', args: 'on', origin: ORIGIN, presentation: PRES } as any)
  expect(opened.length).toBe(2)
})

test('the pane says so when it is too small, and off the terminal', async ($, on) => {
  setup($, on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'roadtrip', args: '', origin: ORIGIN, presentation: PRES } as any)
  const small = await $.ui.mount({
    plugin: 'road-trip',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'road-trip',
    props: { ...PANE_PROPS, bodyColumns: 30 },
  })
  expect(await small.find({ type: 'Text', text: /little bigger/ })).toBeDefined()
  await small.unmount()
  const web = await $.ui.mount({
    plugin: 'road-trip',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'road-trip',
    props: PANE_PROPS,
  })
  expect(await web.find({ type: 'Text', text: /plays in the terminal/ })).toBeDefined()
  await web.unmount()
})
