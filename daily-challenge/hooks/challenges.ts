import { prompting, files, commands, memory } from './themes-a'
import { agents, build, habits, closer } from './themes-b'

export const THEMES = [
  'Prompting',
  'Files',
  'Commands',
  'Memory',
  'Agents',
  'Build',
  'Habits',
] as const

export type Theme = (typeof THEMES)[number]
export type Challenge = { id: number; theme: Theme; title: string; task: string }

const byTheme = [prompting, files, commands, memory, agents, build, habits]

// Dealt out in turn: day 1 is Prompting, day 2 Files, and so on. The 365th
// is the closer, which falls on the Prompting turn.
function deal(): Challenge[] {
  const out: Challenge[] = []
  for (let i = 0; i < 364; i += 1) {
    const slot = i % 7
    const entry = byTheme[slot][Math.floor(i / 7)]
    out.push({ id: i, theme: THEMES[slot], title: entry[0], task: entry[1] })
  }
  out.push({ id: 364, theme: THEMES[0], title: closer[0], task: closer[1] })
  return out
}

export const CHALLENGES: readonly Challenge[] = deal()
export const TOTAL = CHALLENGES.length
