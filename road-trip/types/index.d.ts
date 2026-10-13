export type RoadTripView = { mode: string; sig: string }

declare module 'claude-code' {
  interface PluginState {
    // Road Trip's own value: which screen the buttons under the road belong to.
    'road-trip': { view: RoadTripView }
    // Read-only, shared by other mods in the kit when they are installed.
    'clean-view': { checklist: unknown }
    'brand-skin': { skin: unknown }
  }
}
