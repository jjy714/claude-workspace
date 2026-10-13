export type LogEntry = { date: string; id: number }
export type Swap = { date: string; id: number }
export type Progress = { log: LogEntry[]; swap: Swap | null }

declare module 'claude-code' {
  interface PluginState {
    'daily-challenge': { progress: Progress | null }
  }
}
