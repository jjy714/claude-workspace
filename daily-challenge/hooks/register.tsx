import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Progress } from '../types'
import { buildRows } from './layout'
import type { Item, Row } from './layout'
import {
  coachPrompt,
  completeToday,
  dayKey,
  modelOf,
  normalize,
  pickToday,
  streakOf,
  swapToday,
  undoToday,
} from './logic'
import { TOTAL } from './challenges'

const PANE = 'daily-challenge'
const TITLE = 'Daily Challenge'
const STORE_KEY = 'progress'
const FAILED = 'Daily Challenge hit a problem and did nothing. Please try again.'

const progressAtom = atom({ plugin: 'daily-challenge', key: 'progress' } as const, null)

// Reads the saved progress and puts it where the pane draws from.
async function load($: EngineInterface): Promise<Progress> {
  const progress = normalize(await $.store.get(STORE_KEY))
  await update($, progressAtom, () => progress)
  return progress
}

async function save($: EngineInterface, progress: Progress): Promise<void> {
  await $.store.set(STORE_KEY, progress)
  await update($, progressAtom, () => progress)
}

async function todayOf($: EngineInterface): Promise<string> {
  return dayKey(await $.clock.now())
}

async function openPane($: EngineInterface): Promise<void> {
  await load($)
  await $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'challenge',
      description: 'Open your daily Claude Code challenge (also: done, another)',
    })
    try {
      await load($)
    } catch {
      // The pane loads again when it opens.
    }

    return next(e)
  })

  on('command.run', { command: 'challenge' }, async ($, e) => {
    try {
      const word = e.args.trim().toLowerCase()
      const today = await todayOf($)

      if (word === 'done') {
        const before = await load($)
        if (pickToday(before, today) === null && before.log.length >= TOTAL) {
          return { text: `You have already completed all ${TOTAL} challenges.` }
        }
        const wasDone = before.log.some(row => row.date === today)
        const after = completeToday(before, today)
        await save($, after)
        const streak = streakOf(after, today)
        const days = streak === 1 ? 'day' : 'days'
        const lead = wasDone ? "Today's challenge was already complete." : "Marked today's challenge complete."
        return {
          text: `${lead} Streak: ${streak} ${days}. Completed: ${after.log.length} of ${TOTAL}.`,
        }
      }

      if (word === 'another') {
        const before = await load($)
        const after = swapToday(before, today, Math.random)
        if (!after) {
          return { text: 'There is no other challenge to swap in right now.' }
        }
        await save($, after)
        const pick = pickToday(after, today)
        return { text: `Swapped for today: ${pick ? pick.title : 'a new challenge'}.` }
      }

      if (word !== '') {
        return { text: 'Try /challenge, /challenge done or /challenge another.' }
      }

      // Answer at once; the pane opens in the background.
      void openPane($).catch(() => {})
      return { text: 'Opening your daily challenge.' }
    } catch {
      return { text: FAILED }
    }
  }).catch(() => ({ text: FAILED }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const progress = (await read($, progressAtom)) ?? normalize(null)
    const model = modelOf(progress, await $.clock.now())
    const rows = buildRows(model, e.props.bodyColumns)

    const press = (name: string) => async () => {
      try {
        const now = await $.clock.now()
        const today = dayKey(now)
        const current = await load($)
        if (name === 'complete') {
          await save($, completeToday(current, today))
        } else if (name === 'undo') {
          await save($, undoToday(current, today))
        } else if (name === 'another') {
          const swapped = swapToday(current, today, Math.random)
          if (swapped) await save($, swapped)
        } else if (name === 'coach') {
          const pick = pickToday(current, today)
          if (pick) {
            await $.ui.close({ id: PANE })
            await $.prompt.fill({ text: coachPrompt(pick), mode: 'replace' })
          }
        }
      } catch {
        // A press never throws into the screen.
      }
    }

    const run = (item: { text: string; color?: string; bg?: string; bold?: boolean }, index: number) => (
      <Text key={String(index)} wrap="truncate" color={item.color} backgroundColor={item.bg} bold={item.bold}>
        {item.text}
      </Text>
    )

    const cell = (item: Item, index: number) =>
      'button' in item ? (
        <Button key={item.button} plain onPress={press(item.button)}>
          {item.runs.map(run)}
        </Button>
      ) : (
        run(item, index)
      )

    return (
      <Box flexDirection="column">
        {rows.map((row: Row, index: number) => (
          <Box key={`row-${index}`} flexDirection="row">
            {row.map(cell)}
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const progress = (await read($, progressAtom)) ?? normalize(null)
    const streak = streakOf(progress, dayKey(await $.clock.now()))
    const note = streak > 0 ? `${streak} day streak` : 'one small exercise a day'

    return (
      <Box flexDirection="row">
        <Button
          key="open"
          plain
          onPress={async () => {
            try {
              await openPane($)
            } catch {
              // Nothing to do if the pane cannot open.
            }
          }}
        >
          <Text color="#E6EDF3" backgroundColor="#262B33">
            {' Daily challenge '}
          </Text>
        </Button>
        <Text color="#7D8590" wrap="truncate">{`  ${note}`}</Text>
      </Box>
    )
  })
}
