/**
 * demoNav — keeps in-app navigation inside the `/demo/*` subtree (#285).
 *
 * The demo reuses the real pages (`BooksPage`, `BookshelfViewPage`, …), which
 * navigate with absolute production paths like `ROUTES.books` (`/books`). Left
 * alone, a click in the demo would jump the visitor straight into the
 * authenticated app (and bounce them to `/login`). These helpers transparently
 * rewrite those absolute paths to their `/demo`-prefixed twins **only when the
 * `DemoModeProvider` is active** — outside the demo they are exact pass-throughs,
 * so the authenticated app is completely unaffected.
 */
import { useCallback } from 'react'
import { useNavigate, type NavigateOptions } from 'react-router-dom'

import { useIsDemoMode } from './DemoContext'

/** Path prefix that scopes every public demo route. */
export const DEMO_PREFIX = '/demo'

/** Map an absolute app path to its demo twin (idempotent). */
export function withDemoPrefix(path: string): string {
  if (path === DEMO_PREFIX || path.startsWith(`${DEMO_PREFIX}/`)) return path
  return `${DEMO_PREFIX}${path.startsWith('/') ? '' : '/'}${path}`
}

/**
 * Returns a path-rewriter: identity outside the demo, `/demo`-prefixer inside.
 * Use for `<Link to={…}>` targets.
 */
export function useDemoPath(): (path: string) => string {
  const isDemo = useIsDemoMode()
  return useCallback((path: string) => (isDemo ? withDemoPrefix(path) : path), [isDemo])
}

/**
 * Drop-in replacement for `useNavigate` that keeps string destinations inside
 * the demo subtree. Numeric (history-delta) navigation is passed through
 * unchanged.
 */
export function useAppNavigate(): (to: string | number, options?: NavigateOptions) => void {
  const navigate = useNavigate()
  const isDemo = useIsDemoMode()
  return useCallback(
    (to: string | number, options?: NavigateOptions) => {
      if (typeof to === 'number') {
        navigate(to)
        return
      }
      navigate(isDemo ? withDemoPrefix(to) : to, options)
    },
    [navigate, isDemo],
  )
}
