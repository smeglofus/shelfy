/**
 * useDemoActivity (#287) — action counters + nudge gating.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { shouldShowDemoNudge, useDemoActivity } from './useDemoActivity'

beforeEach(() => useDemoActivity.getState().reset())

describe('useDemoActivity', () => {
  it('records actions and returns the running count', () => {
    expect(useDemoActivity.getState().recordSearch()).toBe(1)
    expect(useDemoActivity.getState().recordAdd()).toBe(1)
    expect(useDemoActivity.getState().recordAdd()).toBe(2)
    expect(useDemoActivity.getState().recordScan()).toBe(1)
    const s = useDemoActivity.getState()
    expect([s.searches, s.adds, s.scans]).toEqual([1, 2, 1])
  })

  it('reset() clears counters and the dismissed flag', () => {
    useDemoActivity.getState().recordScan()
    useDemoActivity.getState().dismissNudge()
    useDemoActivity.getState().reset()
    const s = useDemoActivity.getState()
    expect([s.searches, s.adds, s.scans, s.nudgeDismissed]).toEqual([0, 0, 0, false])
  })
})

describe('shouldShowDemoNudge', () => {
  const base = { searches: 0, adds: 0, scans: 0, nudgeDismissed: false }

  it('stays hidden until the visitor shows real intent', () => {
    expect(shouldShowDemoNudge(base)).toBe(false)
    expect(shouldShowDemoNudge({ ...base, searches: 3 })).toBe(false) // search alone is not enough
    expect(shouldShowDemoNudge({ ...base, adds: 1 })).toBe(false)
  })

  it('fires after a completed scan, or one search + one add', () => {
    expect(shouldShowDemoNudge({ ...base, scans: 1 })).toBe(true)
    expect(shouldShowDemoNudge({ ...base, searches: 1, adds: 1 })).toBe(true)
  })

  it('never fires once dismissed', () => {
    expect(shouldShowDemoNudge({ searches: 2, adds: 2, scans: 1, nudgeDismissed: true })).toBe(false)
  })
})
