// The one running shift, plus the React binding to it.
import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { Sim } from './engine.ts'
import { WALL } from './data.ts'
import type { SimState, Theme } from './data.ts'

// Demo knobs: ?speed=2 runs the shift twice as fast, ?wallpaper=Tide|Graphite|Dusk changes the desktop.
const params = new URLSearchParams(location.search)
export const sim = new Sim()
sim.speed = Math.min(8, Math.max(0.25, Number(params.get('speed')) || 1))
export const wallpaper = WALL[params.get('wallpaper') ?? ''] ?? WALL.Dusk

/** Subscribe to a slice of the shift. Select existing state, not freshly built objects. */
export function useSim<T>(select: (s: SimState) => T): T {
  return useSyncExternalStore(sim.subscribe, () => select(sim.state))
}

/** Switches theme with a native cross-fade where the browser supports it. */
export function setTheme(theme: Theme) {
  const apply = () => flushSync(() => sim.set({ theme }))
  if (document.startViewTransition) document.startViewTransition(apply)
  else apply()
}
