import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { DockCard, DockState } from '../types'
import {
  BAD_SIZE_TOAST,
  CORAL,
  GOLD,
  GREEN,
  HAIR,
  PLAN_REFUSAL,
  RED,
  SIZES,
  SLASH_BAD_SIZE,
  STOPPED_MESSAGE,
  TILE_THRESHOLD,
  TOO_NARROW,
  WORDMARK,
  addQueued,
  agentsNowJson,
  applyProgress,
  atATime,
  badge,
  badgeColor,
  blend,
  capMessage,
  cardPercent,
  clampPercent,
  clock,
  counts,
  engineLimit,
  hash,
  infoLine,
  initials,
  instructionText,
  isFinished,
  jobName,
  liveLabel,
  meter,
  missionBar,
  needsConfirm,
  nudgeText,
  overallPercent,
  parseSize,
  perRow,
  restoreHelperModel,
  restoreSize,
  seatCount,
  setStatus,
  shouldNudge,
  summary,
} from './dock-logic'

const PANE = 'agent-dock'
const REPORT = 'mcp__clean-view__report_progress'
const PLAN = 'mcp__clean-view__plan_steps'
const PANE_COLUMNS = 72

const INITIAL: DockState = {
  size: 1,
  pendingSize: null,
  helperModel: 'fast',
  isCustomOpen: false,
  isFolded: false,
  phase: 'idle',
  job: '',
  cards: [],
  startedAt: null,
  finishedAt: null,
}

const dockAtom = atom({ plugin: 'clean-view', key: 'dock' } as const, INITIAL)
const dockTickAtom = atom({ plugin: 'clean-view', key: 'dockTick' } as const, 0)

// -- module variables (a reload starts them over; the state above is the host's)
let ticker: { cancel: () => void } | undefined
let requestCalls = 0
let hasNudged = false
let isRequestLive = false
let perWave = 10
let slotLimit = 20
let faces: string[] = []
let lastNow = ''
const running = new Set<string>()

const getDock = async ($: any): Promise<DockState> =>
  ((await $.state.get({ plugin: 'clean-view', key: 'dock' } as const)).value as DockState | undefined) ?? INITIAL

const mutate = ($: any, fn: (d: DockState) => DockState) => update($, dockAtom, d => fn(d ?? INITIAL))

function stopTicker() {
  ticker?.cancel()
  ticker = undefined
}

/** The one clock: runs only while helpers are live. */
function startTicker($: any) {
  if (ticker !== undefined) return
  try {
    ticker = $.clock.every(500, () => {
      void update($, dockTickAtom, n => ((n ?? 0) + 1) % 1_000_000)
    })
  } catch {
    // no clock: the dock still updates on every event, it just does not animate
  }
}

async function syncTicker($: any) {
  const d = await getDock($)
  if (d.phase === 'live') startTicker($)
  else stopTicker()
}

async function refreshBadge($: any) {
  const d = await getDock($)
  if (!d.isFolded) {
    $.ui.status(undefined)
    return
  }
  const c = counts(d.cards)
  $.ui.status(c.total === 0 ? '◆ Agent Dock · standing by' : `◆ ${badge(c)}`)
}

/** Live helper count for the status line's "◇ N agents" segment. */
async function writeAgentsNow($: any, force = false) {
  try {
    const d = await getDock($)
    const c = counts(d.cards)
    const key = `${c.working}/${c.queued}`
    if (!force && key === lastNow) return
    lastNow = key
    const home = await $.env.get('HOME')
    if (home === undefined || home === '') return
    const sid = await $.session.id()
    const dir = `${home}/.claude/ai-employee-kit-data/agents-now`
    await $.process.run(['mkdir', '-p', dir])
    await $.fs.write(`${dir}/${sid}.json`, agentsNowJson(c.working, c.queued, await $.clock.now()))
  } catch {
    // the status line is a convenience; the dock still works without it
  }
}

async function sync($: any) {
  await syncTicker($)
  await refreshBadge($)
  void writeAgentsNow($)
}

async function loadFaces($: any) {
  try {
    const home = await $.env.get('HOME')
    const dirs = [`${$.plugin.root}/employee-headshots`]
    if (home) dirs.push(`${home}/.claude/ai-employee-kit-data/employee-headshots`)
    for (const dir of dirs) {
      let entries: Array<{ name: string; kind: string }> = []
      try {
        entries = await $.fs.list(dir)
      } catch {
        continue
      }
      const pngs = entries.filter(f => f.kind === 'file' && /\.png$/i.test(f.name)).slice(0, 12)
      const out: string[] = []
      for (const f of pngs) {
        try {
          const bytes = await $.fs.read(`${dir}/${f.name}`, { as: 'bytes' })
          if (bytes?.base64) out.push(bytes.base64)
        } catch {
          // skip a file that will not read
        }
      }
      if (out.length > 0) {
        faces = out
        return
      }
    }
  } catch {
    // no headshots: the colored badges stand in
  }
}

async function readLimits($: any) {
  const subs = await $.env.get('CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS')
  const tools = await $.env.get('CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY')
  slotLimit = engineLimit(subs)
  perWave = atATime(subs, tools)
}

// -- size, model, pane -------------------------------------------------------
async function applySize($: any, n: number) {
  await mutate($, d => ({ ...d, size: n, pendingSize: null, isCustomOpen: false }))
  try {
    await $.store.set('teamSize', n)
  } catch {
    // saving is a convenience
  }
}

async function requestSize($: any, n: number) {
  if (needsConfirm(n)) await mutate($, d => ({ ...d, pendingSize: n, isCustomOpen: false }))
  else await applySize($, n)
}

async function setHelperModel($: any, value: 'fast' | 'same') {
  await mutate($, d => ({ ...d, helperModel: value }))
  try {
    await $.store.set('panel.helperModel', value)
  } catch {
    // saving is a convenience
  }
}

async function openPane($: any) {
  await mutate($, d => ({ ...d, isFolded: false }))
  await refreshBadge($)
  const r = await $.ui.open({ id: PANE, title: 'Agent Dock', columns: PANE_COLUMNS })
  if (r && r.isPlaced === false) $.ui.toast(TOO_NARROW)
}

/** Fold to the status-bar badge when the pane is up, otherwise open it. */
async function toggleDock($: any) {
  const panes = await $.ui.panes()
  if (panes.some((p: any) => p.id === PANE)) {
    await mutate($, d => ({ ...d, isFolded: true }))
    await $.ui.close({ id: PANE })
    await refreshBadge($)
  } else {
    await openPane($)
  }
}

// -- drawing -------------------------------------------------------------------
const fit = (s: string, w: number) => (s.length > w ? s.slice(0, Math.max(1, w - 1)) + '…' : s.padEnd(w, ' '))
const spaced = (s: string) => s.split('').join(' ')

function renderPane($: any, e: any, d: DockState, tick: number, now: number) {
  const { Box, Text, Button, Input, Image } = $.ui.resolve(e) as any
  const cols = Math.max(30, Number(e.props?.bodyColumns ?? e.viewport?.columns ?? 72))
  const c = counts(d.cards)
  const isTerminal = e.surface === 'terminal'
  const rows: any[] = []

  // masthead
  const letters = WORDMARK.split('')
  const live = liveLabel(d.phase)
  const liveColor = d.phase === 'live' ? GREEN : d.phase === 'done' ? GOLD : HAIR
  const liveDot = d.phase === 'live' && tick % 2 === 1 ? '○' : '●'
  rows.push(
    <Box key="mast" flexDirection="row" width={cols} justifyContent="space-between">
      <Text bold>
        <Text color={CORAL}>{'◆  '}</Text>
        {letters.map((ch, i) => (
          <Text key={`w${i}`} color={blend(CORAL, GOLD, i / (letters.length - 1))}>
            {ch}
          </Text>
        ))}
      </Text>
      <Text color={liveColor} dimColor={d.phase === 'idle'}>
        {d.phase === 'done' ? '✓ ' : `${liveDot} `}
        {spaced(live)}
      </Text>
    </Box>,
  )
  rows.push(
    <Text key="rule" color={HAIR}>
      {'─'.repeat(cols)}
    </Text>,
  )

  // team size
  const isCustom = !(SIZES as readonly number[]).includes(d.size)
  const chip = (label: string, selected: boolean) =>
    selected ? (
      <Text backgroundColor={CORAL} color="#1b1b1f" bold>{` ${label} `}</Text>
    ) : (
      <Text dimColor>{` ${label} `}</Text>
    )
  rows.push(
    <Box key="size" flexDirection="row" flexWrap="wrap" marginTop={1} columnGap={1}>
      <Text dimColor>{spaced('TEAM SIZE')}{'  '}</Text>
      {SIZES.map(n => (
        <Button key={`size-${n}`} plain onPress={() => requestSize($, n)}>
          {chip(String(n), d.size === n)}
        </Button>
      ))}
      <Text color={HAIR}>{'│'}</Text>
      <Button
        key="size-custom"
        plain
        onPress={() => update($, dockAtom, x => ({ ...(x ?? INITIAL), isCustomOpen: !(x ?? INITIAL).isCustomOpen }))}
      >
        {chip(isCustom ? `Custom ${d.size}` : 'Custom', isCustom || d.isCustomOpen)}
      </Button>
    </Box>,
  )
  if (d.isCustomOpen) {
    rows.push(
      <Box key="custom" flexDirection="row" marginTop={1}>
        <Input
          key="dock-custom"
          label="How many helpers?"
          placeholder="1 to 100"
          autoFocus
          onSubmit={(value: string) => {
            const n = parseSize(value)
            if (n === null) $.ui.toast(BAD_SIZE_TOAST)
            else void requestSize($, n)
          }}
        />
      </Box>,
    )
  }
  rows.push(
    <Text key="info" dimColor wrap="truncate-end">
      {infoLine(d.size, perWave, d.helperModel)}
    </Text>,
  )
  rows.push(
    <Box key="model" flexDirection="row" columnGap={1}>
      <Text dimColor>Helper agents:</Text>
      <Button
        key="dock-model"
        plain
        onPress={() => setHelperModel($, d.helperModel === 'fast' ? 'same' : 'fast')}
      >
        <Text color={CORAL}>{d.helperModel === 'fast' ? 'Fast & Cheap' : 'Same as me'}</Text>
        <Text dimColor>{'  (press to change)'}</Text>
      </Button>
    </Box>,
  )

  // big team check
  if (d.pendingSize !== null) {
    const n = d.pendingSize
    rows.push(
      <Box
        key="confirm"
        flexDirection="column"
        borderStyle="round"
        borderColor={GOLD}
        paddingX={1}
        marginTop={1}
        width={cols}
      >
        <Text color={GOLD}>Big team: this uses your plan quickly. Continue?</Text>
        <Box flexDirection="row" columnGap={2}>
          <Button key="dock-confirm" variant="primary" label={`Continue with ${n}`} onPress={() => applySize($, n)} />
          <Button
            key="dock-cancel"
            label="Cancel"
            onPress={() => mutate($, x => ({ ...x, pendingSize: null }))}
          />
        </Box>
      </Box>,
    )
  }

  // idle: seats
  if (d.cards.length === 0 && d.phase === 'idle') {
    const seats = seatCount(d.size)
    rows.push(
      <Box key="seats" flexDirection="column" marginTop={1}>
        <Text>
          {Array.from({ length: seats }, (_, i) => (
            <Text key={`seat${i}`} color={badgeColor(`seat-${i}`)} dimColor={i % 3 === 1}>
              {i % 5 === 2 ? '◉ ' : '● '}
            </Text>
          ))}
        </Text>
        <Text>{`Your team of ${d.size} is standing by`}</Text>
        <Text dimColor>
          {d.size === 1
            ? 'Send a request and Claude decides how many helpers to use.'
            : `Send a request and it splits across ${d.size} helpers.`}
        </Text>
      </Box>,
    )
    return (
      <Box flexDirection="column" width={cols}>
        {rows}
      </Box>
    )
  }

  // mission bar
  const elapsed = (d.finishedAt ?? now) - (d.startedAt ?? now)
  const pct = d.phase === 'done' ? 100 : overallPercent(d.cards)
  rows.push(
    <Box key="mission" flexDirection="row" width={cols} justifyContent="space-between" marginTop={1}>
      <Text wrap="truncate-end">
        <Text dimColor>{spaced('MISSION')}{'   '}</Text>
        <Text bold>{d.job === '' ? 'Your request' : d.job}</Text>
      </Text>
      <Text>
        {pct}%{'   '}
        <Text dimColor>{clock(elapsed)}</Text>
      </Text>
    </Box>,
  )
  rows.push(
    <Text key="bar">
      {missionBar(c, cols, tick).map((s, i) => (
        <Text key={`b${i}`} color={s.color} dimColor={s.dim === true}>
          {s.text}
        </Text>
      ))}
    </Text>,
  )
  rows.push(
    <Text key="counts" wrap="truncate-end">
      <Text color={GREEN}>{`● ${c.working} working`}</Text>
      {'    '}
      <Text dimColor>{`○ ${c.queued} queued`}</Text>
      {'    '}
      <Text color={GOLD}>{`✓ ${c.done} done`}</Text>
      {'    '}
      <Text color={c.stuck > 0 ? RED : undefined} dimColor={c.stuck === 0}>{`✕ ${c.stuck} stuck`}</Text>
    </Text>,
  )

  if (d.phase === 'done') {
    rows.push(
      <Box key="summary" borderStyle="round" borderColor={GREEN} paddingX={1} width={cols}>
        <Text color={GREEN}>{summary(c, d.job === '' ? 'your request' : d.job, elapsed)}</Text>
      </Box>,
    )
  }

  // helpers
  const isTiles = d.cards.length > TILE_THRESHOLD
  const timerOf = (k: DockCard) =>
    k.startedAt === null ? '' : clock((k.endedAt ?? now) - k.startedAt)
  const tone = (k: DockCard) =>
    k.status === 'stuck' ? RED : k.status === 'done' ? GOLD : k.status === 'working' ? GREEN : HAIR

  const sweep = (width: number) => {
    const start = (tick % (width + 3)) - 3
    let out = ''
    for (let i = 0; i < width; i++) out += i >= start && i < start + 3 ? '━' : '─'
    return out
  }

  if (isTiles) {
    const tileW = 17
    const per = Math.max(1, Math.floor((cols + 1) / (tileW + 1)))
    const lines: DockCard[][] = []
    for (let i = 0; i < d.cards.length; i += per) lines.push(d.cards.slice(i, i + per))
    lines.forEach((line, li) =>
      rows.push(
        <Box key={`tl${li}`} flexDirection="row" columnGap={1}>
          {line.map(k => {
            const m = meter(cardPercent(k), 6)
            const queued = k.status === 'queued'
            return (
              <Box key={k.id} width={tileW} flexDirection="row" hover={{ backgroundColor: '#2a2a31' }}>
                <Text backgroundColor={queued ? HAIR : badgeColor(k.id)} color="#ffffff" bold>
                  {` ${initials(k.name)} `}
                </Text>
                <Text color={tone(k)} dimColor={queued}>
                  {' '}
                  {k.status === 'working' && !k.hasReported ? sweep(6) : m.full}
                  {k.status === 'working' && !k.hasReported ? '' : m.empty}
                </Text>
                <Text dimColor={queued || k.status === 'working'}>
                  {' '}
                  {k.status === 'stuck' ? '✕' : `${cardPercent(k)}%`}
                </Text>
              </Box>
            )
          })}
        </Box>,
      ),
    )
  } else {
    const per = perRow(cols)
    const cardW = Math.floor((cols - (per - 1)) / per)
    const faceW = 4
    const inner = cardW - 4
    const textW = inner - faceW - 1
    const lines: DockCard[][] = []
    for (let i = 0; i < d.cards.length; i += per) lines.push(d.cards.slice(i, i + per))
    lines.forEach((line, li) =>
      rows.push(
        <Box key={`cl${li}`} flexDirection="row" columnGap={1}>
          {line.map(k => {
            const queued = k.status === 'queued'
            const t = timerOf(k)
            const nameW = Math.max(6, textW - 6)
            const barW = Math.max(6, textW - 6)
            const pctLabel =
              k.status === 'stuck' ? 'stuck' : k.status === 'queued' ? 'queued' : `${cardPercent(k)}%`
            const m = meter(cardPercent(k), barW)
            const face =
              isTerminal && faces.length > 0 ? (
                <Image
                  key={`img-${k.id}`}
                  columns={faceW}
                  rows={2}
                  alt={initials(k.name)}
                  source={{ png: faces[hash(k.id) % faces.length]! }}
                />
              ) : (
                <Box width={faceW} flexShrink={0}>
                  <Text backgroundColor={queued ? HAIR : badgeColor(k.id)} color="#ffffff" bold>
                    {` ${initials(k.name)} `}
                  </Text>
                </Box>
              )
            return (
              <Box
                key={k.id}
                width={cardW}
                borderStyle="round"
                borderColor={k.status === 'stuck' ? RED : HAIR}
                hover={k.status === 'stuck' ? undefined : { borderColor: CORAL }}
                paddingX={1}
                flexDirection="row"
                columnGap={1}
              >
                {face}
                <Box flexDirection="column" width={textW}>
                  <Text dimColor={queued} bold={k.status === 'working'}>
                    {fit(k.name, nameW)}
                    <Text dimColor>{t.padStart(6, ' ')}</Text>
                  </Text>
                  <Text color={tone(k)} dimColor={queued}>
                    {k.status === 'working' && !k.hasReported ? sweep(barW) : m.full}
                    {k.status === 'working' && !k.hasReported ? '' : m.empty}
                    <Text dimColor={queued || k.status === 'working'}>{pctLabel.padStart(6, ' ')}</Text>
                  </Text>
                </Box>
              </Box>
            )
          })}
        </Box>,
      ),
    )
  }

  return (
    <Box flexDirection="column" width={cols}>
      {rows}
    </Box>
  )
}

// -- registration --------------------------------------------------------------
export function registerDock(on: On): void {
  // -- session start: saved settings, command, headshots -----------------------
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    const savedSize = await $.store.get('teamSize')
    const savedModel = await $.store.get('panel.helperModel')
    await $.state.set(
      { plugin: 'clean-view', key: 'dock' } as const,
      { ...INITIAL, size: restoreSize(savedSize), helperModel: restoreHelperModel(savedModel) },
    )
    requestCalls = 0
    hasNudged = false
    isRequestLive = false
    running.clear()
    lastNow = ''
    await readLimits($)
    await $.command.register({
      name: 'dock',
      description: 'Open or fold the Agent Dock, or set the Team Size',
      argumentHint: '[1-100]',
    })
    void loadFaces($)
    void writeAgentsNow($, true)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    try {
      const home = await $.env.get('HOME')
      if (home) {
        const sid = await $.session.id()
        await $.fs.write(
          `${home}/.claude/ai-employee-kit-data/agents-now/${sid}.json`,
          agentsNowJson(0, 0, await $.clock.now()),
        )
      }
    } catch {
      // nothing to clean up
    }
    return next(e)
  })

  // -- /dock ---------------------------------------------------------------------
  on('command.run', { command: 'dock' }, ($, e) => {
    try {
      const arg = String(e.args ?? '').trim()
      if (arg === '') {
        void (async () => {
          try {
            await toggleDock($)
          } catch {
            // the next press tries again
          }
        })()
        return { text: 'Agent Dock toggled.' }
      }
      const n = parseSize(arg)
      if (n === null) return { text: SLASH_BAD_SIZE }
      void (async () => {
        try {
          await requestSize($, n)
          if (needsConfirm(n)) await openPane($)
        } catch {
          // the dock shows the size on its next draw
        }
      })()
      if (needsConfirm(n)) return { text: `Confirm the team of ${n} in the Agent Dock.` }
      return { text: `Team Size is ${n}.` }
    } catch {
      return { text: 'The Agent Dock could not do that. Try again.' }
    }
  })

  // -- tell Claude to split the work ---------------------------------------------
  on('prompt.submit', async ($, e, next) => {
    try {
      const kind = e.origin?.kind
      const isPerson = kind === 'composer' || kind === 'bridge' || kind === 'sdk'
      const text = String(e.text ?? '')
      if (!isPerson || text.trim() === '' || text.trim().startsWith('/')) return next(e)
      const d = await getDock($)
      if (e.turnId === undefined) {
        requestCalls = 0
        hasNudged = false
        isRequestLive = true
        running.clear()
        const now = await $.clock.now()
        await mutate($, x => ({
          ...x,
          cards: [],
          job: jobName(text),
          phase: x.size > 1 ? 'live' : 'idle',
          startedAt: now,
          finishedAt: null,
        }))
        await sync($)
      }
      if (d.size === 1) return next(e)
      return next({ ...e, context: [...(e.context ?? []), instructionText(d.size)] })
    } catch {
      return next(e)
    }
  })

  // -- queued cards the moment Claude writes the Agent calls ----------------------
  on('session.append', { door: 'response' }, async ($, e, next) => {
    try {
      const content = (e.message as any)?.content
      if (e.agentId === undefined && Array.isArray(content)) {
        const found = content
          .filter((b: any) => b?.type === 'tool_use' && b.name === 'Agent' && typeof b.id === 'string')
          .map((b: any) => ({ id: b.id as string, description: b.input?.description }))
        if (found.length > 0) {
          const now = await $.clock.now()
          await mutate($, x => ({
            ...x,
            cards: addQueued(x.cards, found),
            phase: 'live',
            startedAt: x.startedAt ?? now,
            finishedAt: null,
          }))
          await sync($)
        }
      }
    } catch {
      // the cards also appear when the call itself starts
    }
    return next(e)
  })

  // -- the cap, the queue, the helper model ---------------------------------------
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const id = e.tool_use_id
    const d = await getDock($)
    const size = d.size
    if (size > 1 && requestCalls >= size) return { deny: capMessage(size) }
    requestCalls += 1

    // hold the call until a slot frees up: the engine refuses instead of queueing
    while (running.size >= slotLimit) {
      if (next.signal?.aborted) return { deny: STOPPED_MESSAGE }
      await $.process.run(['/bin/sleep', '1'])
      if (next.signal?.aborted) return { deny: STOPPED_MESSAGE }
    }
    running.add(id)

    const description = (e as any).description
    const now = await $.clock.now()
    await mutate($, x => ({
      ...x,
      cards: setStatus(x.cards, id, 'working', now, description),
      phase: 'live',
      startedAt: x.startedAt ?? now,
      finishedAt: null,
    }))
    await sync($)

    let status: 'done' | 'stuck' = 'stuck'
    try {
      const call: any = { ...e }
      if (size > 1) {
        call.run_in_background = false
        if (d.helperModel === 'fast' && call.model === undefined) call.model = 'haiku'
      }
      const ran: any = await next(call)
      if (ran.deny === undefined && ran.isError !== true) status = 'done'
      return ran
    } finally {
      running.delete(id)
      const at = await $.clock.now()
      await mutate($, x => ({ ...x, cards: setStatus(x.cards, id, status, at) }))
      await sync($)
    }
  })

  // -- helpers' progress: answered here so Clean View's checklist never sees it ---
  on('tool.call', { tool: REPORT, agentId: /./ }, async ($, e) => {
    const input = e as any
    const percent = clampPercent(Number(input.percent))
    await mutate($, x => ({
      ...x,
      cards: applyProgress(x.cards, String(e.agentId), String(input.task ?? ''), percent),
    }))
    return { result: `Progress noted: ${percent}%.` } as any
  })

  on('tool.call', { tool: PLAN, agentId: /./ }, () => ({ result: PLAN_REFUSAL }) as any)

  // -- the follow-up nudge and the finish -------------------------------------------
  on('turn.complete', { turnId: /^/ }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || !isRequestLive) return result
    try {
      const d = await getDock($)
      const ok = !e.isAborted && e.reason !== 'error' && e.reason !== 'refusal'
      if (ok && shouldNudge(d.size, requestCalls, hasNudged)) {
        hasNudged = true
        void $.prompt.submit({ text: nudgeText(requestCalls, d.size) })
        return result
      }
      isRequestLive = false
      const now = await $.clock.now()
      await mutate($, x => {
        if (x.cards.length === 0) return { ...x, phase: 'idle', finishedAt: now }
        const cards = x.cards.map(k =>
          k.status === 'queued' || k.status === 'working'
            ? e.isAborted || !isFinished(x.cards)
              ? { ...k, status: 'stuck' as const, endedAt: now }
              : k
            : k,
        )
        return { ...x, cards, phase: 'done', finishedAt: now }
      })
      running.clear()
      await sync($)
    } catch {
      // the dock catches up on the next request
    }
    return result
  })

  // -- the pane ------------------------------------------------------------------------
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const d = await read($, dockAtom)
    const tick = await read($, dockTickAtom)
    const now = await $.clock.now()
    return renderPane($, e, d, tick ?? 0, now)
  })

  // -- the ◆ Dock button above the prompt ------------------------------------------------
  on('ui.render', { component: /^AbovePrompt$/ }, async ($, e, next) => {
    const inner = await next(e)
    if ((e.props as any).hasSurvey) return inner
    const { Box, Button, Text } = $.ui.resolve(e) as any
    const d = await read($, dockAtom)
    const c = counts(d.cards)
    return (
      <Box flexDirection="column">
        {inner}
        <Box flexDirection="row" justifyContent="flex-end">
          <Button key="dock-open" plain onPress={() => toggleDock($)}>
            <Text color={CORAL}>{'◆ Dock'}</Text>
            {c.total > 0 && d.phase === 'live' ? <Text dimColor>{` · ${c.working} working`}</Text> : null}
          </Button>
        </Box>
      </Box>
    )
  })
}


