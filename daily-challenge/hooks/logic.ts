import type { LogEntry, Progress } from '../types'
import { CHALLENGES, TOTAL } from './challenges'
import type { Challenge } from './challenges'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const emptyProgress = (): Progress => ({ log: [], swap: null })

const two = (n: number) => String(n).padStart(2, '0')

// The local calendar day of a moment, as YYYY-MM-DD.
export function dayKey(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

const dayNumber = (key: string): number => {
  const [year, month, day] = key.split('-').map(Number)
  return Math.round(Date.UTC(year, month - 1, day) / 86400000)
}

const keyOfNumber = (num: number): string => {
  const date = new Date(num * 86400000)
  return `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}`
}

export const addDays = (key: string, days: number): string => keyOfNumber(dayNumber(key) + days)

const isKey = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < TOTAL

// Reads whatever the store holds and returns something safe to use.
export function normalize(raw: unknown): Progress {
  if (typeof raw !== 'object' || raw === null) return emptyProgress()
  const source = raw as { log?: unknown; swap?: unknown }
  const log: LogEntry[] = []
  const dates = new Set<string>()
  const ids = new Set<number>()
  if (Array.isArray(source.log)) {
    for (const row of source.log) {
      const entry = row as { date?: unknown; id?: unknown }
      if (!isKey(entry?.date) || !isId(entry?.id)) continue
      if (dates.has(entry.date) || ids.has(entry.id)) continue
      dates.add(entry.date)
      ids.add(entry.id)
      log.push({ date: entry.date, id: entry.id })
    }
  }
  const swap = source.swap as { date?: unknown; id?: unknown } | null | undefined
  const hasSwap = swap && isKey(swap.date) && isId(swap.id) && !ids.has(swap.id)
  return { log, swap: hasSwap ? { date: swap.date as string, id: swap.id as number } : null }
}

export const doneIds = (progress: Progress): Set<number> => new Set(progress.log.map(row => row.id))

export const doneCount = (progress: Progress): number => doneIds(progress).size

export const isFinished = (progress: Progress): boolean => doneCount(progress) >= TOTAL

const completedOn = (progress: Progress, today: string): LogEntry | undefined =>
  progress.log.find(row => row.date === today)

export const isDoneToday = (progress: Progress, today: string): boolean =>
  completedOn(progress, today) !== undefined

// Today's challenge: the one finished today, else today's swap, else the next
// one in order that has never been completed. Null once all are done.
export function pickToday(progress: Progress, today: string): Challenge | null {
  const finished = completedOn(progress, today)
  if (finished) return CHALLENGES[finished.id]
  const done = doneIds(progress)
  if (progress.swap && progress.swap.date === today && !done.has(progress.swap.id)) {
    return CHALLENGES[progress.swap.id]
  }
  const next = CHALLENGES.find(one => !done.has(one.id))
  return next ?? null
}

export function completeToday(progress: Progress, today: string): Progress {
  if (isDoneToday(progress, today)) return progress
  const pick = pickToday(progress, today)
  if (!pick) return progress
  return { log: [...progress.log, { date: today, id: pick.id }], swap: null }
}

export function undoToday(progress: Progress, today: string): Progress {
  if (!isDoneToday(progress, today)) return progress
  return { log: progress.log.filter(row => row.date !== today), swap: progress.swap }
}

// A random never-completed challenge other than the current one, or null
// when nothing else is left (or today is already done).
export function swapToday(progress: Progress, today: string, rand: () => number): Progress | null {
  if (isDoneToday(progress, today)) return null
  const current = pickToday(progress, today)
  if (!current) return null
  const done = doneIds(progress)
  const options = CHALLENGES.filter(one => !done.has(one.id) && one.id !== current.id)
  if (options.length === 0) return null
  const index = Math.min(options.length - 1, Math.floor(rand() * options.length))
  return { log: progress.log, swap: { date: today, id: options[index].id } }
}

export const canSwap = (progress: Progress, today: string): boolean =>
  swapToday(progress, today, () => 0) !== null

const dateSet = (progress: Progress): Set<string> => new Set(progress.log.map(row => row.date))

// Days in a row with a completion, ending today. Before today's is done it
// still counts through yesterday.
export function streakOf(progress: Progress, today: string): number {
  const dates = dateSet(progress)
  let cursor = dates.has(today) ? today : addDays(today, -1)
  let count = 0
  while (dates.has(cursor)) {
    count += 1
    cursor = addDays(cursor, -1)
  }
  return count
}

export function bestStreak(progress: Progress): number {
  const days = [...dateSet(progress)].map(dayNumber).sort((a, b) => a - b)
  let best = 0
  let run = 0
  for (let i = 0; i < days.length; i += 1) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1
    best = Math.max(best, run)
  }
  return best
}

export type DayCell = { key: string; weekday: string; isFilled: boolean; isToday: boolean }

export function lastDays(progress: Progress, today: string, count = 14): DayCell[] {
  const dates = dateSet(progress)
  const cells: DayCell[] = []
  for (let back = count - 1; back >= 0; back -= 1) {
    const key = addDays(today, -back)
    cells.push({
      key,
      weekday: WEEKDAYS[new Date(dayNumber(key) * 86400000).getUTCDay()],
      isFilled: dates.has(key),
      isToday: back === 0,
    })
  }
  return cells
}

export function dateLabel(ms: number): string {
  const date = new Date(ms)
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

export type Model = {
  dateLabel: string
  streak: number
  best: number
  done: number
  total: number
  isFinished: boolean
  isDoneToday: boolean
  canSwap: boolean
  challenge: Challenge | null
  days: DayCell[]
}

export function modelOf(progress: Progress, ms: number): Model {
  const today = dayKey(ms)
  return {
    dateLabel: dateLabel(ms),
    streak: streakOf(progress, today),
    best: bestStreak(progress),
    done: doneCount(progress),
    total: TOTAL,
    isFinished: isFinished(progress),
    isDoneToday: isDoneToday(progress, today),
    canSwap: canSwap(progress, today),
    challenge: pickToday(progress, today),
    days: lastDays(progress, today),
  }
}

export const coachPrompt = (challenge: Challenge): string =>
  `Walk me through today's challenge one step at a time, and wait for me after each step. ` +
  `The challenge is "${challenge.title}": ${challenge.task}`
