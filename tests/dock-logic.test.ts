import { describe, expect, test } from 'claude-code/testing'

import {
  applyProgress,
  atATime,
  badge,
  capMessage,
  clock,
  counts,
  initials,
  instructionText,
  jobName,
  newCard,
  nudgeText,
  parseSize,
  restoreSize,
  setStatus,
  shouldNudge,
  summary,
  taskName,
} from '../hooks/dock-logic'

describe('parseSize', () => {
  test('accepts whole numbers from 1 to 100 and nothing else', async () => {
    expect(parseSize('10')).toBe(10)
    expect(parseSize(' 25 ')).toBe(25)
    expect(parseSize('1')).toBe(1)
    expect(parseSize('100')).toBe(100)
    for (const bad of ['0', '101', 'abc', '2.5', '', '-3', '1e2', '5x']) {
      expect(parseSize(bad)).toBeNull()
    }
  })

  test('a big team never carries over to the next session', async () => {
    expect(restoreSize(50)).toBe(1)
    expect(restoreSize(21)).toBe(1)
    expect(restoreSize(10)).toBe(10)
    expect(restoreSize(20)).toBe(20)
    expect(restoreSize(undefined)).toBe(1)
    expect(restoreSize('7')).toBe(1)
  })
})

describe('text', () => {
  test('instruction and nudge wording', async () => {
    expect(instructionText(5)).toContain('exactly 5 independent pieces')
    expect(instructionText(5)).toContain('call report_progress')
    expect(instructionText(5)).toContain('Do not call plan_steps')
    expect(capMessage(5)).toBe(
      'Team Size is 5: this request already has 5 helpers. Finish with the helpers you have.',
    )
    expect(nudgeText(3, 10)).toBe(
      'You used 3 of 10 helpers. Split the remaining work across the other 7, one helper per piece, all in parallel.',
    )
    expect(shouldNudge(10, 3, false)).toBe(true)
    expect(shouldNudge(10, 3, true)).toBe(false)
    expect(shouldNudge(10, 10, false)).toBe(false)
    expect(shouldNudge(1, 0, false)).toBe(false)
  })

  test('job, task, initials, clock', async () => {
    expect(jobName('Research bakery pricing, then write a summary')).toBe('Research bakery pricing')
    expect(jobName('x '.repeat(40)).length).toBeLessThanOrEqual(40)
    expect(taskName('Price check: Panera bread and more')).toBe('Price check: Panera bread and')
    expect(initials('Price check: Panera')).toBe('PP')
    expect(initials('Crumbl')).toBe('CR')
    expect(clock(72_000)).toBe('1:12')
    expect(atATime(undefined, undefined)).toBe(10)
    expect(atATime('20', '20')).toBe(20)
  })
})

describe('cards', () => {
  test('progress finds the card by agent, then by name, then by first free', async () => {
    let cards = [newCard('a', 'Price check: Panera'), newCard('b', 'Price check: Crumbl')]
    cards = setStatus(cards, 'a', 'working', 0)
    cards = setStatus(cards, 'b', 'working', 0)
    cards = applyProgress(cards, 'ag-2', 'Price check: Crumbl', 60)
    expect(cards[1]!.percent).toBe(60)
    expect(cards[1]!.agentId).toBe('ag-2')
    cards = applyProgress(cards, 'ag-1', 'whatever', 25)
    expect(cards[0]!.percent).toBe(25)
    cards = applyProgress(cards, 'ag-2', 'Price check: Crumbl', 40)
    expect(cards[1]!.percent).toBe(60)
    const c = counts(cards)
    expect(badge(c)).toBe('2 working · 0 queued · 0 done')
    expect(summary({ working: 0, queued: 0, done: 3, stuck: 0, total: 3 }, 'Job', 134_000)).toBe(
      '3 agents finished Job in 2m 14s',
    )
    expect(summary({ working: 0, queued: 0, done: 2, stuck: 1, total: 3 }, 'Job', 5_000)).toBe(
      '3 agents finished Job in 5s (1 got stuck)',
    )
  })
})
