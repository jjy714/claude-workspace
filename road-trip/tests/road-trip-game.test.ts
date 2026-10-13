import { expect, test } from 'claude-code/testing'

import { CARS } from '../hooks/road-trip-art'
import {
  garageAct,
  garageMove,
  newGame,
  openGarage,
  sanitizeProfile,
  setSize,
  taskDone,
  tick,
  type Game,
  type Profile,
} from '../hooks/road-trip-game'

const make = (patch: Partial<Profile> = {}): Game => {
  const g = newGame(sanitizeProfile({ ...patch }), 1234)
  setSize(g, 80, 24)
  g.spawnCd = 1e9
  g.nextQuizMs = 1e9
  return g
}

const run = (g: Game, ms: number) => {
  for (let t = 0; t < ms; t += 70) {
    g.spawnCd = Math.max(g.spawnCd, 1e9)
    tick(g, 70)
  }
}

const drive = (g: Game) => {
  run(g, 3200)
  expect(g.mode).toBe('drive')
}

const put = (g: Game, kind: 'barrier' | 'coin' | 'task', lane = Math.round(g.lane)) => {
  g.objs.push({ kind, lane, y: g.rows - 3 })
}

test('1. a new game counts down, then drives and distance goes up', async () => {
  const g = make()
  expect(g.mode).toBe('countdown')
  expect(g.dist).toBe(0)
  drive(g)
  const before = g.dist
  tick(g, 70)
  expect(g.dist).toBeGreaterThan(before)
  const again = g.dist
  tick(g, 70)
  expect(g.dist).toBeGreaterThan(again)
})

test('2. an obstacle is a flat tire and a new run; the Agency Wagon ignores the first hit', async () => {
  const g = make()
  drive(g)
  run(g, 700)
  const far = g.dist
  expect(far).toBeGreaterThan(0)
  put(g, 'barrier')
  tick(g, 70)
  expect(g.mode).toBe('crash')
  expect(g.msg).toBe('Flat tire!')
  run(g, 2100)
  expect(g.mode).toBe('countdown')
  expect(g.dist).toBe(0)

  const w = make({ owned: ['hatch', 'wagon'], car: 'wagon' })
  drive(w)
  put(w, 'barrier')
  tick(w, 70)
  expect(w.mode).toBe('drive')
  expect(w.shieldUsed).toBe(true)
  put(w, 'barrier')
  tick(w, 70)
  expect(w.mode).toBe('crash')
})

test('3. a coin is worth 1, or 2 in the Founder GT', async () => {
  const g = make({ bank: 10 })
  drive(g)
  put(g, 'coin')
  tick(g, 70)
  expect(g.p.bank).toBe(11)

  const gt = make({ bank: 10, owned: ['hatch', 'gt'], car: 'gt' })
  drive(gt)
  put(gt, 'coin')
  tick(gt, 70)
  expect(gt.p.bank).toBe(12)
})

test('4. a finished Claude step drops a task coin worth 10', async () => {
  const g = make({ bank: 5 })
  drive(g)
  taskDone(g)
  expect(g.taskQueue).toBe(1)
  g.spawnCd = 0
  tick(g, 70)
  const coin = g.objs.find(o => o.kind === 'task')
  expect(coin).toBeDefined()
  expect(g.taskQueue).toBe(0)
  g.objs = []
  put(g, 'task')
  tick(g, 70)
  expect(g.p.bank).toBe(15)
  // never more than 3 queue up
  taskDone(g, 9)
  expect(g.taskQueue).toBe(3)
})

test('5. the right quiz lane pays coins and nitro; the wrong lane pays nothing', async () => {
  for (const wrong of [false, true]) {
    const g = make({ bank: 100 })
    drive(g)
    g.nextQuizMs = 0
    tick(g, 70)
    expect(g.quiz.phase).toBe('ask')
    run(g, 3200)
    expect(g.quiz.phase).toBe('gate')
    const lane = wrong ? (g.quiz.right + 1) % 3 : g.quiz.right
    g.lane = lane
    g.target = lane
    const right = g.quiz.right
    const answer = g.quiz.lanes[right]
    for (let i = 0; i < 200 && g.quiz.phase === 'gate'; i++) {
      g.objs = []
      tick(g, 70)
    }
    expect(g.quiz.phase).toBe('idle')
    if (wrong) {
      expect(g.p.bank).toBe(100)
      expect(g.nitroMs).toBe(0)
      expect(g.msg).toContain('Right answer')
      expect(g.msg).toContain(answer)
    } else {
      expect(g.p.bank).toBe(115)
      expect(g.nitroMs).toBeGreaterThan(0)
    }
  }
})

test('6. buying a car takes the coins and drives it; locked or poor cars cannot be bought', async () => {
  const g = make({ bank: 500, xp: 600 })
  drive(g)
  openGarage(g)
  expect(g.mode).toBe('garage')
  garageMove(g, 1)
  expect(CARS[g.garageIdx]?.id).toBe('coupe')
  expect(garageAct(g)).toBe(true)
  expect(g.p.bank).toBe(440)
  expect(g.p.owned).toContain('coupe')
  expect(g.p.car).toBe('coupe')
  expect(g.mode).toBe('countdown')

  // wagon needs level 3 and this player is level 2
  openGarage(g)
  garageMove(g, 1)
  expect(CARS[g.garageIdx]?.id).toBe('wagon')
  expect(garageAct(g)).toBe(false)
  expect(g.p.bank).toBe(440)

  const poor = make({ bank: 10, xp: 600 })
  drive(poor)
  openGarage(poor)
  garageMove(poor, 1)
  expect(garageAct(poor)).toBe(false)
  expect(poor.p.bank).toBe(10)
  expect(poor.p.owned).toEqual(['hatch'])
})

test('8. a broken saved profile loads cleanly', async () => {
  const p = sanitizeProfile({ owned: ['bogus', 'coupe', 7], car: 'zzz', bank: -5, xp: NaN, best: 'far', quizRight: Infinity })
  expect(p.owned).toEqual(['hatch', 'coupe'])
  expect(p.car).toBe('hatch')
  expect(p.bank).toBe(0)
  expect(p.xp).toBe(0)
  expect(p.best).toBe(0)
  expect(p.quizRight).toBe(0)
  expect(sanitizeProfile(null).owned).toEqual(['hatch'])
  expect(sanitizeProfile({ owned: [], car: 'gt' }).car).toBe('hatch')
})
