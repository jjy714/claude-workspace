import { describe, expect, mock, test } from 'claude-code/testing'

const PANE = { plugin: 'clean-view', surface: 'terminal', component: 'Pane', requestId: 'agent-dock' } as const
const PANE_PROPS = { title: 'Agent Dock', isFocused: false, bodyColumns: 100, placement: 'dock' } as any

type Rec = { submits: any[]; opened: any[]; closed: any[]; status: any[]; toasts: any[]; agentCalls: number; dock: any }

const bottoms = (on: any, seed: Record<string, unknown> = {}, agent?: (e: any) => any, env: Record<string, string> = {}) => {
  const rec: Rec = { submits: [], opened: [], closed: [], status: [], toasts: [], agentCalls: 0, dock: undefined }
  on('state.set', { plugin: 'clean-view', key: 'dock' }, async (_$: any, e: any, next: any) => {
    rec.dock = e.value
    return next(e)
  })
  const clock = mock.clock(on)
  mock.store(on, seed)
  mock.env(on, { HOME: '/home/test', ...env })
  on('tool.register', async () => ({ value: { tool: 'x' } }) as any)
  on('command.register', async () => ({ value: { command: 'x' } }) as any)
  on('ui.toast', async (_$: any, e: any) => {
    rec.toasts.push(e.text)
    return { value: undefined } as any
  })
  on('ui.status', async (_$: any, e: any) => {
    rec.status.push(e.text)
    return { value: undefined } as any
  })
  on('ui.open', async (_$: any, e: any) => {
    rec.opened.push(e)
    return { value: { isPlaced: true } } as any
  })
  on('ui.close', async (_$: any, e: any) => {
    rec.closed.push(e)
    return { value: undefined } as any
  })
  on('ui.panes', async () => ({ value: rec.opened.length > rec.closed.length ? [{ id: 'agent-dock', title: 'Agent Dock', isShown: true, isFocused: false, isPlaced: true }] : [] }) as any)
  on('process.run', async (_$: any, e: any) => {
    if (e.argv?.[0] === '/bin/sleep') await clock.sleep(1000)
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as any
  })
  on('fs.list', async () => ({ value: [] }) as any)
  on('fs.write', async () => ({ value: undefined }) as any)
  on('session.id', async () => ({ value: 's-1' }) as any)
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', async () => ({}) as any)
  on('prompt.compose', async () => ({ sections: [] }))
  on('prompt.submit', async (_$: any, e: any) => {
    rec.submits.push(e)
    return { text: e.text, context: e.context } as any
  })
  on('turn.start', async (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  on('tool.call', { tool: 'Agent' }, async (_$: any, e: any) => {
    rec.agentCalls += 1
    return agent ? agent(e) : ({ result: 'ok', text: 'ok' } as any)
  })
  on('tool.call', async () => ({ result: 'ok', text: 'ok' }) as any)
  return { rec, clock }
}

const boot = async ($: any) => {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

const setSize = async ($: any, clock: any, n: number) => {
  await $.command.run({ command: 'dock', args: String(n) } as any)
  await clock.settle()
}

const plan = ($: any) =>
  $.tool.call({ tool: 'mcp__clean-view__plan_steps', steps: ['Do it', 'Check it'] } as any)

const submit = ($: any, text: string) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as any)


const agentCall = ($: any, description: string) =>
  $.tool.call({ tool: 'Agent', description, prompt: `Do ${description}` } as any)

describe('team size', () => {
  test('a saved size of 50 comes back as 1; 10 stays 10', async ($, on) => {
    const { rec } = bottoms(on, { teamSize: 50 })
    await boot($)
    expect(rec.dock.size).toBe(1)
  })

  test('10 stays 10 in a new session', async ($, on) => {
    const { rec } = bottoms(on, { teamSize: 10 })
    await boot($)
    expect(rec.dock.size).toBe(10)
  })

  test('/dock with a bad number explains itself; above 20 asks for confirmation', async ($, on) => {
    const { clock, rec } = bottoms(on)
    await boot($)
    const bad = await $.command.run({ command: 'dock', args: '500' } as any)
    expect(bad.text).toBe('Team Size is a whole number from 1 to 100, e.g. /dock 10.')
    const big = await $.command.run({ command: 'dock', args: '50' } as any)
    expect(big.text).toBe('Confirm the team of 50 in the Agent Dock.')
    await clock.settle()
    const d = rec.dock
    expect(d.size).toBe(1)
    expect(d.pendingSize).toBe(50)
  })

  test('the big team box shows, Continue applies it, a bad custom number toasts', async ($, on) => {
    const { clock, rec } = bottoms(on)
    await boot($)
    await setSize($, clock, 50)
    const ui = await $.ui.mount({ ...PANE, props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: 'Big team: this uses your plan quickly. Continue?' })).toBeDefined()
    await ui.press({ key: 'dock-confirm' })
    expect(rec.dock.size).toBe(50)
    await ui.unmount()
    const again = await $.ui.mount({ ...PANE, props: PANE_PROPS })
    await again.press({ key: 'size-custom' })
    await again.input({ key: 'dock-custom', text: '101' })
    expect(rec.toasts).toContain('Type a whole number from 1 to 100')
    await again.unmount()
  })
})

describe('splitting the work', () => {
  test('at size 5 a request carries the exactly-5 instruction; at size 1 nothing', async ($, on) => {
    const { rec, clock } = bottoms(on)
    await boot($)
    await submit($, 'Research bakery pricing')
    expect(rec.submits.at(-1).context).toBeUndefined()
    await setSize($, clock, 5)
    await submit($, 'Research bakery pricing')
    const ctx = (rec.submits.at(-1).context ?? []).join('\n')
    expect(ctx).toContain('exactly 5 independent pieces')
    expect(ctx).toContain('Do not call plan_steps')
  })

  test('the 6th Agent call at size 5 is denied with the Team Size message', async ($, on) => {
    const { clock, rec } = bottoms(on)
    await boot($)
    await plan($)
    await setSize($, clock, 5)
    await submit($, 'Do five things')
    for (let i = 1; i <= 5; i++) {
      const ok = await agentCall($, `Task number ${i}`)
      expect((ok as any).deny).toBeUndefined()
    }
    const sixth = await agentCall($, 'Task number 6')
    expect((sixth as any).deny).toBe(
      'Team Size is 5: this request already has 5 helpers. Finish with the helpers you have.',
    )
    expect(rec.agentCalls).toBe(5)
  })

  test('a request that used 3 of 10 gets exactly one nudge', async ($, on) => {
    const { clock, rec } = bottoms(on)
    await boot($)
    await plan($)
    await setSize($, clock, 10)
    await submit($, 'Do ten things')
    for (let i = 1; i <= 3; i++) await agentCall($, `Task number ${i}`)
    const before = rec.submits.length
    const done = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'completed' } as any
    await $.turn.complete(done)
    await clock.settle()
    const nudges = rec.submits.slice(before).filter(s => /You used 3 of 10 helpers/.test(s.text))
    expect(nudges.length).toBe(1)
    expect(nudges[0].text).toBe(
      'You used 3 of 10 helpers. Split the remaining work across the other 7, one helper per piece, all in parallel.',
    )
    await $.turn.complete({ ...done, turnId: 't2' })
    await clock.settle()
    expect(rec.submits.slice(before).filter(s => /You used/.test(s.text)).length).toBe(1)
  })

  test('Fast & Cheap sends helpers to Haiku only above size 1 and only when no model is named', async ($, on) => {
    const seen: any[] = []
    const { clock } = bottoms(on, {}, e => {
      seen.push(e)
      return { result: 'ok', text: 'ok' }
    })
    await boot($)
    await plan($)
    await agentCall($, 'Solo task here')
    expect(seen.at(-1).model).toBeUndefined()
    await setSize($, clock, 3)
    await submit($, 'Three things')
    await agentCall($, 'Task number one')
    expect(seen.at(-1).model).toBe('haiku')
    await $.tool.call({ tool: 'Agent', description: 'Named model task', prompt: 'x', model: 'opus' } as any)
    expect(seen.at(-1).model).toBe('opus')
  })
})

describe('the cards', () => {
  const rows = (id: string, d: string) => ({ type: 'tool_use', id, name: 'Agent', input: { description: d } })

  test('queued, then working, then done, a helper report moves its meter, summary at the end', async ($, on) => {
    const gates: Array<() => void> = []
    const { clock, rec } = bottoms(on, {}, () =>
      new Promise(resolve => gates.push(() => resolve({ result: 'ok', text: 'ok' }))),
    )
    await boot($)
    await plan($)
    await setSize($, clock, 3)
    await submit($, 'Research bakery pricing')

    await $.session.append({
      message: { type: 'assistant', role: 'assistant', content: [rows('u1', 'Price check: Panera'), rows('u2', 'Price check: Crumbl'), rows('u3', 'Price check: Tatte')] },
      door: 'response',
      origin: { kind: 'model', model: 'm' },
      uuid: 'r1',
    } as any)
    let d = rec.dock
    expect(d.cards.map((k: any) => k.status)).toEqual(['queued', 'queued', 'queued'])
    expect(d.phase).toBe('live')

    const calls = ['u1', 'u2', 'u3'].map((id, i) =>
      $.tool.call({ tool: 'Agent', tool_use_id: id, description: ['Price check: Panera', 'Price check: Crumbl', 'Price check: Tatte'][i], prompt: 'x' } as any),
    )
    await clock.settle()
    d = rec.dock
    expect(d.cards.map((k: any) => k.status)).toEqual(['working', 'working', 'working'])

    const report = await $.tool.call({
      tool: 'mcp__clean-view__report_progress',
      agentId: 'ag-1',
      task: 'Price check: Panera',
      percent: 60,
    } as any)
    expect((report as any).result).toBe('Progress noted: 60%.')
    const plan2 = await $.tool.call({ tool: 'mcp__clean-view__plan_steps', agentId: 'ag-1', steps: ['x'] } as any)
    expect((plan2 as any).result).toBe('Helpers skip the plan. Just call report_progress as you work.')

    const ui = await $.ui.mount({ ...PANE, props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /60%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Price check: Pan/ })).toBeDefined()
    await ui.unmount()

    gates.forEach(g => g())
    await Promise.all(calls)
    d = rec.dock
    expect(d.cards.map((k: any) => k.status)).toEqual(['done', 'done', 'done'])

    await clock.advance(134_000)
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'completed' } as any)
    await clock.settle()
    d = rec.dock
    expect(d.phase).toBe('done')
    const done = await $.ui.mount({ ...PANE, props: PANE_PROPS })
    expect(await done.find({ type: 'Text', text: /3 agents finished Research bakery pricing in/ })).toBeDefined()
    await done.unmount()
  })

  test('more than 12 helpers draw as tiles', async ($, on) => {
    const { clock, rec } = bottoms(on)
    await boot($)
    await setSize($, clock, 20)
    await submit($, 'Many things')
    const blocks = Array.from({ length: 20 }, (_, i) => rows(`m${i}`, `Task number ${i}`))
    await $.session.append({
      message: { type: 'assistant', role: 'assistant', content: blocks },
      door: 'response',
      origin: { kind: 'model', model: 'm' },
      uuid: 'r2',
    } as any)
    const ui = await $.ui.mount({ ...PANE, props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: '○ 20 queued' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Task number 3' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /T\d/ })).toBeDefined()
    await ui.unmount()
  })

  test('an idle dock shows the seats', async ($, on) => {
    const { clock } = bottoms(on)
    await boot($)
    await setSize($, clock, 5)
    const ui = await $.ui.mount({ ...PANE, props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: 'Your team of 5 is standing by' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Send a request and it splits across 5 helpers.' })).toBeDefined()
    await ui.unmount()
  })
})

describe('the queue', () => {
  test('Agent calls past the engine limit wait for a free slot', async ($, on) => {
    const gates: Array<() => void> = []
    const { clock, rec } = bottoms(
      on,
      {},
      () => new Promise(resolve => gates.push(() => resolve({ result: 'ok', text: 'ok' }))),
      { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '2', CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '2' },
    )
    await boot($)
    await plan($)
    await setSize($, clock, 3)
    await submit($, 'Three things')
    const calls = ['k1', 'k2', 'k3'].map(id =>
      $.tool.call({ tool: 'Agent', tool_use_id: id, description: `Task ${id}`, prompt: 'x' } as any),
    )
    await clock.settle()
    await clock.advance(3000)
    expect(rec.agentCalls).toBe(2)
    expect(rec.dock.cards.map((k: any) => k.status)).toEqual(['working', 'working'])
    gates[0]!()
    await clock.advance(2000)
    await clock.settle()
    expect(rec.agentCalls).toBe(3)
    gates.slice(1).forEach(g => g())
    await clock.settle()
    await Promise.all(calls)
    expect(rec.dock.cards.map((k: any) => k.status)).toEqual(['done', 'done', 'done'])
  })
})

describe('/dock', () => {
  test('folds to the badge and back', async ($, on) => {
    const { rec, clock } = bottoms(on)
    await boot($)
    await $.command.run({ command: 'dock', args: '' } as any)
    await clock.settle()
    expect(rec.opened.length).toBe(1)
    expect(rec.opened[0].columns).toBeGreaterThan(0)
    expect(rec.dock.isFolded).toBe(false)

    await $.command.run({ command: 'dock', args: '' } as any)
    await clock.settle()
    expect(rec.closed.length).toBe(1)
    expect(rec.dock.isFolded).toBe(true)
    expect(String(rec.status.at(-1))).toContain('standing by')

    await $.command.run({ command: 'dock', args: '' } as any)
    await clock.settle()
    expect(rec.opened.length).toBe(2)
    expect(rec.dock.isFolded).toBe(false)
    expect(rec.status.at(-1)).toBeUndefined()
  })
})

describe('the button', () => {
  test('the ◆ Dock button sits beside Clean View\'s and opens the pane', async ($, on) => {
    const { rec, clock } = bottoms(on)
    await boot($)
    const band = { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 80, scroll: { bodyRows: 30 } } as any
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'clean-view', surface, component: 'AbovePrompt', props: band })
      expect(await ui.find({ key: 'clean-view-toggle' })).toBeDefined()
      expect(await ui.find({ key: 'dock-open' })).toBeDefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: 'clean-view', surface: 'terminal', component: 'AbovePrompt', props: band })
    await ui.press({ key: 'dock-open' })
    await clock.settle()
    expect(rec.opened.length).toBe(1)
    await ui.unmount()
  })
})
