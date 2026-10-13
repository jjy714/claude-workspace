// Road Trip: game rules and renderer. Pure: no `$`, no timers, no storage.
import { CARS, QUIZZES, carById, levelFor, type Car, type Quiz } from './road-trip-art'

export const TICK_MS = 70
export const MIN_COLS = 36
export const MIN_ROWS = 8

export type Mode = 'countdown' | 'drive' | 'crash' | 'pause' | 'arrived' | 'garage'

export type Profile = {
  bank: number
  owned: string[]
  car: string
  xp: number
  best: number
  quizRight: number
  quizTotal: number
}

export type Palette = {
  road: number
  edge: number
  line: number
  grass: number
  tree: number
  hud: number
  hudDim: number
  text: number
  accent: number
  coin: number
  task: number
  bad: number
  box: number
  gate: [number, number, number]
}

const DEFAULT_PAL: Palette = {
  road: 0x23222e,
  edge: 0x6e7cf6,
  line: 0xfff6e8,
  grass: 0x15151c,
  tree: 0x3f9d6a,
  hud: 0xfff6e8,
  hudDim: 0x9a98b0,
  text: 0xfff6e8,
  accent: 0xff3d97,
  coin: 0xffd23f,
  task: 0xff8a1f,
  bad: 0xff5a5a,
  box: 0x1c1b24,
  gate: [0xff3d97, 0x35c9a8, 0x6e7cf6],
}

export const RETRO_PAL = (amber = false): Palette => ({
  road: 0x000000,
  edge: 0xff00ff,
  line: 0x00ffff,
  grass: 0x000000,
  tree: 0x008f11,
  hud: amber ? 0xffb000 : 0x33ff66,
  hudDim: amber ? 0x8a5f00 : 0x1a8f3a,
  text: amber ? 0xffb000 : 0x33ff66,
  accent: 0xff00ff,
  coin: 0xffff00,
  task: 0xff8800,
  bad: 0xff2020,
  box: 0x000000,
  gate: [0xff00ff, 0x00ffff, 0xffff00],
})

export type Skin = Partial<Record<'primary' | 'accent' | 'text' | 'ink', string>>

const at = <T,>(list: ArrayLike<T>, i: number): T => list[i] as T

const hex = (v: unknown): number | undefined => {
  if (typeof v !== 'string') return undefined
  const m = /^#?([0-9a-f]{6})$/i.exec(v.trim())
  return m ? parseInt(m[1] ?? '', 16) : undefined
}

export function paletteFor(retro: boolean, skin?: Skin | null): Palette {
  if (retro) return RETRO_PAL(false)
  const p: Palette = { ...DEFAULT_PAL, gate: [...DEFAULT_PAL.gate] as Palette['gate'] }
  if (skin && typeof skin === 'object') {
    const primary = hex(skin.primary)
    const accent = hex(skin.accent)
    const text = hex(skin.text)
    const ink = hex(skin.ink)
    if (primary !== undefined) { p.edge = primary; p.gate[2] = primary }
    if (accent !== undefined) { p.accent = accent; p.gate[0] = accent }
    if (text !== undefined) { p.text = text; p.hud = text; p.line = text }
    if (ink !== undefined) p.box = ink
  }
  return p
}

// ---------------------------------------------------------------- profile

const whole = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0

export function sanitizeProfile(raw: unknown): Profile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ids = new Set(CARS.map(c => c.id as string))
  const owned = Array.isArray(r.owned) ? r.owned.filter((id): id is string => typeof id === 'string' && ids.has(id)) : []
  const set = Array.from(new Set(['hatch', ...owned]))
  const car = typeof r.car === 'string' && set.includes(r.car) ? r.car : 'hatch'
  return {
    bank: whole(r.bank),
    owned: set,
    car,
    xp: whole(r.xp),
    best: whole(r.best),
    quizRight: whole(r.quizRight),
    quizTotal: whole(r.quizTotal),
  }
}

// ---------------------------------------------------------------- state

export type ObjKind = 'barrier' | 'cone' | 'pothole' | 'coin' | 'task' | 'gate'
export type Obj = { kind: ObjKind; lane: number; y: number }

export type QuizState = {
  phase: 'idle' | 'ask' | 'gate'
  quiz?: Quiz
  lanes: [string, string, string]
  right: number
  ms: number
  gateY: number
}

export type Arrived = { dist: number; runCoins: number; best: number; right: number; level: number; bank: number }

export type Game = {
  p: Profile
  mode: Mode
  resume: Mode
  frame: number
  scroll: number
  dist: number
  speed: number
  lane: number
  target: number
  objs: Obj[]
  runCoins: number
  runRight: number
  shieldUsed: boolean
  msg: string
  msgMs: number
  msgBad: boolean
  shakeMs: number
  modeMs: number
  nitroMs: number
  taskQueue: number
  spawnCd: number
  quiz: QuizState
  nextQuizMs: number
  lastQuiz: number
  garageIdx: number
  garageNote: string
  arrived: Arrived
  retro: boolean
  cols: number
  rows: number
  seed: number
  saveNow: boolean
  dirty: boolean
}

const rnd = (g: Game): number => {
  g.seed = (g.seed + 0x6d2b79f5) | 0
  let t = g.seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export const carOf = (g: Game): Car => carById(g.p.car) ?? at(CARS, 0)
export const levelOf = (g: Game) => levelFor(g.p.xp)

const quizDelay = (g: Game) => 25000 + rnd(g) * 5000

export function newGame(profile: Profile, seed = Date.now() | 0): Game {
  const g: Game = {
    p: sanitizeProfile(profile),
    mode: 'countdown',
    resume: 'drive',
    frame: 0,
    scroll: 0,
    dist: 0,
    speed: 8,
    lane: 1,
    target: 1,
    objs: [],
    runCoins: 0,
    runRight: 0,
    shieldUsed: false,
    msg: '',
    msgMs: 0,
    msgBad: false,
    shakeMs: 0,
    modeMs: 3000,
    nitroMs: 0,
    taskQueue: 0,
    spawnCd: 6,
    quiz: { phase: 'idle', lanes: ['', '', ''], right: 0, ms: 0, gateY: 0 },
    nextQuizMs: 0,
    lastQuiz: -1,
    garageIdx: 0,
    garageNote: '',
    arrived: { dist: 0, runCoins: 0, best: 0, right: 0, level: 1, bank: 0 },
    retro: false,
    cols: 80,
    rows: 20,
    seed,
    saveNow: false,
    dirty: true,
  }
  g.nextQuizMs = quizDelay(g)
  startRun(g, 3000)
  return g
}

export function setSize(g: Game, cols: number, rows: number) {
  if (g.cols !== cols || g.rows !== rows) g.dirty = true
  g.cols = cols
  g.rows = rows
}

function say(g: Game, text: string, ms = 1400, bad = false) {
  g.msg = text
  g.msgMs = ms
  g.msgBad = bad
  g.dirty = true
}

export function startRun(g: Game, countdownMs: number) {
  g.dist = 0
  g.speed = 8
  g.lane = 1
  g.target = 1
  g.objs = []
  g.runCoins = 0
  g.runRight = 0
  g.shieldUsed = false
  g.shakeMs = 0
  g.msgMs = 0
  g.nitroMs = carOf(g).nitroStart ? 4000 : 0
  g.spawnCd = 6
  g.quiz = { phase: 'idle', lanes: ['', '', ''], right: 0, ms: 0, gateY: 0 }
  g.nextQuizMs = quizDelay(g)
  g.mode = 'countdown'
  g.modeMs = countdownMs
  g.dirty = true
}

function resumeDriving(g: Game, countdownMs: number) {
  g.mode = 'countdown'
  g.modeMs = countdownMs
  g.dirty = true
}

// ---------------------------------------------------------------- controls

export function moveLane(g: Game, dir: -1 | 1) {
  if (g.mode === 'garage') return garageMove(g, dir)
  if (g.mode !== 'drive' && g.mode !== 'countdown') return
  g.target = Math.max(0, Math.min(2, g.target + dir))
}

export function togglePause(g: Game) {
  if (g.mode === 'drive' || g.mode === 'countdown') {
    g.resume = g.mode
    g.mode = 'pause'
  } else if (g.mode === 'pause') {
    resumeDriving(g, 1500)
  }
  g.dirty = true
}

export function openGarage(g: Game) {
  if (g.mode === 'garage') return closeGarage(g)
  if (g.mode === 'crash') return
  g.mode = 'garage'
  const i = CARS.findIndex(c => c.id === g.p.car)
  g.garageIdx = i < 0 ? 0 : i
  g.garageNote = ''
  g.dirty = true
}

export function closeGarage(g: Game) {
  if (g.mode !== 'garage') return
  resumeDriving(g, 2000)
}

export function garageMove(g: Game, dir: -1 | 1) {
  g.garageIdx = (g.garageIdx + dir + CARS.length) % CARS.length
  g.garageNote = ''
  g.dirty = true
}

export type GarageStatus = { text: string; canAct: boolean }

export function garageStatus(g: Game): GarageStatus {
  const c = at(CARS, g.garageIdx)
  const owned = g.p.owned.includes(c.id)
  const lvl = levelOf(g).level
  if (g.p.car === c.id) return { text: 'Driving this one', canAct: false }
  if (owned) return { text: 'Owned, press B to drive it', canAct: true }
  if (lvl < c.level) return { text: `Locked, reach level ${c.level}`, canAct: false }
  if (g.p.bank >= c.price) return { text: `Press B to buy for ${c.price} coins`, canAct: true }
  return { text: `${c.price} coins, you have ${g.p.bank}`, canAct: false }
}

// B in the garage: buy or pick. Returns true when the car changed.
export function garageAct(g: Game): boolean {
  if (g.mode !== 'garage') return false
  const c = at(CARS, g.garageIdx)
  const st = garageStatus(g)
  if (!st.canAct) return false
  if (!g.p.owned.includes(c.id)) {
    g.p.bank -= c.price
    g.p.owned = [...g.p.owned, c.id]
  }
  g.p.car = c.id
  g.saveNow = true
  startRun(g, 3000)
  return true
}

export function onTurnComplete(g: Game) {
  if (g.mode === 'arrived') return
  if (g.mode === 'crash') return
  g.resume = g.mode === 'pause' || g.mode === 'garage' ? 'drive' : g.mode
  g.p.best = Math.max(g.p.best, Math.floor(g.dist))
  g.arrived = {
    dist: Math.floor(g.dist),
    runCoins: g.runCoins,
    best: g.p.best,
    right: g.p.quizRight,
    level: levelOf(g).level,
    bank: g.p.bank,
  }
  g.mode = 'arrived'
  g.saveNow = true
  g.dirty = true
}

export function onTurnStart(g: Game) {
  if (g.mode === 'arrived' || g.mode === 'pause') resumeDriving(g, 1500)
}

export const keepDriving = onTurnStart

export function taskDone(g: Game, n = 1) {
  g.taskQueue = Math.min(3, g.taskQueue + n)
}

// ---------------------------------------------------------------- simulation

const OBSTACLES: ObjKind[] = ['barrier', 'cone', 'pothole']

function laneBusy(g: Game, lane: number, nearY: number): boolean {
  return g.objs.some(o => o.lane === lane && Math.abs(o.y - nearY) < 4)
}

function spawn(g: Game) {
  const top = 1.5
  const roll = rnd(g)
  const lanes = [0, 1, 2]
  if (roll < 0.65) {
    // obstacles in one or two lanes: never all three
    const count = rnd(g) < 0.75 ? 1 : 2
    const taken: number[] = []
    for (let i = 0; i < count; i++) {
      const free = lanes.filter(l => !taken.includes(l))
      taken.push(at(free, Math.floor(rnd(g) * free.length)))
    }
    for (const lane of taken) {
      g.objs.push({ kind: at(OBSTACLES, Math.floor(rnd(g) * OBSTACLES.length)), lane, y: top })
    }
  } else {
    const lane = Math.floor(rnd(g) * 3)
    for (let i = 0; i < 4; i++) g.objs.push({ kind: 'coin', lane, y: top - i * 2 })
  }
  if (g.taskQueue > 0) {
    const free = lanes.filter(l => !laneBusy(g, l, top))
    if (free.length) {
      g.taskQueue -= 1
      g.objs.push({ kind: 'task', lane: at(free, Math.floor(rnd(g) * free.length)), y: top - 1 })
    }
  }
  g.spawnCd = 8 + rnd(g) * 6
}

function addCoins(g: Game, n: number) {
  const gain = n * (carOf(g).double ? 2 : 1)
  g.p.bank += gain
  g.runCoins += gain
}

function addXp(g: Game, n: number) {
  const before = levelOf(g).level
  g.p.xp += n
  if (levelOf(g).level > before) say(g, `Level ${levelOf(g).level}!`, 1600)
}

function crash(g: Game) {
  g.p.best = Math.max(g.p.best, Math.floor(g.dist))
  g.mode = 'crash'
  g.modeMs = 2000
  g.shakeMs = 500
  g.saveNow = true
  say(g, 'Flat tire!', 2000, true)
}

function startQuiz(g: Game) {
  let i = Math.floor(rnd(g) * QUIZZES.length)
  if (i === g.lastQuiz) i = (i + 1) % QUIZZES.length
  g.lastQuiz = i
  const quiz = at(QUIZZES, i)
  const order = [0, 1, 2]
  for (let k = 2; k > 0; k--) {
    const j = Math.floor(rnd(g) * (k + 1))
    ;[order[k], order[j]] = [at(order, j), at(order, k)] as [number, number]
  }
  // order[lane] = which answer sits in that lane
  const lanes = order.map(a => quiz.a[a]) as [string, string, string]
  g.quiz = { phase: 'ask', quiz, lanes, right: order.indexOf(quiz.ok), ms: 3000, gateY: 0 }
  g.dirty = true
}

function resolveGate(g: Game) {
  const q = g.quiz
  const lane = Math.round(g.lane)
  g.p.quizTotal += 1
  if (lane === q.right) {
    g.p.quizRight += 1
    g.runRight += 1
    addCoins(g, 15)
    addXp(g, 60)
    g.nitroMs = 4000
    say(g, 'Correct! NITRO +15 coins', 1800)
  } else {
    say(g, `Nope! Right answer: ${'ABC'[q.right]} ${q.lanes[q.right]}`, 2400, true)
  }
  g.saveNow = true
  g.quiz = { phase: 'idle', lanes: q.lanes, right: q.right, ms: 0, gateY: 0 }
  g.nextQuizMs = quizDelay(g)
}

export function tick(g: Game, dtMs: number) {
  g.frame += 1
  const dt = Math.max(0, Math.min(200, dtMs))
  if (g.msgMs > 0) {
    g.msgMs -= dt
    if (g.msgMs <= 0) g.dirty = true
  }
  if (g.shakeMs > 0) g.shakeMs -= dt
  // lanes ease, never snap
  g.lane += (g.target - g.lane) * Math.min(1, dt / 110)
  if (Math.abs(g.target - g.lane) < 0.02) g.lane = g.target

  if (g.mode === 'countdown') {
    g.modeMs -= dt
    if (g.modeMs <= 0) {
      g.mode = 'drive'
      say(g, 'GO!', 700)
    }
    g.dirty = true
    return
  }
  if (g.mode === 'crash') {
    g.modeMs -= dt
    g.dirty = true
    if (g.modeMs <= 0) startRun(g, 1500)
    return
  }
  if (g.mode !== 'drive') return

  g.dirty = true
  const boost = g.nitroMs > 0
  if (boost) g.nitroMs -= dt
  g.speed = (8 + Math.min(9, g.dist / 300)) * (boost ? 1.6 : 1)
  const rows = (g.speed * dt) / 1000
  g.scroll += rows
  const meters = rows * 1.4
  g.dist += meters
  g.p.xp += meters * 0.5
  const lvlNow = levelOf(g).level
  if (g.frame % 50 === 0 && lvlNow > 1 && g.msgMs <= 0) g.dirty = true

  // quiz timing
  if (g.quiz.phase === 'idle') {
    g.nextQuizMs -= dt
    if (g.nextQuizMs <= 0) startQuiz(g)
  } else if (g.quiz.phase === 'ask') {
    g.quiz.ms -= dt
    if (g.quiz.ms <= 0) {
      g.quiz.phase = 'gate'
      g.quiz.gateY = 1
      // keep the gate's approach clear
      g.objs = g.objs.filter(o => o.kind === 'coin' || o.kind === 'task' || o.y > 9)
    }
  }

  g.spawnCd -= rows
  if (g.spawnCd <= 0 && g.quiz.phase !== 'gate' && !(g.quiz.phase === 'ask' && g.quiz.ms < 1500)) spawn(g)

  for (const o of g.objs) o.y += rows
  if (g.quiz.phase === 'gate') {
    g.quiz.gateY += rows
    if (g.quiz.gateY + 1 >= g.rows - 2) resolveGate(g)
  }

  // pickups and hits
  const car = carOf(g)
  const kept: Obj[] = []
  for (const o of g.objs) {
    if (o.y > g.rows + 1) continue
    const inBand = o.y > g.rows - 3.7 && o.y < g.rows - 0.4
    const dl = Math.abs(o.lane - g.lane)
    if (inBand && (o.kind === 'coin' || o.kind === 'task')) {
      const reach = car.magnet ? 1.6 : 0.55
      if (dl < reach) {
        addCoins(g, o.kind === 'task' ? 10 : 1)
        g.saveNow = g.saveNow || o.kind === 'task'
        continue
      }
    } else if (inBand && dl < 0.55 && o.kind !== 'gate') {
      if (g.nitroMs > 0) {
        addCoins(g, 2)
        continue
      }
      if (car.shield && !g.shieldUsed) {
        g.shieldUsed = true
        say(g, 'Shield saved you!', 1400)
        continue
      }
      crash(g)
      kept.push(o)
      continue
    }
    kept.push(o)
  }
  g.objs = kept

  if (g.frame % 600 === 0) g.saveNow = true
}

// ---------------------------------------------------------------- drawing

export type Grid = { w: number; h: number; cp: Uint32Array; fg: Uint32Array; bg: Uint32Array }

export function makeGrid(w: number, h: number, bg: number): Grid {
  const n = w * h
  const grid: Grid = { w, h, cp: new Uint32Array(n), fg: new Uint32Array(n), bg: new Uint32Array(n) }
  grid.cp.fill(32)
  grid.fg.fill(0xffffff)
  grid.bg.fill(bg)
  return grid
}

function put(grid: Grid, x: number, y: number, ch: string, fg: number, bg?: number) {
  if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) return
  const i = y * grid.w + x
  const cp = ch.codePointAt(0) ?? 32
  grid.cp[i] = cp > 0xffff ? 63 : cp
  grid.fg[i] = fg
  if (bg !== undefined) grid.bg[i] = bg
}

function text(grid: Grid, x: number, y: number, s: string, fg: number, bg?: number) {
  let cx = x
  for (const ch of s) {
    put(grid, cx, y, ch, fg, bg)
    cx += 1
  }
}

const centerText = (grid: Grid, y: number, s: string, fg: number, bg?: number) =>
  text(grid, Math.max(0, Math.floor((grid.w - [...s].length) / 2)), y, s, fg, bg)

function box(grid: Grid, x: number, y: number, w: number, h: number, bg: number, edge: number) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) put(grid, x + i, y + j, ' ', edge, bg)
  }
  for (let i = 0; i < w; i++) {
    put(grid, x + i, y, '─', edge, bg)
    put(grid, x + i, y + h - 1, '─', edge, bg)
  }
  for (let j = 0; j < h; j++) {
    put(grid, x, y + j, '│', edge, bg)
    put(grid, x + w - 1, y + j, '│', edge, bg)
  }
  put(grid, x, y, '┌', edge, bg)
  put(grid, x + w - 1, y, '┐', edge, bg)
  put(grid, x, y + h - 1, '└', edge, bg)
  put(grid, x + w - 1, y + h - 1, '┘', edge, bg)
}

// A solid dark box with centered lines: every overlay uses this.
function overlay(grid: Grid, pal: Palette, lines: { s: string; fg?: number }[], top?: number) {
  const inner = Math.min(grid.w - 4, Math.max(...lines.map(l => [...l.s].length)) + 4)
  const w = Math.max(10, inner)
  const h = lines.length + 2
  const x = Math.floor((grid.w - w) / 2)
  const y = top ?? Math.max(2, Math.floor((grid.h - h) / 2))
  box(grid, x, y, w, h, pal.box, pal.edge)
  lines.forEach((l, i) => {
    const s = [...l.s].slice(0, w - 2).join('')
    text(grid, x + 1 + Math.floor((w - 2 - [...s].length) / 2), y + 1 + i, s, l.fg ?? pal.text, pal.box)
  })
}

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US')

const hash = (n: number) => {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  return (h ^ (h >>> 12)) >>> 0
}

type Geo = { laneW: number; amp: number; cx: number }

const geo = (cols: number): Geo => {
  const laneW = Math.max(5, Math.min(16, Math.floor((cols - 14) / 3)))
  const spare = Math.floor((cols - laneW * 3) / 2) - 4
  return { laneW, amp: Math.max(0, Math.min(3, spare)), cx: Math.floor(cols / 2) }
}

const curveAt = (g: Game, gm: Geo, row: number) =>
  Math.round(gm.amp * Math.sin(g.scroll / 20 - row * 0.07))

const roadLeft = (g: Game, gm: Geo, row: number) =>
  gm.cx - Math.floor((gm.laneW * 3) / 2) + curveAt(g, gm, row)

const laneX = (g: Game, gm: Geo, lane: number, row: number) =>
  roadLeft(g, gm, row) + gm.laneW * lane + Math.floor(gm.laneW / 2)

function drawScene(grid: Grid, g: Game, pal: Palette) {
  const gm = geo(grid.w)
  const shx = g.shakeMs > 0 ? (g.frame % 2 === 0 ? 1 : -1) : 0
  for (let r = 2; r < grid.h; r++) {
    const left = roadLeft(g, gm, r) + shx
    const world = Math.floor(g.scroll) - r
    // grass and trees
    for (let x = 0; x < grid.w; x++) put(grid, x, r, ' ', pal.grass, pal.grass)
    const h = hash(world)
    if (h % 3 === 0) {
      const room = Math.max(1, left - 4)
      put(grid, 1 + (h >>> 3) % room, r, '♣', pal.tree, pal.grass)
    }
    if ((h >>> 5) % 3 === 0) {
      const rightRoom = Math.max(1, grid.w - (left + gm.laneW * 3) - 4)
      put(grid, left + gm.laneW * 3 + 3 + ((h >>> 9) % rightRoom), r, '♣', pal.tree, pal.grass)
    }
    if ((h >>> 11) % 5 === 0) put(grid, (h >>> 13) % Math.max(1, left - 2), r, '·', pal.hudDim, pal.grass)
    // road
    for (let i = 0; i < gm.laneW * 3; i++) put(grid, left + i, r, ' ', pal.line, pal.road)
    put(grid, left - 1, r, '▌', pal.edge, pal.grass)
    put(grid, left + gm.laneW * 3, r, '▐', pal.edge, pal.grass)
    if (((world % 4) + 4) % 4 < 3) {
      put(grid, left + gm.laneW, r, '┃', pal.line, pal.road)
      put(grid, left + gm.laneW * 2, r, '┃', pal.line, pal.road)
    }
  }
  const sprite = (kind: ObjKind): { s: string; fg: number } => {
    const w = Math.min(7, gm.laneW - 2)
    switch (kind) {
      case 'barrier': return { s: '▞'.repeat(w), fg: pal.bad }
      case 'cone': return { s: '/▲\\', fg: pal.task }
      case 'pothole': return { s: '(◉◉◉)', fg: pal.hudDim }
      case 'coin': return { s: '($)', fg: pal.coin }
      case 'task': return { s: '[✓]', fg: pal.task }
      default: return { s: '', fg: pal.text }
    }
  }
  for (const o of g.objs) {
    const r = Math.round(o.y)
    if (r < 2 || r >= grid.h) continue
    const sp = sprite(o.kind)
    const len = [...sp.s].length
    const cx = laneX(g, gm, o.lane, r) + shx
    text(grid, cx - Math.floor(len / 2), r, sp.s, sp.fg, pal.road)
  }
  // quiz gate
  if (g.quiz.phase === 'gate') {
    const gy = Math.round(g.quiz.gateY)
    for (let k = 0; k < 3; k++) {
      const r = gy + k
      if (r < 2 || r >= grid.h) continue
      const left = roadLeft(g, gm, r) + shx
      for (let l = 0; l < 3; l++) {
        const color = pal.gate[l]
        for (let i = 0; i < gm.laneW; i++) put(grid, left + l * gm.laneW + i, r, ' ', pal.box, color)
        if (k === 1) {
          const label = `${'ABC'[l]} ${g.quiz.lanes[l]}`.slice(0, gm.laneW - 1)
          text(grid, left + l * gm.laneW + Math.floor((gm.laneW - label.length) / 2), r, label, pal.box, color)
        }
      }
    }
  }
  // my car
  const car = carOf(g)
  const carRow = grid.h - 3
  const px = laneX(g, gm, 0, carRow + 1) + (laneX(g, gm, 1, carRow + 1) - laneX(g, gm, 0, carRow + 1)) * g.lane + shx
  const cxi = Math.round(px)
  const flash = g.mode === 'crash'
  car.art.forEach((line, i) => {
    text(grid, cxi - 2, carRow + i, line, flash && g.frame % 2 === 0 ? pal.bad : car.color, pal.road)
  })
  if (g.nitroMs > 0) {
    put(grid, cxi - 1, carRow + 3, '▓', pal.task, pal.road)
    put(grid, cxi + 1, carRow + 3, '▓', pal.task, pal.road)
  }
  if (car.shield && !g.shieldUsed) put(grid, cxi - 3, carRow + 1, '◖', pal.gate[1], pal.road), put(grid, cxi + 3, carRow + 1, '◗', pal.gate[1], pal.road)
}

function drawHud(grid: Grid, g: Game, pal: Palette) {
  for (let r = 0; r < 2; r++) for (let x = 0; x < grid.w; x++) put(grid, x, r, ' ', pal.hud, pal.box)
  const lv = levelOf(g)
  const filled = Math.max(0, Math.min(10, Math.floor((lv.into / lv.need) * 10)))
  text(grid, 1, 0, 'ROAD TRIP', pal.accent, pal.box)
  const right0 = `${fmt(g.dist)} m  ·  Best ${fmt(Math.max(g.p.best, g.dist))} m  ·  ◉ ${fmt(g.p.bank)}`
  text(grid, Math.max(11, grid.w - [...right0].length - 1), 0, right0, pal.hud, pal.box)
  text(grid, 1, 1, `LV ${lv.level} ${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}`, pal.hud, pal.box)
  const c = carOf(g)
  const perks: string[] = []
  if (g.nitroMs > 0) perks.push('★ NITRO')
  if (c.shield) perks.push(g.shieldUsed ? '◇ Shield' : '◆ Shield')
  if (c.magnet) perks.push('◆ Magnet')
  if (c.double) perks.push('◆ x2')
  const right1 = `${perks.join('  ')}${perks.length ? '  ' : ''}${c.name}`
  text(grid, Math.max(18, grid.w - [...right1].length - 1), 1, right1, pal.hudDim, pal.box)
}

function drawGarage(grid: Grid, g: Game, pal: Palette) {
  const c = at(CARS, g.garageIdx)
  const st = garageStatus(g)
  const mid = Math.floor(grid.w / 2)
  const top = 3
  centerText(grid, top, 'G A R A G E', pal.accent, pal.road)
  const artTop = top + 2
  c.big.forEach((line, i) => {
    if (artTop + i < grid.h - 5) centerText(grid, artTop + i, line, c.id === g.p.car ? c.color : st.canAct || g.p.owned.includes(c.id) ? c.color : pal.hudDim, pal.road)
  })
  const ay = artTop + 2
  text(grid, Math.max(2, mid - 22), ay, '◀', pal.text, pal.road)
  text(grid, Math.min(grid.w - 3, mid + 21), ay, '▶', pal.text, pal.road)
  let y = artTop + 6
  centerText(grid, y++, c.name, pal.text, pal.road)
  centerText(grid, y++, c.perk, pal.hudDim, pal.road)
  centerText(grid, y++, st.text, st.canAct ? pal.coin : pal.text, pal.road)
  centerText(grid, y++, `${g.garageIdx + 1} / ${CARS.length}   ·   Level ${levelOf(g).level}   ·   ◉ ${fmt(g.p.bank)}`, pal.hudDim, pal.road)
}

export function drawGame(g: Game, pal: Palette, cols = g.cols, rows = g.rows): Grid {
  const grid = makeGrid(cols, rows, pal.road)
  if (g.mode === 'garage') {
    for (let r = 2; r < rows; r++) for (let x = 0; x < cols; x++) put(grid, x, r, ' ', pal.text, pal.road)
    drawHud(grid, g, pal)
    drawGarage(grid, g, pal)
    return grid
  }
  drawScene(grid, g, pal)
  drawHud(grid, g, pal)
  if (g.quiz.phase !== 'idle' && g.quiz.quiz && g.mode !== 'arrived') {
    const q = g.quiz
    const lines =
      q.phase === 'ask'
        ? [
            { s: `QUIZ  ${q.quiz!.q}`, fg: pal.coin },
            { s: `A ${q.lanes[0]}    B ${q.lanes[1]}    C ${q.lanes[2]}` },
            { s: `Gate in ${Math.max(1, Math.ceil(q.ms / 1000))}...`, fg: pal.hudDim },
          ]
        : [{ s: `QUIZ  ${q.quiz!.q}`, fg: pal.coin }]
    overlay(grid, pal, lines, 2)
  }
  if (g.mode === 'countdown') {
    const n = Math.max(1, Math.ceil(g.modeMs / 1000))
    overlay(grid, pal, [{ s: `Get ready...  ${n}`, fg: pal.coin }])
  } else if (g.mode === 'crash') {
    overlay(grid, pal, [{ s: 'Flat tire!', fg: pal.bad }, { s: 'New run starting...', fg: pal.hudDim }])
  } else if (g.mode === 'pause') {
    overlay(grid, pal, [{ s: 'PAUSED', fg: pal.coin }, { s: 'Press P to keep driving', fg: pal.hudDim }])
  } else if (g.mode === 'arrived') {
    const a = g.arrived
    overlay(grid, pal, [
      { s: 'Arrived!', fg: pal.coin },
      { s: 'Your AI employee finished the job', fg: pal.text },
      { s: '' },
      { s: `Distance ${fmt(a.dist)} m   ·   Coins this run ${fmt(a.runCoins)}` },
      { s: `High score ${fmt(a.best)} m   ·   Quiz answers right ${fmt(a.right)}` },
      { s: `Level ${a.level}   ·   Bank ◉ ${fmt(a.bank)}`, fg: pal.hudDim },
    ])
  } else if (g.msgMs > 0 && g.msg && g.mode === 'drive') {
    overlay(grid, pal, [{ s: g.msg, fg: g.msgBad ? pal.bad : pal.coin }], Math.floor(rows / 2) - 1)
  }
  return grid
}

// ---------------------------------------------------------------- pack

const B64S = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const b64 = (i: number): string => B64S.charAt(i)

export function packCells(grid: Grid): string {
  const n = grid.w * grid.h
  const words = new Uint32Array(n * 3)
  for (let i = 0; i < n; i++) {
    words[i * 3] = at(grid.cp, i)
    words[i * 3 + 1] = at(grid.fg, i)
    words[i * 3 + 2] = at(grid.bg, i)
  }
  const bytes = new Uint8Array(words.buffer)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = at(bytes, i)
    const b = i + 1 < bytes.length ? at(bytes, i + 1) : 0
    const c = i + 2 < bytes.length ? at(bytes, i + 2) : 0
    out += b64(a >> 2) + b64(((a & 3) << 4) | (b >> 4))
    out += i + 1 < bytes.length ? b64(((b & 15) << 2) | (c >> 6)) : '='
    out += i + 2 < bytes.length ? b64(c & 63) : '='
  }
  return out
}

export const frameCells = (g: Game, pal: Palette): string => packCells(drawGame(g, pal))

export function buttonsFor(g: Game): { label: string; hotkey: string; action: string }[] {
  switch (g.mode) {
    case 'pause':
      return [
        { label: '▶ P resume', hotkey: 'p', action: 'pause' },
        { label: 'G garage', hotkey: 'g', action: 'garage' },
      ]
    case 'arrived':
      return [
        { label: 'K Keep Driving', hotkey: 'k', action: 'keep' },
        { label: 'G Garage', hotkey: 'g', action: 'garage' },
        { label: 'X Close', hotkey: 'x', action: 'close' },
      ]
    case 'garage': {
      const st = garageStatus(g)
      return [
        { label: '◀ A', hotkey: 'a', action: 'left' },
        { label: 'D ▶', hotkey: 'd', action: 'right' },
        { label: st.canAct ? (g.p.owned.includes(at(CARS, g.garageIdx).id) ? 'B drive it' : 'B buy') : 'B (not yet)', hotkey: 'b', action: 'buy' },
        { label: 'G back to road', hotkey: 'g', action: 'garage' },
      ]
    }
    default:
      return [
        { label: '◀ A', hotkey: 'a', action: 'left' },
        { label: 'D ▶', hotkey: 'd', action: 'right' },
        { label: 'P pause', hotkey: 'p', action: 'pause' },
        { label: 'G garage', hotkey: 'g', action: 'garage' },
      ]
  }
}

export const tooSmall = (cols: number, rows: number) => cols < MIN_COLS || rows < MIN_ROWS
