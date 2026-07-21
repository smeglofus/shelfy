import { afterEach, describe, expect, it } from 'vitest'

import { getConsent, hasAnalyticsConsent, onConsentChange, setConsent } from './consent'

afterEach(() => {
  localStorage.clear()
})

describe('consent', () => {
  it('returns null when nothing is stored', () => {
    expect(getConsent()).toBeNull()
    expect(hasAnalyticsConsent()).toBe(false)
  })

  it('persists and reads a granted choice', () => {
    setConsent('granted')
    expect(getConsent()).toBe('granted')
    expect(hasAnalyticsConsent()).toBe(true)
  })

  it('treats denied as no analytics consent', () => {
    setConsent('denied')
    expect(getConsent()).toBe('denied')
    expect(hasAnalyticsConsent()).toBe(false)
  })

  it('notifies subscribers on change', () => {
    let seen: string | null = null
    const off = onConsentChange((s) => { seen = s })
    setConsent('granted')
    expect(seen).toBe('granted')
    off()
    setConsent('denied')
    expect(seen).toBe('granted') // unsubscribed — no further updates
  })
})
