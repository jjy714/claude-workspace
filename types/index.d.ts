export type CleanViewTaskStatus = 'done' | 'active' | 'upcoming'

export type CleanViewTask = {
  id: string
  name: string
  status: CleanViewTaskStatus
  percent: number
  hasReported: boolean
}

export type CleanViewPhase =
  | 'idle'
  | 'working'
  | 'needs-you'
  | 'stuck'
  | 'stopped'
  | 'done'

export type CleanViewChecklist = {
  title: string
  phase: CleanViewPhase
  tasks: CleanViewTask[]
  needsYouReason: string | null
  stuckReason: string | null
  startedAt: number | null
  finishedAt: number | null
  isCollapsed: boolean
}

export type CardStatus = 'queued' | 'working' | 'done' | 'stuck'

export type DockCard = {
  id: string
  name: string
  status: CardStatus
  percent: number
  hasReported: boolean
  agentId: string | null
  startedAt: number | null
  endedAt: number | null
}

export type DockCounts = {
  working: number
  queued: number
  done: number
  stuck: number
  total: number
}

export type DockPhase = 'idle' | 'live' | 'done'

export type DockState = {
  size: number
  pendingSize: number | null
  helperModel: 'fast' | 'same'
  isCustomOpen: boolean
  isFolded: boolean
  phase: DockPhase
  job: string
  cards: DockCard[]
  startedAt: number | null
  finishedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'clean-view': {
      cleanViewEnabled: boolean
      checklist: CleanViewChecklist
      tick: number
      dock: DockState
      dockTick: number
    }
  }
}
