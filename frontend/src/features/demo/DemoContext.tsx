/**
 * DemoContext — a one-bit flag that tells data hooks whether they are running
 * inside the public client-side demo (`/demo/*`, wired up in #285).
 *
 * Default is `false`, so nothing changes for the authenticated app. The
 * `DemoModeProvider` wraps only the demo routes and flips it on; the
 * demo-aware hooks read {@link useIsDemoMode} to decide between the real API
 * and the in-memory `useDemoStore`.
 */
import { createContext, useContext, type ReactNode } from 'react'

const DemoModeContext = createContext<boolean>(false)

export function DemoModeProvider({ children }: { children: ReactNode }) {
  return <DemoModeContext.Provider value={true}>{children}</DemoModeContext.Provider>
}

/** True only inside the demo subtree. */
export function useIsDemoMode(): boolean {
  return useContext(DemoModeContext)
}
