/**
 * Demo-funnel analytics (#287) — event shape + GDPR payload audit.
 *
 * The hard requirement: demo events run for logged-out visitors, so their
 * payloads must never carry personal/library content (titles, photos, raw
 * search strings). This test pins each event's payload and asserts every key
 * is on a counts/enums allowlist.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const trackEvent = vi.fn()
vi.mock('./analytics', () => ({ trackEvent: (...args: unknown[]) => trackEvent(...args) }))

import {
  trackDemoAddBook,
  trackDemoScanComplete,
  trackDemoSearch,
  trackDemoSignupClick,
  trackDemoStart,
} from './demoAnalytics'

beforeEach(() => trackEvent.mockClear())

describe('demoAnalytics', () => {
  it('emits each event with the documented payload', () => {
    trackDemoStart('hero')
    expect(trackEvent).toHaveBeenLastCalledWith('demo_start', { source: 'hero' })

    trackDemoSearch(5, 3)
    expect(trackEvent).toHaveBeenLastCalledWith('demo_search', { query_len: 5, result_count: 3 })

    trackDemoAddBook(2)
    expect(trackEvent).toHaveBeenLastCalledWith('demo_add_book', { action_index: 2 })

    trackDemoScanComplete(4)
    expect(trackEvent).toHaveBeenLastCalledWith('demo_scan_complete', { book_count: 4 })

    trackDemoSignupClick('nudge')
    expect(trackEvent).toHaveBeenLastCalledWith('demo_signup_click', { source_section: 'nudge' })
  })

  it('never sends personal/library content — only counts, enums, booleans', () => {
    trackDemoStart('visual_proof')
    trackDemoSearch(12, 0)
    trackDemoAddBook(1)
    trackDemoScanComplete(7)
    trackDemoSignupClick('banner')

    const ALLOWED_KEYS = new Set([
      'source',
      'query_len',
      'result_count',
      'action_index',
      'book_count',
      'source_section',
    ])
    const ENUM_VALUES = new Set(['hero', 'visual_proof', 'final_cta', 'header', 'banner', 'nudge'])

    for (const [, props] of trackEvent.mock.calls as Array<[string, Record<string, unknown>]>) {
      for (const [key, value] of Object.entries(props ?? {})) {
        expect(ALLOWED_KEYS.has(key)).toBe(true)
        // Values are numbers or short enum strings — never free text/titles/photos.
        if (typeof value === 'string') {
          expect(ENUM_VALUES.has(value)).toBe(true)
        } else {
          expect(typeof value).toBe('number')
        }
      }
    }
  })
})
