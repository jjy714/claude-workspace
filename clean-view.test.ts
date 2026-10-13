import { describe, expect, mock, test } from 'claude-code/testing'

import { cleanName } from './hooks/clean-view'

const BAND = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 30,
  bodyColumns: 80,
  scroll: { bodyRows: 30 },
} as any

const bottoms = (on: any) => {
  mock.store(on)
  mock.clock(on)
  on('tool.call', async () => ({ result: 'ok', text: 'ok' }) as any)
  on('tool.register', async () => ({ value: { tool: 'x' } }) as any)
  on('command.register', async () => ({ value: { command: 'simple' } }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.compose', async () => ({ sections: [] }))
  on('turn.start', async (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
}

const boot = async ($: any) => {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

describe('names', () => {
  test('one cleaner for every name', async () => {
    expect(cleanName('Build the pricing section in `src/Pricing.tsx`')).toBe(
      'Build the pricing section in',
    )
    expect(cleanName('Fix src/app/page.tsx layout now')).toBe('Fix layout now')
    expect(cleanName('  update   Header.tsx styles ')).toBe('Update styles')
    expect(cleanName('')).toBe('Working on it')
    expect(cleanName('`only code`')).toBe('Working on it')
    const long = cleanName('x'.repeat(10) + ' word '.repeat(14))
    expect(long.length).toBeLessThanOrEqual(40)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('checklist', () => {
  test('a to-do list plus a 60% report renders the rows', async ($, on) => {
    bottoms(on)
    await boot($)
    await $.tool.call({ tool: 'mcp__clean-view__plan_steps', steps: ['x'] } as any)
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'Read your brand notes', status: 'completed', activeForm: 'a' },
        { content: 'Build the pricing section', status: 'in_progress', activeForm: 'b' },
        { content: 'Add the contact form', status: 'pending', activeForm: 'c' },
        { content: 'Polish the footer', status: 'pending', activeForm: 'd' },
      ],
    } as any)
    await $.tool.call({
      tool: 'mcp__clean-view__report_progress',
      task: 'Build the pricing section',
      percent: 60,
    } as any)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'clean-view',
        surface,
        component: 'AbovePrompt',
        props: BAND,
      })
      expect(await ui.find({ type: 'Text', text: '✓' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Read your brand notes' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Done' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '▶' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '60%' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Next\s*$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Up next' })).toBeDefined()
      expect(await ui.find({ key: 'clean-view-toggle' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('plan_steps then report_progress at 100 moves to step two', async ($, on) => {
    bottoms(on)
    await boot($)
    const planned = await $.tool.call({
      tool: 'mcp__clean-view__plan_steps',
      steps: ['Read your notes', 'Build the page', 'Check it'],
    } as any)
    expect((planned as any).result).toBe('Planned 3 steps. The first one has started.')
    const draw = async () =>
      $.ui.mount({
        plugin: 'clean-view',
        surface: 'terminal',
        component: 'AbovePrompt',
        props: BAND,
      })
    let ui = await draw()
    expect(await ui.find({ type: 'Text', text: 'Working' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Done' })).toBeUndefined()
    await ui.unmount()
    const r = await $.tool.call({
      tool: 'mcp__clean-view__report_progress',
      task: 'Read your notes',
      percent: 100,
    } as any)
    expect((r as any).result).toBe('Progress noted: 100%.')
    ui = await draw()
    expect(await ui.find({ type: 'Text', text: 'Done' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▶' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Build the page' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Next/ })).toBeDefined()
    await ui.unmount()
  })

  test('any tool is denied before a plan exists and allowed after', async ($, on) => {
    bottoms(on)
    await boot($)
    const before = await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
    expect((before as any).deny).toContain('plan_steps')
    const allowed = await $.tool.call({ tool: 'ToolSearch', query: 'x' } as any)
    expect((allowed as any).deny).toBeUndefined()
    await $.tool.call({ tool: 'mcp__clean-view__plan_steps', steps: ['Do it', 'Check it'] } as any)
    const after = await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
    expect((after as any).deny).toBeUndefined()
  })
})

describe('states and switch', () => {
  test('a permission prompt shows Needs you', async ($, on) => {
    bottoms(on)
    on('classic.Notification', async () => ({}) as any)
    await boot($)
    await $.tool.call({ tool: 'mcp__clean-view__plan_steps', steps: ['Do it', 'Check it'] } as any)
    await $.classic.Notification({
      message: 'Claude needs your permission to use Bash',
      notification_type: 'permission_prompt',
    } as any)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'clean-view',
        surface,
        component: 'AbovePrompt',
        props: BAND,
      })
      expect(await ui.find({ type: 'Text', text: 'Needs you' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Claude needs your OK to continue' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '‖' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('/simple off hides the band, leaving only the button', async ($, on) => {
    bottoms(on)
    await boot($)
    await $.tool.call({ tool: 'mcp__clean-view__plan_steps', steps: ['Do it', 'Check it'] } as any)
    const out = await $.command.run({ command: 'simple', args: 'off' } as any)
    expect(out.text).toContain('off')
    const ui = await $.ui.mount({
      plugin: 'clean-view',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: BAND,
    })
    expect(await ui.find({ type: 'Text', text: 'Do it' })).toBeUndefined()
    expect(await ui.find({ key: 'clean-view-toggle' })).toBeDefined()
    await ui.unmount()
    // gate is off too
    const free = await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
    expect((free as any).deny).toBeUndefined()
  })
})
