/**
 * DemoLayout — the route wrapper + chrome for the public client-side demo (#285).
 *
 * Every `/demo/*` route renders inside this layout. It does two things:
 *  1. Wraps the subtree in {@link DemoModeProvider} so the demo-aware hooks
 *     (`useBooks`, `useLocations`, …) read the in-memory `useDemoStore` instead
 *     of the network — guaranteeing zero backend/AI load for visitors.
 *  2. Renders the {@link DemoBanner} in place of the authenticated `Navigation`
 *     shell, making it obvious this is a sandbox and offering a sign-up CTA.
 *
 * The real pages (`BooksPage`, `BookshelfViewPage`, …) are reused verbatim via
 * `<Outlet />`; they adapt to demo mode through `useIsDemoMode()`.
 *
 * This module is loaded via `React.lazy` (see `App.tsx`), so everything it
 * pulls in — most importantly the seed library in `demoSeed` — ships in a
 * separate chunk that authenticated users never download. Seeding happens
 * here on first mount; the store starts empty and `seeded` is persisted in
 * sessionStorage, so a mid-session reload keeps the visitor's sandbox.
 */
import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'

import { useDemoStore } from '../../store/useDemoStore'
import { DemoModeProvider } from './DemoContext'
import { DemoBanner } from './DemoBanner'
import { seedDemoStore } from './seedDemoStore'

export function DemoLayout() {
  const seeded = useDemoStore((s) => s.seeded)

  useEffect(() => {
    if (!useDemoStore.getState().seeded) seedDemoStore()
  }, [])

  return (
    <DemoModeProvider>
      <DemoBanner />
      {/* Render pages only once the seed is in — avoids a one-frame flash of
          an empty library (and empty-state CTAs) on first entry. */}
      {seeded && <Outlet />}
    </DemoModeProvider>
  )
}
