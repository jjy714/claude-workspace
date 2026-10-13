// Agent Dock: every piece of logic that needs no `$`, so tests can call it.

import type { CardStatus, DockCard, DockCounts, DockPhase } from '../types'

export type { CardStatus, DockCard, DockCounts, DockPhase } from '../types'

export const SIZES = [1, 3, 5, 10, 20, 50, 100] as const
export const MIN_SIZE = 1
export const MAX_SIZE = 100
export const BIG_TEAM = 20
export const DEFAULT_ENGINE_LIMIT = 20
export const DEFAULT_TOOL_LIMIT = 10
export const BAD_SIZE_TOAST = 'Type a whole number from 1 to 100'
export const SLASH_BAD_SIZE = 'Team Size is a whole number from 1 to 100, e.g. /dock 10.'
export const STOPPED_MESSAGE = 'Stopped before this helper started.'
export const PLAN_REFUSAL = 'Helpers skip the plan. Just call report_progress as you work.'
export const TOO_NARROW = 'The window is too narrow to show the Agent Dock. Widen it or watch the status bar.'

const MAX_JOB = 40

/** "10" -> 10, " 25 " -> 25; anything that is not a whole number from 1 to 100 -> null. */
export function parseSize(raw: unknown): number | null {
  const s = String(raw ?? '').trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return n >= MIN_SIZE && n <= MAX_SIZE ? n : null
}

/** A saved size comes back in a new session; a big team never carries over. */
export function restoreSize(saved: unknown): number {
  const n = typeof saved === 'number' && Number.isInteger(saved) ? saved : null
  if (n === null || n < MIN_SIZE || n > BIG_TEAM) return 1
  return n
}

export const needsConfirm = (size: number) => size > BIG_TEAM

export function restoreHelperModel(saved: unknown): 'fast' | 'same' {
  return saved === 'same' ? 'same' : 'fast'
}

/** How many helpers run at once: the lower of the two engine limits. */
export function atATime(maxSubagents: unknown, maxToolUse: unknown): number {
  return Math.max(1, Math.min(engineLimit(maxSubagents), toolLimit(maxToolUse)))
}

export function engineLimit(raw: unknown): number {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_ENGINE_LIMIT
}

export function toolLimit(raw: unknown): number {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_TOOL_LIMIT
}

/** First clause of the request, about 40 characters. */
export function jobName(request: string): string {
  let s = String(request ?? '')
    .replace(/`[^`]*`/g, ' ')
    .split(/[,.;:!?\n]| - | and then /i)[0]!
  s = s.replace(/\s+/g, ' ').trim()
  if (s === '') return 'Your request'
  s = s.charAt(0).toUpperCase() + s.slice(1)
  if (s.length > MAX_JOB) {
    let cut = s.slice(0, MAX_JOB - 1)
    const space = cut.lastIndexOf(' ')
    if (space > 0) cut = cut.slice(0, space)
    s = cut.replace(/[\s,.;:-]+$/, '') + '…'
  }
  return s
}

/** A helper's task name: 3 to 5 words. */
export function taskName(description: unknown): string {
  const words = String(description ?? '')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  if (words.length === 0) return 'Helper task'
  const name = words.slice(0, 5).join(' ').replace(/[\s,.;]+$/, '')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** Two letters for a face badge: "Price check: Panera" -> "PP". */
export function initials(name: string): string {
  const words = String(name ?? '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '??'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  const first = words[0]!.charAt(0)
  const last = words[words.length - 1]!.charAt(0)
  return (first + last).toUpperCase()
}

/** A stable small number for a string (picks a badge color or a headshot). */
export function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function instructionText(n: number): string {
  return `# Agent Dock: Team Size is ${n}

Split this request into exactly ${n} independent pieces and launch one helper (the Agent tool) per piece, all in one message so they run in parallel.

- Find a real split, one helper per item (per store, per task, per file, per section). Never argue that it can't be split and never pad with useless work.
- Give each helper a short plain-English description of 3 to 5 words, for example "Price check: Panera".
- In each helper's prompt add: "As you work, call report_progress with your task name and a percent at about 25, 50, 75 and 100. Do not call plan_steps."
- When they finish, combine their results into one answer.`
}

export function capMessage(n: number): string {
  return `Team Size is ${n}: this request already has ${n} helpers. Finish with the helpers you have.`
}

export function nudgeText(used: number, n: number): string {
  return `You used ${used} of ${n} helpers. Split the remaining work across the other ${n - used}, one helper per piece, all in parallel.`
}

export function shouldNudge(size: number, used: number, hasNudged: boolean): boolean {
  return size > 1 && used < size && !hasNudged
}

export function infoLine(size: number, perWave: number, model: 'fast' | 'same'): string {
  const head = size === 1 ? 'Claude decides how many helpers' : `Splits each request across ${size} helpers`
  const wave = size === 1 ? '' : `  ·  ${Math.min(size, perWave)} at a time`
  const who = model === 'fast' ? 'Fast & Cheap' : 'Same model as you'
  return `${head}${wave}  ·  ${who}`
}

export function counts(cards: readonly DockCard[]): DockCounts {
  const c: DockCounts = { working: 0, queued: 0, done: 0, stuck: 0, total: cards.length }
  for (const k of cards) c[k.status] += 1
  return c
}

export function badge(c: DockCounts): string {
  const parts = [`${c.working} working`, `${c.queued} queued`, `${c.done} done`]
  if (c.stuck > 0) parts.push(`${c.stuck} stuck`)
  return parts.join(' · ')
}

/** 1:12 style clock for cards and the mission bar. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** 2m 14s style duration for the summary. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export function summary(c: DockCounts, job: string, ms: number): string {
  const noun = c.total === 1 ? 'agent' : 'agents'
  const stuck = c.stuck > 0 ? ` (${c.stuck} got stuck)` : ''
  return `${c.total} ${noun} finished ${job} in ${duration(ms)}${stuck}`
}

export const clampPercent = (n: number) =>
  Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)))

/** A card's own meter: done = full, working = what it reported, queued = empty. */
export function cardPercent(k: DockCard): number {
  if (k.status === 'done') return 100
  if (k.status === 'queued') return 0
  return k.percent
}

/** The mission's overall percent: the mean of every card's meter. */
export function overallPercent(cards: readonly DockCard[]): number {
  if (cards.length === 0) return 0
  const sum = cards.reduce((a, k) => a + (k.status === 'stuck' ? 100 : cardPercent(k)), 0)
  return Math.round(sum / cards.length)
}

export function isFinished(cards: readonly DockCard[]): boolean {
  return cards.length > 0 && cards.every(k => k.status === 'done' || k.status === 'stuck')
}

export function newCard(id: string, name: string): DockCard {
  return {
    id,
    name,
    status: 'queued',
    percent: 0,
    hasReported: false,
    agentId: null,
    startedAt: null,
    endedAt: null,
  }
}

/** Add queued cards for Agent calls not yet seen; existing ones are kept. */
export function addQueued(
  cards: readonly DockCard[],
  found: ReadonlyArray<{ id: string; description: unknown }>,
): DockCard[] {
  const have = new Set(cards.map(k => k.id))
  const next = [...cards]
  for (const f of found) {
    if (have.has(f.id)) continue
    have.add(f.id)
    next.push(newCard(f.id, taskName(f.description)))
  }
  return next
}

export function setStatus(
  cards: readonly DockCard[],
  id: string,
  status: CardStatus,
  now: number,
  fallbackName?: string,
): DockCard[] {
  let seen = false
  const next = cards.map(k => {
    if (k.id !== id) return k
    seen = true
    return {
      ...k,
      status,
      percent: status === 'done' ? 100 : k.percent,
      startedAt: k.startedAt ?? now,
      endedAt: status === 'done' || status === 'stuck' ? now : null,
    }
  })
  if (seen || fallbackName === undefined) return next
  // an Agent call whose row was never seen (so no queued card yet)
  return [
    ...next,
    {
      ...newCard(id, taskName(fallbackName)),
      status,
      percent: status === 'done' ? 100 : 0,
      startedAt: now,
      endedAt: status === 'done' || status === 'stuck' ? now : null,
    },
  ]
}

/**
 * A helper's report_progress call: find its card (by the agent id it was
 * matched to, else by task name, else the first working card nobody owns)
 * and move its meter.
 */
export function applyProgress(
  cards: readonly DockCard[],
  agentId: string,
  task: string,
  rawPercent: number,
): DockCard[] {
  const percent = clampPercent(rawPercent)
  let i = cards.findIndex(k => k.agentId === agentId)
  if (i === -1) {
    const want = taskName(task).toLowerCase()
    i = cards.findIndex(k => k.agentId === null && k.status === 'working' && k.name.toLowerCase() === want)
  }
  if (i === -1) i = cards.findIndex(k => k.agentId === null && k.status === 'working')
  if (i === -1) return cards.slice()
  return cards.map((k, at) =>
    at === i
      ? { ...k, agentId, hasReported: true, percent: Math.max(k.hasReported ? k.percent : 0, percent) }
      : k,
  )
}

/** Cards per row for the full cards (two or three), from the pane width. */
export function perRow(columns: number): number {
  if (columns >= 96) return 3
  if (columns >= 56) return 2
  return 1
}

export const TILE_THRESHOLD = 12

/** Colors: blend two #rrggbb colors. */
export function blend(a: string, b: string, t: number): string {
  const p = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)
  const mix = (at: number) => Math.round(p(a, at) + (p(b, at) - p(a, at)) * Math.max(0, Math.min(1, t)))
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(mix(1))}${h(mix(3))}${h(mix(5))}`
}

export const CORAL = '#ff7a59'
export const GOLD = '#f2c14e'
export const GREEN = '#3fb27f'
export const GREEN_HI = '#7fe0b0'
export const RED = '#e5484d'
export const HAIR = '#4a4a52'
export const BADGES = ['#8a6fdf', '#3e9bd1', '#d1823e', '#4fb286', '#c2569b', '#6e8f3a', '#cf6a5e', '#5b7bd6']

export const badgeColor = (id: string) => BADGES[hash(id) % BADGES.length]!

/**
 * The mission bar as segments: done sweeps coral to gold, working shimmers
 * green, the rest is a hairline. `phase` moves the shimmer.
 */
export function missionBar(
  c: DockCounts,
  width: number,
  phase: number,
): Array<{ text: string; color: string; dim?: boolean }> {
  if (width <= 0) return []
  const total = Math.max(1, c.total)
  const doneW = Math.round((c.done / total) * width)
  const workW = Math.min(width - doneW, Math.max(c.working > 0 ? 1 : 0, Math.round((c.working / total) * width)))
  const out: Array<{ text: string; color: string; dim?: boolean }> = []
  for (let i = 0; i < doneW; i++) {
    out.push({ text: '━', color: blend(CORAL, GOLD, doneW <= 1 ? 1 : i / (doneW - 1)) })
  }
  for (let i = 0; i < workW; i++) {
    const wave = (Math.sin((i - phase) / 2.2) + 1) / 2
    out.push({ text: '━', color: blend(GREEN, GREEN_HI, wave) })
  }
  for (let i = doneW + workW; i < width; i++) out.push({ text: '─', color: HAIR, dim: true })
  return out
}

/** A text meter for a card or tile. */
export function meter(percent: number, width: number): { full: string; empty: string } {
  const filled = Math.round((clampPercent(percent) / 100) * width)
  return { full: '━'.repeat(filled), empty: '─'.repeat(Math.max(0, width - filled)) }
}

/** The wordmark with letters spaced, as the masthead draws it. */
export const WORDMARK = 'A G E N T   D O C K'

/** How many seats the idle row shows: one per team member, up to 25. */
export const seatCount = (size: number) => Math.min(25, Math.max(1, size))

export function sizeChipLabel(size: number): string {
  return String(size)
}

export function liveLabel(phase: DockPhase): 'LIVE' | 'COMPLETE' | 'STANDING BY' {
  return phase === 'live' ? 'LIVE' : phase === 'done' ? 'COMPLETE' : 'STANDING BY'
}

export function agentsNowJson(working: number, queued: number, now: number): string {
  return JSON.stringify({ count: working, queued, updatedAt: now })
}
