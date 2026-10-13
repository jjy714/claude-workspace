import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { RoadTripView } from '../types'
import {
  TICK_MS,
  buttonsFor,
  drawGame,
  garageAct,
  garageStatus,
  keepDriving,
  moveLane,
  newGame,
  onTurnComplete,
  onTurnStart,
  openGarage,
  packCells,
  paletteFor,
  sanitizeProfile,
  setSize,
  taskDone,
  tick,
  togglePause,
  tooSmall,
  type Game,
  type Profile,
  type Skin,
} from './road-trip-game'

const PANE = 'road-trip'
const STORE_PROFILE = 'profile'
const STORE_PREFS = 'prefs'

const view = atom({ plugin: 'road-trip', key: 'view' } as const, { mode: 'countdown', sig: '' } as RoadTripView)
const CLEAN_VIEW = { plugin: 'clean-view', key: 'checklist' } as const
const BRAND_SKIN = { plugin: 'brand-skin', key: 'skin' } as const

type Dollar = Parameters<Parameters<On>[2]>[0]

const doneCount = (items: unknown): number => {
  const list = Array.isArray(items)
    ? items
    : items && typeof items === 'object'
      ? ((items as Record<string, unknown>).items ?? (items as Record<string, unknown>).steps ?? (items as Record<string, unknown>).todos)
      : undefined
  if (!Array.isArray(list)) return -1
  return list.filter(
    (s: any) => s && (s.done === true || s.completed === true || s.status === 'completed' || s.status === 'done'),
  ).length
}

let game: Game | null = null
let profile: Profile = sanitizeProfile(undefined)
let enabled = true
let retro = false
let skin: Skin | null = null
let isOpen = false
let tooSmallNow = false
let timer: { cancel: () => void } | null = null
let busy = false
let lastTick = 0
let frames = 0
let lastClean = 0
let lastTodo = 0
let usingSteps = false
let sig = ''

const later = ($: Dollar, fn: () => unknown) => {
  try {
    $.clock.after(1, () => {
      try {
        void Promise.resolve(fn()).catch(() => {})
      } catch {}
    })
  } catch {}
}

const save = async ($: Dollar) => {
  try {
    if (game) profile = game.p
    await $.store.set(STORE_PROFILE, profile)
  } catch {}
}

const savePrefs = async ($: Dollar) => {
  try {
    await $.store.set(STORE_PREFS, { enabled, retro })
  } catch {}
}

const load = async ($: Dollar) => {
  try {
    profile = sanitizeProfile(await $.store.get(STORE_PROFILE))
  } catch {
    profile = sanitizeProfile(undefined)
  }
  try {
    const prefs = (await $.store.get(STORE_PREFS)) as { enabled?: unknown; retro?: unknown } | undefined
    enabled = prefs?.enabled !== false
    retro = prefs?.retro === true
  } catch {}
}

const palette = () => paletteFor(retro, skin)

const stopClock = () => {
  try {
    timer?.cancel()
  } catch {}
  timer = null
}

const syncView = async ($: Dollar) => {
  if (!game) return
  const st = game.mode === 'garage' ? garageStatus(game) : null
  const next = `${game.mode}|${game.garageIdx}|${st?.canAct ?? ''}|${st?.text ?? ''}`
  if (next === sig) return
  sig = next
  try {
    await update($, view, () => ({ mode: game!.mode, sig: next }))
  } catch {}
}

const blit = async ($: Dollar) => {
  if (!game || tooSmallNow) return
  try {
    await $.ui.blit({
      requestId: PANE,
      key: 'road',
      cells: packCells(drawGame(game, palette())),
    })
  } catch {}
}

// Shared state is read only every 12 frames.
const syncShared = async ($: Dollar) => {
  try {
    const { value } = await $.state.get(BRAND_SKIN)
    skin = value && typeof value === 'object' ? (value as Skin) : null
  } catch {}
  try {
    const { value } = await $.state.get(CLEAN_VIEW)
    const done = doneCount(value)
    if (done >= 0) {
      usingSteps = true
      if (game && done > lastClean) taskDone(game, done - lastClean)
      lastClean = done
    }
  } catch {}
}

const step = async ($: Dollar) => {
  if (!game || !isOpen || busy || tooSmallNow) return
  busy = true
  try {
    const now = Date.now()
    const dt = lastTick ? now - lastTick : TICK_MS
    lastTick = now
    tick(game, dt)
    frames += 1
    if (frames % 12 === 0) await syncShared($)
    if (game.saveNow) {
      game.saveNow = false
      await save($)
    }
    await syncView($)
    if (game.dirty) {
      game.dirty = false
      await blit($)
    }
  } catch {
  } finally {
    busy = false
  }
}

const startClock = ($: Dollar) => {
  if (timer) return
  lastTick = 0
  try {
    timer = $.clock.every(TICK_MS, () => void step($))
  } catch {}
}

const closeGame = async ($: Dollar) => {
  stopClock()
  isOpen = false
  if (game) {
    game.p.best = Math.max(game.p.best, Math.floor(game.dist))
    await save($)
  }
}

const openPane = ($: Dollar) => {
  profile = sanitizeProfile(profile)
  game = newGame(profile)
  game.retro = retro
  isOpen = true
  tooSmallNow = false
  sig = ''
  lastClean = 0
  lastTodo = 0
  usingSteps = false
  frames = 0
  // Straight from the person's command or press, so it is placed at any width.
  const opened = $.ui.open({ id: PANE, title: 'Road Trip', focus: true, rows: 30, columns: 110 })
  void Promise.resolve(opened)
    .then(r => {
      if (r && r.isPlaced === false) $.ui.toast('Road Trip needs a little more room: widen the window')
    })
    .catch(() => {})
}

const closePane = async ($: Dollar) => {
  try {
    await $.ui.close({ id: PANE })
  } catch {}
  await closeGame($)
}

const act = async ($: Dollar, action: string) => {
  if (!game) return
  try {
    if (action === 'left') moveLane(game, -1)
    else if (action === 'right') moveLane(game, 1)
    else if (action === 'pause') togglePause(game)
    else if (action === 'garage') openGarage(game)
    else if (action === 'buy') garageAct(game)
    else if (action === 'keep') keepDriving(game)
    else if (action === 'close') return await closePane($)
    game.dirty = true
    if (game.saveNow) {
      game.saveNow = false
      await save($)
    }
    await syncView($)
  } catch {}
}


export function registerRoadTrip(on: On) {
  on('session.start', async ($, e, next) => {
    await load($)
    try {
      await $.command.register({
        name: 'roadtrip',
        description: 'Play Road Trip in a pane above the prompt while Claude works',
        argumentHint: 'play | on | off | retro on|off',
      })
    } catch {}
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await closeGame($)
    return next(e)
  })

  on('command.run', { command: 'roadtrip' }, ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const [word, arg] = words
    if (!word || word === 'play') {
      if (!enabled) return { text: 'Road Trip is off. Type /roadtrip on to turn it back on.' }
      openPane($)
      return { text: 'Road Trip is starting. A/D steer, P pause, G garage.' }
    }
    if (word === 'on') {
      enabled = true
      later($, () => savePrefs($))
      openPane($)
      return { text: 'Road Trip is on.' }
    }
    if (word === 'off') {
      enabled = false
      later($, async () => {
        await closePane($)
        await savePrefs($)
      })
      return { text: 'Road Trip is off. Type /roadtrip on to bring it back.' }
    }
    if (word === 'retro' && (arg === 'on' || arg === 'off')) {
      retro = arg === 'on'
      if (game) {
        game.retro = retro
        game.dirty = true
      }
      later($, () => savePrefs($))
      return { text: `Retro mode is ${arg}.` }
    }
    return { text: 'Usage: /roadtrip [play] | on | off | retro on|off' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const out = await next(e)
    await closeGame($)
    return out
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    try {
      usingSteps = false
      lastTodo = 0
      if (isOpen && game) {
        onTurnStart(game)
        game.dirty = true
      }
    } catch {}
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      if (isOpen && game && !e.agentId) {
        onTurnComplete(game)
        await save($)
      }
    } catch {}
    return next(e)
  })

  // A finished step is a task coin.
  on('tool.call', async ($, e, next) => {
    if (!isOpen || !game) return next(e)
    const a = ((e as any).input ?? e) as Record<string, any>
    const name = String(e.tool)
    try {
      if (name === 'TodoWrite' && Array.isArray(a.todos)) {
        usingSteps = true
        const done = a.todos.filter((t: any) => t && t.status === 'completed').length
        if (done > lastTodo) taskDone(game, done - lastTodo)
        lastTodo = done
      } else if (name === 'TaskUpdate') {
        usingSteps = true
        if (a.status === 'completed') taskDone(game)
      }
    } catch {}
    const result = await next(e)
    try {
      if (!usingSteps && game && isOpen && name !== 'TodoWrite' && name !== 'TaskUpdate' && name !== 'TaskCreate') {
        taskDone(game)
      }
    } catch {}
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>Road Trip plays in the terminal.</Text>
    }
    const { Box, Text, Button, Raster } = $.ui.resolve(e)
    await read($, view)
    const cols = Math.min(512, e.props.bodyColumns)
    const bodyRows = e.props.scroll?.bodyRows ?? Math.max(1, (e.viewport?.rows ?? 30) - 4)
    if (!game || tooSmall(cols, bodyRows)) {
      tooSmallNow = true
      return <Text>Make this panel a little bigger to drive</Text>
    }
    tooSmallNow = false
    const rows = Math.min(256, bodyRows - 1)
    setSize(game, cols, rows)
    game.dirty = false
    startClock($)
    const buttons = buttonsFor(game)
    return (
      <Box flexDirection="column">
        <Raster key="road" columns={cols} rows={rows} cells={packCells(drawGame(game, palette(), cols, rows))} />
        <Box flexDirection="row" gap={2}>
          {buttons.map(b => (
            <Button key={b.action} hotkey={b.hotkey} plain onPress={() => act($, b.action)}>
              {b.label}
            </Button>
          ))}
        </Box>
      </Box>
    )
  })

  // The ▶ Road Trip button: one slim row above the prompt while the game is closed.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!enabled || isOpen || e.surface !== 'terminal') return next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box>
        <Button key="road-trip-open" plain onPress={() => openPane($)}>
          ▶ Road Trip
        </Button>
      </Box>
    )
  })

}
