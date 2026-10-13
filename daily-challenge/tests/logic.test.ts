import { describe, expect, test } from 'claude-code/testing'

import { TOTAL } from '../hooks/challenges'
import {
  addDays,
  bestStreak,
  canSwap,
  completeToday,
  dayKey,
  doneIds,
  emptyProgress,
  isFinished,
  normalize,
  pickToday,
  streakOf,
  swapToday,
  undoToday,
} from '../hooks/logic'
import type { Progress } from '../types'

const D1 = '2026-03-01'
const day = (offset: number) => addDays(D1, offset)

// Completes whatever the pick is on each given day, in order.
function play(days: string[]): Progress {
  return days.reduce((progress, date) => completeToday(progress, date), emptyProgress())
}

describe('the next pick', () => {
  test('starts at the first challenge and moves on in order', async () => {
    expect(pickToday(emptyProgress(), D1)?.id).toBe(0)
    const two = play([day(0), day(1)])
    expect(pickToday(two, day(2))?.id).toBe(2)
  })

  test('is always one that was never completed', async () => {
    let progress = emptyProgress()
    for (let i = 0; i < 40; i += 1) {
      const date = day(i)
      const pick = pickToday(progress, date)
      expect(doneIds(progress).has(pick?.id ?? -1)).toBe(false)
      progress = completeToday(progress, date)
    }
  })

  test('a missed day leaves the same challenge waiting', async () => {
    const progress = play([day(0)])
    expect(pickToday(progress, day(1))?.id).toBe(1)
    expect(pickToday(progress, day(5))?.id).toBe(1)
  })

  test('today stays the finished challenge after completing', async () => {
    const progress = play([day(0)])
    expect(pickToday(progress, day(0))?.id).toBe(0)
  })
})

describe('give me another', () => {
  test('swaps to a never-completed challenge and keeps it all day', async () => {
    const progress = play([day(0), day(1)])
    const swapped = swapToday(progress, day(2), () => 0.5)
    expect(swapped).not.toBeNull()
    const id = pickToday(swapped as Progress, day(2))?.id ?? -1
    expect(id).not.toBe(2)
    expect(doneIds(progress).has(id)).toBe(false)
    expect(pickToday(swapped as Progress, day(2))?.id).toBe(id)
  })

  test('never offers a completed one, whatever the dice say', async () => {
    let progress = play(Array.from({ length: 30 }, (_, i) => day(i)))
    const done = doneIds(progress)
    for (let roll = 0; roll <= 1; roll += 0.05) {
      const swapped = swapToday(progress, day(31), () => Math.min(roll, 0.999999))
      const id = pickToday(swapped as Progress, day(31))?.id ?? -1
      expect(done.has(id)).toBe(false)
    }
    progress = swapToday(progress, day(31), () => 0) as Progress
    expect(pickToday(progress, day(31))).not.toBeNull()
  })

  test('the swap is forgotten the next day', async () => {
    const swapped = swapToday(emptyProgress(), D1, () => 0.9) as Progress
    expect(pickToday(swapped, day(1))?.id).toBe(0)
  })

  test('completing a swapped challenge records that one', async () => {
    const swapped = swapToday(emptyProgress(), D1, () => 0.9) as Progress
    const id = pickToday(swapped, D1)?.id ?? -1
    const done = completeToday(swapped, D1)
    expect(doneIds(done).has(id)).toBe(true)
    expect(canSwap(done, D1)).toBe(false)
  })

  test('is not offered once nothing else is left', async () => {
    const log = Array.from({ length: TOTAL - 1 }, (_, id) => ({ date: addDays(D1, id - 400), id }))
    const almost = normalize({ log, swap: null })
    expect(canSwap(almost, D1)).toBe(false)
    expect(swapToday(almost, D1, () => 0)).toBeNull()
  })
})

describe('the finished state', () => {
  test('all 365 done means finished and no challenge', async () => {
    const log = Array.from({ length: TOTAL }, (_, id) => ({ date: addDays(D1, id - 500), id }))
    const all = normalize({ log, swap: null })
    expect(isFinished(all)).toBe(true)
    expect(pickToday(all, D1)).toBeNull()
    expect(completeToday(all, D1)).toBe(all)
  })
})

describe('streaks', () => {
  test('count days in a row ending today', async () => {
    expect(streakOf(play([day(0), day(1), day(2)]), day(2))).toBe(3)
  })

  test('still count through yesterday before today is done', async () => {
    expect(streakOf(play([day(0), day(1), day(2)]), day(3))).toBe(3)
  })

  test('reset after a missed day, while best is kept', async () => {
    const progress = play([day(0), day(1), day(2), day(4)])
    expect(streakOf(progress, day(4))).toBe(1)
    expect(streakOf(progress, day(6))).toBe(0)
    expect(bestStreak(progress)).toBe(3)
  })

  test('best is the longest run ever', async () => {
    const progress = play([day(0), day(2), day(3), day(4), day(5), day(7), day(8)])
    expect(bestStreak(progress)).toBe(4)
    expect(bestStreak(emptyProgress())).toBe(0)
  })

  test('undo takes today back out', async () => {
    const done = play([day(0), day(1)])
    const undone = undoToday(done, day(1))
    expect(streakOf(undone, day(1))).toBe(1)
    expect(pickToday(undone, day(1))?.id).toBe(1)
  })

  test('use the local calendar day', async () => {
    const noon = new Date(2026, 5, 15, 12, 0, 0).getTime()
    const late = new Date(2026, 5, 15, 23, 59, 0).getTime()
    const early = new Date(2026, 5, 16, 0, 1, 0).getTime()
    expect(dayKey(noon)).toBe('2026-06-15')
    expect(dayKey(late)).toBe('2026-06-15')
    expect(dayKey(early)).toBe('2026-06-16')
  })
})

describe('saved data', () => {
  test('junk in the store becomes an empty record', async () => {
    expect(normalize('nope')).toEqual(emptyProgress())
    expect(normalize({ log: [{ date: 'x', id: 4 }, { date: D1, id: 9999 }] }).log).toEqual([])
  })
})
