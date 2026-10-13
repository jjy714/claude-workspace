// Cars, levels and quiz questions. Pure data: no `$`.

export type CarId = 'hatch' | 'coupe' | 'wagon' | 'gt' | 'hyper'

export type Car = {
  id: CarId
  name: string
  price: number
  level: number
  perk: string
  magnet: boolean
  shield: boolean
  double: boolean
  nitroStart: boolean
  // 3 rows x 5 columns, drawn centered on the lane
  art: [string, string, string]
  big: [string, string, string, string, string]
  color: number
}

export const CARS: Car[] = [
  {
    id: 'hatch', name: 'Starter Hatch', price: 0, level: 1,
    perk: 'No perk. Every empire starts somewhere',
    magnet: false, shield: false, double: false, nitroStart: false,
    art: ['▗▟█▙▖', '▐█▀█▌', '▝▀ ▀▘'],
    big: ['    ▗▄▄▄▄▄▖    ', '   ▟███████▙   ', '   ▐█▀███▀█▌   ', '   ▐███████▌   ', '    ▝▀▘   ▝▀▘  '],
    color: 0x6e7cf6,
  },
  {
    id: 'coupe', name: 'Side Hustle Coupe', price: 60, level: 2,
    perk: 'Coin magnet: also grabs coins in the next lane',
    magnet: true, shield: false, double: false, nitroStart: false,
    art: ['▗▟▀▙▖', '▐█▄█▌', '▝▀ ▀▘'],
    big: ['    ▗▄▄▄▄▖     ', '   ▟▀▀▀▀▀▀▙   ', '  ◉▐██▄▄██▌◉  ', '   ▐██████▌   ', '    ▝▀▘  ▝▀▘  '],
    color: 0xff3d97,
  },
  {
    id: 'wagon', name: 'Agency Wagon', price: 180, level: 3,
    perk: 'Shield: survives one hit per run',
    magnet: false, shield: true, double: false, nitroStart: false,
    art: ['▗███▖', '▐█▀█▌', '▝▀ ▀▘'],
    big: ['   ▗▄▄▄▄▄▄▖    ', '  ▟████████▙   ', '  ▐█▀▀▀▀▀▀█▌   ', '  ▐████████▌   ', '   ▝▀▘    ▝▀▘  '],
    color: 0x35d0ba,
  },
  {
    id: 'gt', name: 'Founder GT', price: 450, level: 5,
    perk: 'Double coins on everything',
    magnet: false, shield: false, double: true, nitroStart: false,
    art: ['▗▄█▄▖', '▐█▀█▌', '▝▀▀▀▘'],
    big: ['     ▗▄▄▖      ', '   ▗▟████▙▖    ', '  ▐█▀▀██▀▀█▌   ', '  ▐████████▌   ', '   ▝▀▀▀▀▀▀▘    '],
    color: 0xffb020,
  },
  {
    id: 'hyper', name: 'Unicorn Hyper', price: 1000, level: 8,
    perk: 'Magnet + shield + double coins + nitro start',
    magnet: true, shield: true, double: true, nitroStart: true,
    art: ['▗▟▀▙▖', '▐▓█▓▌', '▝▀▀▀▘'],
    big: ['   * ▗▖ *      ', '   ▗▟▀██▀▙▖   ', '  ▐█▓▓██▓▓█▌  ', '  ▐████████▌  ', '   ▝▀▀▀▀▀▀▘   '],
    color: 0xc77dff,
  },
]

export const carById = (id: string): Car | undefined => CARS.find(c => c.id === id)

// XP needed to finish level n (1-based): 500, 1500, 3000, 5000 ...
export const xpForLevel = (n: number): number => 250 * n * (n + 1)

export function levelFor(xp: number): { level: number; into: number; need: number } {
  let level = 1
  while (level < 99 && xp >= xpForLevel(level)) level += 1
  const prev = level > 1 ? xpForLevel(level - 1) : 0
  return { level, into: xp - prev, need: xpForLevel(level) - prev }
}

export type Quiz = { q: string; a: [string, string, string]; ok: 0 | 1 | 2 }

// The first answer listed is the right one; the game shuffles lanes.
const raw: [string, string, string, string][] = [
  ['Which key stops Claude mid-task?', 'Esc', 'F5', 'Tab'],
  ['What does /clear do?', 'New context', 'Delete repo', 'Log out'],
  ['What does /compact do?', 'Shrinks context', 'Zips files', 'Quits'],
  ['CLAUDE.md is for...', 'Project notes', 'Passwords', 'Lunch menu'],
  ['Shift+Tab cycles...', 'Permission mode', 'Fonts', 'Tabs'],
  ['What is /init for?', 'Makes CLAUDE.md', 'Resets PC', 'Updates OS'],
  ['A subagent is...', 'A helper Claude', 'An intern', 'A plugin store'],
  ['Hooks run...', 'On events', 'Never', 'On Fridays'],
  ['Plan mode will...', 'Plan first', 'Delete all', 'Just vibe'],
  ['/resume does what?', 'Continues chat', 'Sends email', 'Sleeps'],
  ['Which is a Claude model?', 'Sonnet', 'Sandwich', 'Soprano'],
  ['What is MCP?', 'Tool protocol', 'A diet', 'A rap crew'],
  ['@file in a prompt...', 'Adds the file', 'Emails it', 'Deletes it'],
  ['/cost shows...', 'Token spend', 'Your salary', 'Gas prices'],
  ['A skill is...', 'Saved know-how', 'A haircut', 'A tax form'],
  ['Good prompts are...', 'Specific', 'Vague', 'In all caps'],
  ['That meeting should have been...', 'An email', 'Two more', 'A parade'],
  ['What does ROI stand for?', 'Return on invest', 'Rain on ice', 'Rows of ink'],
  ['Cash flow is...', 'Money in/out', 'A river', 'A yoga move'],
  ['An MVP is a...', 'Minimum product', 'Most Valued Pet', 'Mega Van Park'],
  ['Revenue minus costs?', 'Profit', 'Vibes', 'Synergy'],
  ['Best way to scale?', 'Delegate', 'Cry', 'More meetings'],
  ['Per my last email means...', 'Read it pls', 'Love you', 'Congrats'],
  ['An invoice is for...', 'Getting paid', 'Decoration', 'Napkins'],
  ['Deadline is Friday. Start?', 'Monday', 'Friday 5pm', 'Next year'],
  ['The 80/20 rule says...', 'Focus vital few', 'Work 80 days', 'Nap 20 hrs'],
  ['Churn means...', 'Losing clients', 'Butter time', 'Gaining fans'],
  ['What is a KPI?', 'Key metric', 'Kitchen pie', 'Kind pizza'],
  ['Automating a task saves...', 'Time', 'Nothing', 'Parking'],
  ['Who works while you sleep?', 'AI employee', 'The moon', 'Your cat'],
]

export const QUIZZES: Quiz[] = raw.map(([q, right, w1, w2]) => ({ q, a: [right, w1, w2], ok: 0 }))

export const TIPS = ['Esc stops Claude', 'Shift+Tab: modes', '/clear for a fresh start']
