/**
 * Demo-funnel analytics (#287).
 *
 * Lets us compare the conversion power of the interactive demo against the
 * (never-shipped) promo video and the plain landing→signup path.
 *
 * **Privacy contract (GDPR — see PrivacyPage §7).** These events run for
 * unauthenticated visitors, so their payloads must carry *no* personal or
 * library content: no book titles, no photos, no raw search strings. Only
 * counts, booleans and enums are allowed (e.g. `query_len`, `result_count`,
 * `action_index`). Keep this module the single, auditable place where demo
 * events are shaped.
 */
import { trackEvent } from './analytics'

/** Where the visitor entered the demo from. */
export type DemoStartSource = 'hero' | 'visual_proof' | 'final_cta' | 'header'

/** Which conversion surface the signup click came from. */
export type DemoSignupSource = 'banner' | 'nudge'

/** Visitor opened the demo. */
export function trackDemoStart(source: DemoStartSource): void {
  trackEvent('demo_start', { source })
}

/**
 * Visitor ran a search inside the demo.
 * @param queryLen   length of the query string (never the string itself)
 * @param resultCount number of matches
 */
export function trackDemoSearch(queryLen: number, resultCount: number): void {
  trackEvent('demo_search', { query_len: queryLen, result_count: resultCount })
}

/**
 * Visitor added a book inside the demo.
 * @param actionIndex 1-based count of adds in this demo session
 */
export function trackDemoAddBook(actionIndex: number): void {
  trackEvent('demo_add_book', { action_index: actionIndex })
}

/**
 * Visitor completed the scripted scan inside the demo.
 * @param bookCount number of books confirmed
 */
export function trackDemoScanComplete(bookCount: number): void {
  trackEvent('demo_scan_complete', { book_count: bookCount })
}

/** Visitor clicked a signup CTA from within the demo. */
export function trackDemoSignupClick(source: DemoSignupSource): void {
  trackEvent('demo_signup_click', { source_section: source })
}
