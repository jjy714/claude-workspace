import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type {
  CleanViewChecklist,
  CleanViewTask,
} from '../types'

const CHECKLIST = { plugin: 'clean-view', key: 'checklist' } as const
const ENABLED = { plugin: 'clean-view', key: 'cleanViewEnabled' } as const
const TICK = { plugin: 'clean-view', key: 'tick' } as const

const EMPTY: CleanViewChecklist = {
  title: '',
  phase: 'idle',
  tasks: [],
  needsYouReason: null,
  stuckReason: null,
  startedAt: null,
  finishedAt: null,
  isCollapsed: false,
}

const checklistAtom = atom(CHECKLIST, EMPTY)
const enabledAtom = atom(ENABLED, true)
const tickAtom = atom(TICK, 0)

const PLAN = 'mcp__clean-view__plan_steps'
const REPORT = 'mcp__clean-view__report_progress'
const ALWAYS_ALLOWED = new Set([
  'ToolSearch',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'AskUserQuestion',
  PLAN,
  REPORT,
])
const GATE_MESSAGE =
  'Call plan_steps first: lay out every step of the job (2 to 8 short plain-English names) before using any other tool. Load plan_steps with ToolSearch if it is not available yet.'

const FALLBACK_NAME = 'Working on it'
const MAX_NAME = 40
const METER = 10
const LABEL_WIDTH = 7
const CODE_EXT =
  '(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|json|ya?ml|toml|html?|css|scss|md|sql|lock)'

/** The one cleaner every name passes through. */
export function cleanName(raw: string): string {
  let s = String(raw ?? '')
  s = s.replace(/`[^`]*`/g, ' ')
  s = s.replace(/\S*[\\/]\S*/g, ' ')
  s = s.replace(new RegExp(`\\S+\\.${CODE_EXT}\\b`, 'gi'), ' ')
  s = s.replace(/\s+/g, ' ').trim()
  if (s === '') return FALLBACK_NAME
  s = s.charAt(0).toUpperCase() + s.slice(1)
  if (s.length > MAX_NAME) {
    let cut = s.slice(0, MAX_NAME - 1)
    const space = cut.lastIndexOf(' ')
    if (space > 0) cut = cut.slice(0, space)
    cut = cut.replace(/[\s,.;:\-]+$/, '')
    s = (cut === '' ? s.slice(0, MAX_NAME - 1) : cut) + '…'
  }
  return s
}

function cleanTitle(raw: string): string {
  const words = String(raw ?? '')
    .replace(/["'`*.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 6)
  return cleanName(words.join(' '))
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

const isRunning = (c: CleanViewChecklist) =>
  c.phase === 'working' || c.phase === 'needs-you' || c.phase === 'stuck'
const isAnimating = (c: CleanViewChecklist) =>
  c.phase === 'working' || c.phase === 'needs-you'
const isPlaceholder = (t: CleanViewTask) => t.id.startsWith('ph-')
const hasRealPlan = (c: CleanViewChecklist) =>
  c.tasks.some(t => !isPlaceholder(t))

const clampPercent = (n: number) =>
  Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)))

function task(
  id: string,
  name: string,
  status: CleanViewTask['status'],
  percent = 0,
  hasReported = false,
): CleanViewTask {
  return { id, name, status, percent, hasReported }
}

/** Make sure exactly one step is active while the job still has open steps. */
function settle(tasks: CleanViewTask[]): CleanViewTask[] {
  const active = tasks.findIndex(t => t.status === 'active')
  const next = tasks.map((t, i) =>
    t.status === 'active' && i !== active ? { ...t, status: 'upcoming' as const } : t,
  )
  if (active === -1) {
    const first = next.findIndex(t => t.status === 'upcoming')
    if (first !== -1) next[first] = { ...next[first]!, status: 'active' }
  }
  return next
}

function classifyError(text: string): string {
  if (/rate.?limit|usage limit|429|quota/i.test(text))
    return 'you hit your usage limit, try again a little later'
  if (/overload|529|servers? (are )?busy|capacity/i.test(text))
    return "Claude's servers are busy, try again in a minute"
  if (/context|too long|too many tokens|maximum.*length/i.test(text))
    return 'the conversation is too long, type /compact and try again'
  if (/network|connection|econn|enotfound|fetch failed|timed? ?out|socket|offline/i.test(text))
    return 'the internet connection dropped'
  if (/auth|401|403|login|api key|unauthori[sz]ed|credential/i.test(text))
    return 'you are signed out, type /login'
  return 'something went wrong, try again'
}

const INSTRUCTIONS = `# Clean View

The person is using Clean View: tool calls and command output are hidden from them, and the only thing they see while you work is a plain checklist of steps. Keep that checklist true.

- Write every step name in plain English a non-technical person understands. Keep it under 40 characters and start it with a verb, like "Build the pricing section".
- Never put file paths, file names, commands, code or tool names in a step name.
- For every request, even a quick question, call plan_steps first with every step of the job (2 to 8 steps, in order). If plan_steps is deferred, load it with ToolSearch. Until you have planned, other tools are refused.
- Then call report_progress with the step name and a percent as real progress happens, and with percent 100 the moment a step finishes.
- If this session has TodoWrite or TaskCreate, you can use its to-do list as the plan instead of plan_steps.`

let ticker: { cancel: () => void } | undefined
let collapser: { cancel: () => void } | undefined
let jobSeq = 0
let isTurnLive = false
let failures = 0

const getChecklist = async ($: any): Promise<CleanViewChecklist> =>
  ((await $.state.get(CHECKLIST)).value as CleanViewChecklist | undefined) ?? EMPTY
const getEnabled = async ($: any): Promise<boolean> =>
  ((await $.state.get(ENABLED)).value as boolean | undefined) ?? true

const mutate = ($: any, fn: (c: CleanViewChecklist) => CleanViewChecklist) =>
  update($, checklistAtom, c => fn(c ?? EMPTY))

function stopTicker() {
  ticker?.cancel()
  ticker = undefined
}

function startTicker($: any) {
  if (ticker !== undefined) return
  ticker = $.clock.every(250, () => {
    void update($, tickAtom, n => ((n ?? 0) + 1) % 1_000_000)
  })
}

async function syncTicker($: any) {
  const c = await getChecklist($)
  if (isAnimating(c)) startTicker($)
  else stopTicker()
}

async function beginJob($: any, title: string, tasks: CleanViewTask[]) {
  collapser?.cancel()
  collapser = undefined
  jobSeq += 1
  failures = 0
  const now = await $.clock.now()
  await mutate($, () => ({
    ...EMPTY,
    title,
    phase: 'working',
    tasks,
    startedAt: now,
  }))
  startTicker($)
}

const placeholders = () => [
  task('ph-1', 'Understand your request', 'active'),
  task('ph-2', 'Plan the steps', 'upcoming'),
]

async function ensureJob($: any) {
  const c = await getChecklist($)
  if (!isRunning(c)) await beginJob($, FALLBACK_NAME, [])
}

async function setWorking($: any) {
  await mutate($, c =>
    c.phase === 'needs-you' || c.phase === 'stuck'
      ? { ...c, phase: 'working', needsYouReason: null, stuckReason: null }
      : c,
  )
  await syncTicker($)
}

async function setNeedsYou($: any, reason: string) {
  const c = await getChecklist($)
  if (!isRunning(c)) return
  await mutate($, x => ({ ...x, phase: 'needs-you', needsYouReason: reason, stuckReason: null }))
  startTicker($)
}

async function setStuck($: any, reason: string) {
  const c = await getChecklist($)
  if (!isRunning(c)) return
  await mutate($, x => ({ ...x, phase: 'stuck', stuckReason: reason, needsYouReason: null }))
  stopTicker()
}

function planFrom(names: string[]): CleanViewTask[] {
  return settle(
    names.map((n, i) => task(`s-${i + 1}`, cleanName(n), i === 0 ? 'active' : 'upcoming')),
  )
}

async function planSteps($: any, steps: string[]): Promise<string> {
  const names = steps
    .map(s => String(s ?? ''))
    .filter(s => s.trim() !== '')
    .slice(0, 8)
  await ensureJob($)
  const tasks = names.length > 0 ? planFrom(names) : [task('s-1', FALLBACK_NAME, 'active')]
  await mutate($, c => ({ ...c, tasks }))
  return `Planned ${tasks.length} steps. The first one has started.`
}

async function reportProgress($: any, name: string, rawPercent: number): Promise<string> {
  const percent = clampPercent(rawPercent)
  await ensureJob($)
  const clean = cleanName(name)
  await mutate($, c => {
    let tasks = c.tasks.filter(t => !isPlaceholder(t)).map(t => ({ ...t }))
    let i = tasks.findIndex(t => t.name.toLowerCase() === clean.toLowerCase())
    if (i === -1) {
      const active = tasks.findIndex(t => t.status === 'active')
      const fresh = task(`s-${Date.now().toString(36)}-${tasks.length + 1}`, clean, 'active')
      if (active === -1) tasks.push(fresh)
      else {
        tasks[active] = { ...tasks[active]!, status: 'upcoming' }
        tasks.splice(active, 0, fresh)
      }
      i = tasks.findIndex(t => t.id === fresh.id)
    }
    for (let k = 0; k < i; k++) {
      tasks[k] = { ...tasks[k]!, status: 'done', percent: 100 }
    }
    const current = { ...tasks[i]!, percent, hasReported: true }
    if (percent >= 100) {
      current.status = 'done'
    } else {
      current.status = 'active'
      for (let k = i + 1; k < tasks.length; k++) {
        if (tasks[k]!.status === 'active') tasks[k] = { ...tasks[k]!, status: 'upcoming' }
      }
    }
    tasks[i] = current
    return { ...c, tasks: settle(tasks) }
  })
  return `Progress noted: ${percent}%.`
}

async function fromTodos(
  $: any,
  todos: ReadonlyArray<{ content: string; status: string }>,
) {
  await ensureJob($)
  await mutate($, c => {
    const rows = todos.map((t, i) => {
      const name = cleanName(t.content)
      const old = c.tasks.find(o => o.name === name)
      const status: CleanViewTask['status'] =
        t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'active' : 'upcoming'
      return task(
        `t-${i + 1}`,
        name,
        status,
        status === 'done' ? 100 : (old?.percent ?? 0),
        status === 'done' ? true : (old?.hasReported ?? false),
      )
    })
    return { ...c, tasks: settle(rows) }
  })
}


async function setEnabled($: any, value: boolean) {
  await $.state.set(ENABLED, value)
  try {
    await $.store.set('enabled', value)
  } catch {
    // saving is a convenience; the setting still holds for this session
  }
  $.ui.toast(value ? 'Clean View is on' : 'Clean View is off')
}


export function registerCleanView(on: On): void {
  // -- session start: tools, command, saved setting ------------------------
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('enabled')
    await $.state.set(ENABLED, typeof saved === 'boolean' ? saved : true)

    await $.tool.register({
      name: 'plan_steps',
      description:
        'Lay out every step of the job up front, 2 to 8 short plain-English names in order (each under 40 characters, starting with a verb, never a file path, file name, command, code or tool name). The first step starts right away. Call this first for every request.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 8,
            description: 'Step names in order.',
          },
        },
        required: ['steps'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'report_progress',
      description:
        'Report progress on the current step. Use a step name from the plan and a percent from 0 to 100; report 100 the moment a step finishes and the next one starts automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The step name.' },
          percent: { type: 'number', description: 'Progress from 0 to 100.' },
        },
        required: ['task', 'percent'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'simple',
      description: 'Turn Clean View on or off',
      argumentHint: '[on|off]',
    })
    return next(e)
  })

  on('command.run', { command: 'simple' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const current = await getEnabled($)
    const value = arg === 'on' ? true : arg === 'off' ? false : !current
    await setEnabled($, value)
    return { text: value ? 'Clean View is on.' : 'Clean View is off. Every row is shown again.' }
  })

  // -- system prompt -------------------------------------------------------
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (!(await getEnabled($))) return result
    return {
      sections: [
        ...result.sections,
        { id: 'clean-view:instructions', text: INSTRUCTIONS, scope: 'session' as const },
      ],
    }
  })

  // -- turns ---------------------------------------------------------------
  on('turn.start', async ($, e, next) => {
    if (!(await getEnabled($))) return next(e)
    const text = e.text.trim()
    const c = await getChecklist($)
    const wasWaiting = !isTurnLive && c.phase === 'needs-you' && hasRealPlan(c)
    isTurnLive = true
    if (text === '' || text.startsWith('/')) return next(e)
    if (wasWaiting) {
      // a reply to "Claude is waiting for your reply": the same job carries on
      await setWorking($)
      return next(e)
    }
    if (isRunning(c)) return next(e)

    await beginJob($, 'Working on your request', placeholders())
    const mine = jobSeq
    void (async () => {
      const r = await $.model.complete({
        model: 'haiku',
        effort: 'low',
        maxTokens: 30,
        prompt: `Give this job a name of 2 to 6 plain English words that starts with a verb. Reply with the name only: no quotes, no punctuation.\n\nRequest: ${text.slice(0, 600)}`,
      })
      if (!r.isAnswered || mine !== jobSeq) return
      const title = cleanTitle(r.text)
      if (title !== FALLBACK_NAME) await mutate($, x => ({ ...x, title }))
    })().catch(() => {})
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined || !(await getEnabled($))) return next(e)
    isTurnLive = false
    const c = await getChecklist($)
    if (!isRunning(c)) return next(e)

    if (e.reason === 'error') {
      await setStuck($, classifyError(e.answer))
    } else if (e.reason === 'refusal') {
      await setStuck($, "Claude couldn't help with that request")
    } else if (e.reason === 'aborted') {
      const now = await $.clock.now()
      await mutate($, x => ({ ...x, phase: 'stopped', finishedAt: now, needsYouReason: null, stuckReason: null }))
      stopTicker()
    } else if (hasRealPlan(c) && c.tasks.some(t => t.status !== 'done')) {
      await mutate($, x => ({
        ...x,
        phase: 'needs-you',
        needsYouReason: 'Claude is waiting for your reply',
        stuckReason: null,
      }))
      startTicker($)
    } else {
      const now = await $.clock.now()
      await mutate($, x => ({
        ...x,
        phase: 'done',
        finishedAt: now,
        needsYouReason: null,
        stuckReason: null,
        tasks: x.tasks.map(t => ({ ...t, status: 'done' as const, percent: 100 })),
      }))
      stopTicker()
      const mine = jobSeq
      collapser?.cancel()
      collapser = $.clock.after(5000, () => {
        if (mine === jobSeq) void mutate($, x => ({ ...x, isCollapsed: true }))
      })
    }
    return next(e)
  })

  // -- tool calls: the plan gate and the rows --------------------------------
  on('tool.call', async ($, e, next) => {
    const isSub = e.agentId !== undefined

    if (e.tool === PLAN) {
      const steps = (e as any).steps
      const text = await planSteps($, Array.isArray(steps) ? steps : [])
      return { result: text } as any
    }
    if (e.tool === REPORT) {
      const text = await reportProgress($, String((e as any).task ?? ''), Number((e as any).percent))
      return { result: text } as any
    }

    if (isSub || !(await getEnabled($))) return next(e)

    if (!ALWAYS_ALLOWED.has(e.tool)) {
      const c = await getChecklist($)
      if (!hasRealPlan(c)) return { deny: GATE_MESSAGE }
    }

    if (e.tool === 'AskUserQuestion') {
      await setNeedsYou($, 'Claude has a question for you')
      return next(e)
    }
    if (e.tool === 'TodoWrite') {
      await fromTodos($, (e as any).todos ?? [])
      return next(e)
    }
    if (e.tool === 'TaskCreate') {
      const ran = await next(e)
      const id = String((ran as any)?.result?.task?.id ?? `n${Date.now().toString(36)}`)
      await ensureJob($)
      await mutate($, c => {
        const tasks = [
          ...c.tasks.filter(t => !isPlaceholder(t)),
          task(`k-${id}`, cleanName(String((e as any).subject ?? '')), 'upcoming'),
        ]
        return { ...c, tasks: settle(tasks) }
      })
      return ran
    }
    if (e.tool === 'TaskUpdate') {
      const input = e as any
      await mutate($, c => {
        const i = c.tasks.findIndex(t => t.id === `k-${input.taskId}`)
        if (i === -1) return c
        let tasks = c.tasks.map(t => ({ ...t }))
        if (input.status === 'deleted') tasks.splice(i, 1)
        else {
          const t = tasks[i]!
          if (typeof input.subject === 'string') t.name = cleanName(input.subject)
          if (input.status === 'completed') Object.assign(t, { status: 'done', percent: 100, hasReported: true })
          else if (input.status === 'in_progress') {
            tasks = tasks.map(o => (o.status === 'active' ? { ...o, status: 'upcoming' as const } : o))
            tasks[i] = { ...tasks[i]!, status: 'active' }
          } else if (input.status === 'pending') t.status = 'upcoming'
        }
        return { ...c, tasks: settle(tasks) }
      })
      return next(e)
    }
    return next(e)
  })

  // -- permission prompts, failures ------------------------------------------
  on('classic.Notification', async ($, e, next) => {
    if (e.agent_id !== undefined || !(await getEnabled($))) return next(e)
    const type = String(e.notification_type ?? '')
    if (type === 'idle_prompt') return next(e)
    const isPermission = /permission/i.test(type) || /permission|approve|allow/i.test(String(e.message ?? ''))
    await setNeedsYou($, isPermission ? 'Claude needs your OK to continue' : 'Claude has a question for you')
    return next(e)
  })

  on('classic.PermissionDenied', async ($, e, next) => {
    if (await getEnabled($)) await setStuck($, 'you said no to a step, so Claude paused')
    return next(e)
  })

  on('classic.PostToolUse', async ($, e, next) => {
    failures = 0
    if (await getEnabled($)) await setWorking($)
    return next(e)
  })

  on('classic.PostToolUseFailure', async ($, e, next) => {
    if (!(await getEnabled($))) return next(e)
    if (String(e.error ?? '').includes('Call plan_steps first')) return next(e)
    failures += 1
    if (failures >= 3) {
      await setStuck($, 'a step keeps failing, Claude is trying another way')
    } else {
      await setWorking($)
    }
    return next(e)
  })

  // -- hide the technical rows -----------------------------------------------
  on('ui.render', { component: ['ToolUse', 'ToolResult', 'ToolGroup'] }, async ($, e, next) => {
    if (!(await read($, enabledAtom))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (!(await read($, enabledAtom))) return next(e)
    return next({ ...e, props: { ...e.props, hint: '' } })
  })

  // -- the band ---------------------------------------------------------------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const isOn = await read($, enabledAtom)
    const c = await read($, checklistAtom)
    const tick = await read($, tickAtom)
    const columns = Math.max(24, e.props.bodyColumns)

    const button = (
      <Button
        key="clean-view-toggle"
        label={isOn ? '● Clean View: ON' : '○ Clean View: OFF'}
        onPress={async () => {
          await setEnabled($, !(await getEnabled($)))
        }}
      />
    )

    const headerRow = (left: any) => (
      <Box key="header" flexDirection="row" width={columns}>
        <Box flexGrow={1} flexShrink={1}>
          {left}
        </Box>
        <Box flexShrink={0}>{button}</Box>
      </Box>
    )

    const showsBand = isOn && c.phase !== 'idle'
    if (!showsBand) {
      return (
        <Box flexDirection="column" width={columns}>
          {headerRow(<Text> </Text>)}
        </Box>
      )
    }

    const now = c.finishedAt ?? (await $.clock.now())
    const elapsed = formatDuration(now - (c.startedAt ?? now))

    let left: any
    switch (c.phase) {
      case 'needs-you':
        left = (
          <Text wrap="truncate-end">
            <Text bold inverse color="warning">{' Needs you '}</Text>
            {' '}{c.needsYouReason ?? 'Claude needs your OK to continue'}
          </Text>
        )
        break
      case 'stuck':
        left = (
          <Text wrap="truncate-end" color="error">
            {'⚠ Stuck: '}{c.stuckReason ?? 'something went wrong'}
          </Text>
        )
        break
      case 'stopped':
        left = (
          <Text wrap="truncate-end">{'■ Stopped · '}{c.title}{' · you pressed Esc'}</Text>
        )
        break
      case 'done':
        left = (
          <Text wrap="truncate-end" color="success">
            {'✓ All done · '}{c.title}{' · took '}{elapsed}
          </Text>
        )
        break
      default:
        left = (
          <Text wrap="truncate-end" bold>
            {c.title}{' · '}{elapsed}
          </Text>
        )
    }

    if (c.phase === 'done' && c.isCollapsed) {
      return (
        <Box flexDirection="column" width={columns}>
          {headerRow(left)}
        </Box>
      )
    }

    const nameWidth = Math.max(8, Math.min(MAX_NAME, columns - (2 + 1 + METER + 2 + LABEL_WIDTH)))
    const fit = (s: string) =>
      s.length > nameWidth ? s.slice(0, nameWidth - 1) + '…' : s.padEnd(nameWidth, ' ')

    const meter = (filled: number) => '█'.repeat(filled) + '░'.repeat(METER - filled)
    const sweep = () => {
      const start = (tick % (METER + 3)) - 3
      let out = ''
      for (let i = 0; i < METER; i++) out += i >= start && i < start + 3 ? '█' : '░'
      return out
    }

    let nextSeen = false
    const rows = c.tasks.map(t => {
      const label = (s: string) => s.padEnd(LABEL_WIDTH, ' ')
      if (t.status === 'done') {
        return (
          <Box key={t.id} flexDirection="row">
            <Text color="success">{'✓ '}</Text>
            <Text dimColor>{fit(t.name)}</Text>
            <Text dimColor>{' '}{meter(METER)}{'  '}</Text>
            <Text dimColor>{label('Done')}</Text>
          </Box>
        )
      }
      if (t.status === 'active') {
        const paused = c.phase === 'needs-you'
        return (
          <Box key={t.id} flexDirection="row">
            <Text color="warning">{paused ? '‖ ' : '▶ '}</Text>
            <Text bold>{fit(t.name)}</Text>
            <Text>{' '}{t.hasReported ? meter(Math.round(t.percent / 10)) : sweep()}{'  '}</Text>
            <Text>{label(t.hasReported ? `${t.percent}%` : 'Working')}</Text>
          </Box>
        )
      }
      const word = nextSeen ? 'Up next' : 'Next'
      nextSeen = true
      return (
        <Box key={t.id} flexDirection="row">
          <Text dimColor>{'○ '}</Text>
          <Text dimColor>{fit(t.name)}</Text>
          <Text dimColor>{' '}{meter(0)}{'  '}</Text>
          <Text dimColor>{label(word)}</Text>
        </Box>
      )
    })

    return (
      <Box flexDirection="column" width={columns}>
        {headerRow(left)}
        {rows}
      </Box>
    )
  })
}
