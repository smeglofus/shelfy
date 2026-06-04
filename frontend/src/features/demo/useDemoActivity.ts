/**
 * useDemoActivity — tracks how far a visitor has engaged with the demo so the
 * conversion nudge (#287) can fire at the right moment.
 *
 * In-memory only (no persistence): a fresh tab starts clean, and progress
 * survives in-app navigation between `/demo/*` pages within the same session.
 * Holds only counts + a dismissed flag — never any library content.
 */
import { create } from 'zustand'

interface DemoActivityState {
  searches: number
  adds: number
  scans: number
  nudgeDismissed: boolean
  /** Record an action; returns the new running count for that action. */
  recordSearch: () => number
  recordAdd: () => number
  recordScan: () => number
  dismissNudge: () => void
  reset: () => void
}

export const useDemoActivity = create<DemoActivityState>((set, get) => ({
  searches: 0,
  adds: 0,
  scans: 0,
  nudgeDismissed: false,
  recordSearch: () => {
    const n = get().searches + 1
    set({ searches: n })
    return n
  },
  recordAdd: () => {
    const n = get().adds + 1
    set({ adds: n })
    return n
  },
  recordScan: () => {
    const n = get().scans + 1
    set({ scans: n })
    return n
  },
  dismissNudge: () => set({ nudgeDismissed: true }),
  reset: () => set({ searches: 0, adds: 0, scans: 0, nudgeDismissed: false }),
}))

/**
 * The nudge appears once the visitor has shown real intent — a completed scan,
 * or at least one search *and* one add — and hasn't dismissed it.
 */
export function shouldShowDemoNudge(
  s: Pick<DemoActivityState, 'searches' | 'adds' | 'scans' | 'nudgeDismissed'>,
): boolean {
  if (s.nudgeDismissed) return false
  return s.scans >= 1 || (s.searches >= 1 && s.adds >= 1)
}
