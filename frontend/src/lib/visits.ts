/**
 * Anonymous, cookieless visit counter (Prometheus `shelfy_page_views_total`).
 *
 * Privacy contract: the beacon carries only a page *kind* from a fixed list
 * and the traffic source seen on entry (`utm_source` or the referrer host).
 * No user id, no URL, no cookie and nothing stored on the device; each page
 * kind is sent once per page load. The backend maps both values onto fixed
 * allowlists, so this needs no consent.
 */

export type VisitPage =
  | 'landing'
  | 'demo'
  | 'demo_scan'
  | 'pricing'
  | 'login'
  | 'signup'
  | 'google_auth'

const ENDPOINT = '/api/v1/telemetry/visit'
// In-memory only: nothing is written to the visitor's device (no cookie, no
// local/sessionStorage), so the counter needs no consent. A full page reload
// therefore counts again — acceptable for a rough funnel.
const seenPages = new Set<VisitPage>()
let entrySource: string | null = null

/** Raw entry source: utm_source, else external referrer host, else "direct". */
export function detectEntrySource(search: string, referrer: string, ownHost: string): string {
  const utm = new URLSearchParams(search).get('utm_source')?.trim()
  if (utm) return utm.slice(0, 100)
  if (!referrer) return 'direct'
  try {
    const host = new URL(referrer).hostname
    if (!host || host === ownHost) return 'direct'
    return host
  } catch {
    return 'direct'
  }
}

/** Entry source for this page load (captured on the first call). */
export function getEntrySource(): string {
  if (entrySource === null) {
    entrySource = detectEntrySource(window.location.search, document.referrer, window.location.hostname)
  }
  return entrySource
}

/** Map a route path onto a counted page kind (null = not counted). */
export function visitPageForPath(pathname: string, isAuthenticated: boolean): VisitPage | null {
  if (pathname === '/') return isAuthenticated ? null : 'landing'
  if (pathname === '/demo/scan') return 'demo_scan'
  if (pathname === '/demo' || pathname.startsWith('/demo/')) return 'demo'
  if (pathname === '/pricing') return 'pricing'
  if (pathname === '/login') return 'login'
  return null
}

function isAutomated(): boolean {
  if (import.meta.env.MODE === 'test') return true
  return typeof navigator !== 'undefined' && navigator.webdriver === true
}

/** Send one beacon per page kind per page load. Never throws. */
export function trackVisit(page: VisitPage): void {
  if (isAutomated()) return
  if (seenPages.has(page)) return
  seenPages.add(page)
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page, source: getEntrySource() }),
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // swallow — analytics must never break the page
  }
}
