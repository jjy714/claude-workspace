import { describe, expect, test } from 'claude-code/testing'

import { CHALLENGES, THEMES, TOTAL } from '../hooks/challenges'

const words = (text: string) => text.trim().split(/\s+/).length
const sentences = (text: string) => (text.match(/[.!?](\s|$)/g) ?? []).length

describe('the 365 challenges', () => {
  test('there are exactly 365 and none repeat', async () => {
    expect(TOTAL).toBe(365)
    expect(CHALLENGES.length).toBe(365)
    expect(new Set(CHALLENGES.map(one => one.title.toLowerCase())).size).toBe(365)
    expect(new Set(CHALLENGES.map(one => one.task.toLowerCase())).size).toBe(365)
    CHALLENGES.forEach((one, index) => expect(one.id).toBe(index))
  })

  test('titles are two to five words and tasks are one or two sentences', async () => {
    for (const one of CHALLENGES) {
      expect(words(one.title) >= 2 && words(one.title) <= 5).toBe(true)
      expect(sentences(one.task) >= 1 && sentences(one.task) <= 2).toBe(true)
    }
  })

  test('every seven days in a row touch all seven themes', async () => {
    for (let start = 0; start + 7 <= CHALLENGES.length; start += 1) {
      const seen = new Set(CHALLENGES.slice(start, start + 7).map(one => one.theme))
      expect(seen.size).toBe(7)
    }
  })

  test('each theme has 52, plus the closer on the last day', async () => {
    for (const theme of THEMES) {
      const count = CHALLENGES.filter(one => one.theme === theme).length
      expect(count).toBe(theme === 'Prompting' ? 53 : 52)
    }
    expect(CHALLENGES[364].title).toBe('Write your own guide')
  })

  test('no emoji and no talking down', async () => {
    const text = CHALLENGES.map(one => `${one.title} ${one.task}`).join(' ')
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false)
    expect(/\b(lazy|dumb|stupid|silly mistake)/i.test(text)).toBe(false)
  })
})
