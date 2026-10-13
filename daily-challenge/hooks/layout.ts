import type { Model } from './logic'
import { THEMES } from './challenges'

export const COLOR = {
  gold: '#F2C46D',
  hair: '#262B33',
  muted: '#7D8590',
  text: '#E6EDF3',
  green: '#3DD68C',
  amber: '#E3B341',
  dark: '#0D1117',
} as const

const THEME_COLOR: Record<(typeof THEMES)[number], string> = {
  Prompting: '#79C0FF',
  Files: '#D2A8FF',
  Commands: '#FFA657',
  Memory: '#FF8FB1',
  Agents: '#56D4DD',
  Build: '#B5E68A',
  Habits: '#FFB4A2',
}

export type Run = { text: string; color?: string; bg?: string; bold?: boolean }
export type Item = Run | { button: string; runs: Run[] }
export type Row = Item[]

export const MAX_WIDTH = 120
export const FOOTER = 'If a command is not on your version, ask Claude how to do it.'

const size = (text: string): number => [...text].length
const spaces = (count: number): string => ' '.repeat(Math.max(0, count))
const pad = (text: string, width: number): string => text + spaces(width - size(text))
const clip = (text: string, width: number): string =>
  size(text) <= width ? text : [...text].slice(0, Math.max(0, width - 1)).join('') + '…'

export function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word
    while (size(rest) > width) {
      if (line) {
        lines.push(line)
        line = ''
      }
      lines.push([...rest].slice(0, width).join(''))
      rest = [...rest].slice(width).join('')
    }
    if (!line) line = rest
    else if (size(line) + 1 + size(rest) <= width) line += ' ' + rest
    else {
      lines.push(line)
      line = rest
    }
  }
  if (line) lines.push(line)
  return lines
}

const GLYPH: Record<string, [string, string, string]> = {
  '0': ['┏━┓', '┃ ┃', '┗━┛'],
  '1': ['╺┓ ', ' ┃ ', '╺┻╸'],
  '2': ['┏━┓', '┏━┛', '┗━╸'],
  '3': ['╺━┓', '╺━┫', '╺━┛'],
  '4': ['╻ ╻', '┗━┫', '  ╹'],
  '5': ['┏━╸', '┗━┓', '╺━┛'],
  '6': ['┏━╸', '┣━┓', '┗━┛'],
  '7': ['╺━┓', '  ┃', '  ╹'],
  '8': ['┏━┓', '┣━┫', '┗━┛'],
  '9': ['┏━┓', '┗━┫', '╺━┛'],
}

// A number drawn three rows tall; the glyphs are three cells wide.
export function numeral(value: number, gap: number): string[] {
  const digits = [...String(Math.max(0, Math.floor(value)))]
  return [0, 1, 2].map(row => digits.map(digit => GLYPH[digit][row]).join(spaces(gap)))
}

const numeralWidth = (value: number, gap: number): number => size(numeral(value, gap)[0])

const rule = (width: number, color: string): Run => ({ text: '─'.repeat(Math.max(0, width)), color })

function heading(label: string, width: number): Row {
  const text = clip(label, width)
  return [
    { text, color: COLOR.muted, bold: true },
    { text: ' ', color: COLOR.muted },
    rule(width - size(text) - 1, COLOR.hair),
  ]
}

const blank = (width: number): Row => [{ text: spaces(width) }]

function titleBar(model: Model, width: number): Row[] {
  const title = 'DAILY CHALLENGE'
  const date = clip(model.dateLabel, Math.max(0, width - size(title) - 2))
  const gap = width - size(title) - size(date)
  return [
    [
      { text: title, color: COLOR.text, bold: true },
      { text: spaces(gap) },
      { text: date, color: COLOR.muted },
    ],
    [
      { text: '━'.repeat(Math.min(size(title), width)), color: COLOR.gold },
      rule(width - size(title), COLOR.hair),
    ],
  ]
}

type Tile = { label: string; value: number; sub: string; color: string }

function tileRows(tile: Tile, width: number): Row[] {
  const inner = width - 2
  const side = inner >= 13 ? 1 : 0
  const room = inner - 2 * side
  const gap = numeralWidth(tile.value, 1) <= room ? 1 : 0
  const canDraw = numeralWidth(tile.value, gap) <= room
  const numerals = canDraw ? numeral(tile.value, gap) : [String(tile.value)]
  const border = (text: string): Run => ({ text, color: COLOR.hair })
  const line = (text: string, color: string, bold = false): Row => [
    border('│'),
    { text: spaces(side) },
    { text: pad(clip(text, room), room), color, bold },
    { text: spaces(side) },
    border('│'),
  ]
  const label = size(tile.label) <= room ? tile.label : tile.label.split(' ')[0]
  return [
    [border('╭' + '─'.repeat(inner) + '╮')],
    line(label, COLOR.muted, true),
    ...numerals.map(text => line(text, tile.color, true)),
    ...(canDraw ? [] : [line('', COLOR.text), line('', COLOR.text)].slice(0, 3 - numerals.length)),
    line(tile.sub, COLOR.muted),
    [border('╰' + '─'.repeat(inner) + '╯')],
  ]
}

function tiles(model: Model, width: number): Row[] {
  const gap = 1
  const each = Math.max(5, Math.floor((width - 2 * gap) / 3))
  const list: Tile[] = [
    { label: 'DAY STREAK', value: model.streak, sub: model.streak === 1 ? 'day' : 'days', color: COLOR.gold },
    { label: 'COMPLETED', value: model.done, sub: `of ${model.total}`, color: COLOR.text },
    { label: 'BEST STREAK', value: model.best, sub: model.best === 1 ? 'day' : 'days', color: COLOR.text },
  ]
  const columns = list.map(tile => tileRows(tile, each))
  const count = Math.max(...columns.map(column => column.length))
  const rows: Row[] = []
  for (let i = 0; i < count; i += 1) {
    const row: Row = []
    columns.forEach((column, index) => {
      if (index > 0) row.push({ text: spaces(gap) })
      row.push(...(column[i] ?? [{ text: spaces(each) }]))
    })
    rows.push(row)
  }
  return rows
}

function boxed(lines: Row[], width: number, color: string): Row[] {
  const inner = width - 4
  const edge = (text: string): Run => ({ text, color })
  return [
    [edge('╭' + '─'.repeat(width - 2) + '╮')],
    ...lines.map((line): Row => {
      const used = line.reduce((sum, item) => sum + size('text' in item ? item.text : ''), 0)
      return [edge('│ '), ...line, { text: spaces(inner - used) }, edge(' │')]
    }),
    [edge('╰' + '─'.repeat(width - 2) + '╯')],
  ]
}

const textLines = (text: string, width: number, color: string, bold = false): Row[] =>
  wrap(text, width).map((line): Row => [{ text: line, color, bold }])

function card(model: Model, width: number): Row[] {
  const inner = width - 4
  if (model.isFinished) {
    return boxed(
      [
        ...textLines('ALL 365 COMPLETE', inner, COLOR.green, true),
        [{ text: spaces(inner) }],
        ...textLines(
          'You have finished every challenge. Nothing more will be offered, and your numbers stay here.',
          inner,
          COLOR.text,
        ),
      ],
      width,
      COLOR.green,
    )
  }
  const challenge = model.challenge
  if (!challenge) {
    return boxed(textLines('No challenge is available right now.', inner, COLOR.amber), width, COLOR.gold)
  }
  return boxed(
    [
      ...textLines(challenge.theme.toUpperCase(), inner, THEME_COLOR[challenge.theme], true),
      ...textLines(challenge.title, inner, COLOR.text, true),
      [{ text: spaces(inner) }],
      ...textLines(challenge.task, inner, COLOR.text),
    ],
    width,
    model.isDoneToday ? COLOR.green : COLOR.gold,
  )
}

type Chip = { button: string; label: string; kind: 'gold' | 'slate' | 'quiet' }

function chipRuns(chip: Chip): Run[] {
  const text = ` ${chip.label} `
  if (chip.kind === 'gold') return [{ text, color: COLOR.dark, bg: COLOR.gold, bold: true }]
  if (chip.kind === 'slate') return [{ text, color: COLOR.text, bg: COLOR.hair }]
  return [{ text, color: COLOR.muted }]
}

function chipRows(chips: Chip[], width: number): Row[] {
  const rows: Row[] = []
  let row: Row = []
  let used = 0
  for (const chip of chips) {
    const runs = chipRuns(chip)
    const need = size(runs[0].text)
    if (row.length > 0 && used + 1 + need > width) {
      rows.push(row)
      row = []
      used = 0
    }
    if (row.length > 0) {
      row.push({ text: ' ' })
      used += 1
    }
    row.push({ button: chip.button, runs })
    used += need
  }
  if (row.length > 0) rows.push(row)
  return rows
}

function actions(model: Model, width: number): Row[] {
  if (model.isDoneToday) {
    return [
      [{ text: 'Completed today', color: COLOR.green, bold: true }],
      ...textLines('A new challenge is waiting tomorrow.', width, COLOR.muted),
      ...chipRows([{ button: 'undo', label: 'Undo', kind: 'quiet' }], width),
    ]
  }
  if (model.isFinished || !model.challenge) return []
  const chips: Chip[] = [
    { button: 'complete', label: 'Mark complete', kind: 'gold' },
    { button: 'coach', label: 'Coach me through it', kind: 'slate' },
  ]
  if (model.canSwap) chips.push({ button: 'another', label: 'Give me another', kind: 'slate' })
  return chipRows(chips, width)
}

function lastDays(model: Model, width: number): Row[] {
  const cell = Math.min(6, Math.max(1, Math.floor(width / model.days.length)))
  const squares: Row = model.days.map(day => ({
    text: pad(day.isFilled ? '■' : '□', cell),
    color: day.isFilled ? COLOR.gold : COLOR.muted,
  }))
  const names: Row = model.days.map(day => ({
    text: pad(cell >= 4 ? day.weekday : cell === 3 ? day.weekday.slice(0, 2) : day.weekday[0], cell),
    color: day.isToday ? COLOR.text : COLOR.muted,
    bold: day.isToday,
  }))
  return [squares, names]
}

function year(model: Model, width: number): Row[] {
  const filled = Math.min(width, Math.round((model.done / model.total) * width))
  const left = `${model.done} done`
  const right = `${model.total - model.done} to go`
  const gap = Math.max(1, width - size(left) - size(right))
  return [
    [
      { text: '━'.repeat(filled), color: COLOR.gold },
      { text: '─'.repeat(width - filled), color: COLOR.hair },
    ],
    [
      { text: left, color: COLOR.text },
      { text: spaces(gap) },
      { text: right, color: COLOR.muted },
    ],
  ]
}

// Every row of the pane, each no wider than `columns`.
export function buildRows(model: Model, columns: number): Row[] {
  const width = Math.max(20, Math.min(columns, MAX_WIDTH))
  return [
    ...titleBar(model, width),
    blank(width),
    ...tiles(model, width),
    blank(width),
    heading(model.isFinished ? 'FINISHED' : "TODAY'S CHALLENGE", width),
    ...card(model, width),
    blank(width),
    ...actions(model, width),
    blank(width),
    heading('LAST 14 DAYS', width),
    ...lastDays(model, width),
    blank(width),
    heading('YOUR YEAR', width),
    ...year(model, width),
    blank(width),
    ...textLines(FOOTER, width, COLOR.muted),
  ]
}

export const rowWidth = (row: Row): number =>
  row.reduce(
    (sum, item) =>
      sum + ('button' in item ? item.runs.reduce((a, run) => a + size(run.text), 0) : size(item.text)),
    0,
  )
