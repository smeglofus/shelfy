import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectEntrySource, trackVisit, visitPageForPath } from './visits'

describe('detectEntrySource', () => {
  it('prefers utm_source over the referrer', () => {
    expect(detectEntrySource('?utm_source=facebook&utm_medium=group', 'https://www.google.com/', 'shelfy.cz')).toBe('facebook')
  })

  it('falls back to the external referrer host', () => {
    expect(detectEntrySource('', 'https://l.facebook.com/l.php?u=x', 'shelfy.cz')).toBe('l.facebook.com')
  })

  it('treats own-host and missing referrers as direct', () => {
    expect(detectEntrySource('', 'https://shelfy.cz/pricing', 'shelfy.cz')).toBe('direct')
    expect(detectEntrySource('', '', 'shelfy.cz')).toBe('direct')
    expect(detectEntrySource('', 'not a url', 'shelfy.cz')).toBe('direct')
  })
})

describe('visitPageForPath', () => {
  it('maps public routes to page kinds', () => {
    expect(visitPageForPath('/', false)).toBe('landing')
    expect(visitPageForPath('/demo/books', false)).toBe('demo')
    expect(visitPageForPath('/demo', false)).toBe('demo')
    expect(visitPageForPath('/demo/scan', false)).toBe('demo_scan')
    expect(visitPageForPath('/pricing', true)).toBe('pricing')
    expect(visitPageForPath('/login', false)).toBe('login')
  })

  it('ignores the app itself and the landing for signed-in users', () => {
    expect(visitPageForPath('/', true)).toBeNull()
    expect(visitPageForPath('/books', true)).toBeNull()
    expect(visitPageForPath('/demonstration', false)).toBeNull()
  })
})

describe('trackVisit', () => {
  afterEach(() => vi.restoreAllMocks())

  it('never sends beacons from the test environment', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    trackVisit('landing')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
