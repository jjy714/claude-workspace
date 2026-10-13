import { describe, expect, test } from 'claude-code/testing'

import { buildRows, numeral, rowWidth, FOOTER } from '../hooks/layout'
import { addDays, completeToday, emptyProgress, modelOf, normalize } from '../hooks/logic'
import { TOTAL } from '../hooks/challenges'

const NOON = new Date(2026, 9, 13, 12, 0, 0).getTime()
const TODAY = '2026-10-13'
const textOf = (rows: ReturnType<typeof buildRows>) =>
  rows.map(row => row.map(item => ('button' in item ? item.runs.map(r => r.text).join('') : item.text)).join('')).join('\n')

describe('the pane layout', () => {
  test('no row is wider than the pane, narrow or wide', async () => {
    const done = completeToday(emptyProgress(), TODAY)
    const many = normalize({
      log: Array.from({ length: 365 - 1 }, (_, id) => ({ date: addDays('2025-01-01', id), id })),
    })
    for (const progress of [emptyProgress(), done, many]) {
      for (const columns of [24, 32, 40, 52, 64, 80, 100, 140]) {
        const width = Math.max(20, Math.min(columns, 120))
        for (const row of buildRows(modelOf(progress, NOON), columns)) {
          expect(`${columns}:${rowWidth(row) <= width}`).toBe(`${columns}:true`)
        }
      }
    }
  })

  test('big numbers are three rows tall', async () => {
    expect(numeral(365, 1).length).toBe(3)
    expect(numeral(7, 0)[0]).toBe('╺━┓')
  })

  test('shows the three tiles, the headings and the footer line', async () => {
    const text = textOf(buildRows(modelOf(emptyProgress(), NOON), 80))
    for (const word of ['DAY STREAK', 'COMPLETED', 'BEST STREAK', "TODAY'S CHALLENGE", 'LAST 14 DAYS', 'YOUR YEAR', 'Tue 13 Oct 2026', 'of 365', '0 done', '365 to go']) {
      expect(text.includes(word)).toBe(true)
    }
    expect(text.includes(FOOTER)).toBe(true)
  })

  test('shows the right buttons before and after completing', async () => {
    const before = textOf(buildRows(modelOf(emptyProgress(), NOON), 100))
    expect(before.includes('Mark complete')).toBe(true)
    expect(before.includes('Coach me through it')).toBe(true)
    expect(before.includes('Give me another')).toBe(true)
    const after = textOf(buildRows(modelOf(completeToday(emptyProgress(), TODAY), NOON), 100))
    expect(after.includes('Completed today')).toBe(true)
    expect(after.includes('waiting tomorrow')).toBe(true)
    expect(after.includes('Undo')).toBe(true)
    expect(after.includes('Mark complete')).toBe(false)
  })

  test('hides Give me another when nothing else is left', async () => {
    const log = Array.from({ length: TOTAL - 1 }, (_, id) => ({ date: addDays('2024-01-01', id), id }))
    const text = textOf(buildRows(modelOf(normalize({ log }), NOON), 100))
    expect(text.includes('Mark complete')).toBe(true)
    expect(text.includes('Give me another')).toBe(false)
  })

  test('shows a finished screen when all 365 are done', async () => {
    const log = Array.from({ length: TOTAL }, (_, id) => ({ date: addDays('2024-01-01', id), id }))
    const text = textOf(buildRows(modelOf(normalize({ log }), NOON), 100))
    expect(text.includes('ALL 365 COMPLETE')).toBe(true)
    expect(text.includes('Mark complete')).toBe(false)
  })
})
