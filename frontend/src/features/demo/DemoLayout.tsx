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
 */
import { Outlet } from 'react-router-dom'

import { DemoModeProvider } from './DemoContext'
import { DemoBanner } from './DemoBanner'

export function DemoLayout() {
  return (
    <DemoModeProvider>
      <DemoBanner />
      <Outlet />
    </DemoModeProvider>
  )
}
