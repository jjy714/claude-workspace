import type { Register } from 'claude-code'

import { registerCleanView } from './clean-view'
import { registerDock } from './dock'

export const register: Register = on => {
  // The dock goes first so its helper report_progress hook runs before Clean View's.
  registerDock(on)
  registerCleanView(on)
}
