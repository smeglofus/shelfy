/**
 * Demo-mode behaviour for BorrowersPage (#288 follow-up).
 *
 * A logged-out visitor inside `/demo/*` can browse the seeded borrowers. The
 * list reads the in-memory demo store (no network), links into the `/demo`
 * subtree, and hides the GDPR bulk-anonymize control. The lend/return
 * lifecycle is fully sandboxed client-side, so seeded borrowers carry real
 * active/total loan counts.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: false })),
}))

// Stub the API so the test fails loudly if the demo ever reaches the network.
vi.mock('../lib/api', () => ({
  listBorrowers: vi.fn(),
  getBorrower: vi.fn(),
  listBorrowerLoans: vi.fn(),
  anonymizeBorrower: vi.fn(),
  restoreBorrower: vi.fn(),
  updateBorrower: vi.fn(),
  mergeBorrowers: vi.fn(),
  formatApiError: (e: unknown) => String(e),
}))

vi.mock('../lib/toast-store', () => ({
  useToastStore: (selector: (s: { showError: () => void; showSuccess: () => void; showInfo: () => void }) => unknown) =>
    selector({ showError: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn() }),
}))

import * as api from '../lib/api'
import { BorrowersPage } from './BorrowersPage'
import { DemoModeProvider } from '../features/demo/DemoContext'
import { useDemoStore } from '../store/useDemoStore'
import { seedDemoStore } from '../features/demo/seedDemoStore'

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/demo/borrowers']}>
        <DemoModeProvider>{children}</DemoModeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(
    <Routes>
      <Route path="/demo/borrowers" element={<BorrowersPage />} />
    </Routes>,
    { wrapper },
  )
}

beforeEach(() => {
  sessionStorage.clear()
  seedDemoStore()
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  seedDemoStore()
})

describe('BorrowersPage — demo mode', () => {
  it('renders seeded borrowers from the in-memory store with /demo links, no network', async () => {
    renderList()

    // Seeded borrowers surface from the store.
    expect(await screen.findByText('Jana Nováková')).toBeInTheDocument()
    expect(screen.getByText('Petr Svoboda')).toBeInTheDocument()
    expect(screen.getByText('Lucie Dvořáková')).toBeInTheDocument()
    expect(screen.getByText('Tomáš Procházka')).toBeInTheDocument()

    // The row links stay inside the /demo subtree.
    const janaRow = useDemoStore.getState().borrowers.find((b) => b.name === 'Jana Nováková')!
    expect(screen.getByTestId(`borrower-row-${janaRow.id}`)).toHaveAttribute(
      'href',
      `/demo/borrowers/${janaRow.id}`,
    )

    // Loan aggregates come from the sandboxed lifecycle (Jana lends 2 active).
    expect(screen.getByTestId(`borrower-active-${janaRow.id}`)).toHaveTextContent(
      'borrowers.active_count',
    )

    // Never touched the network.
    expect(api.listBorrowers).not.toHaveBeenCalled()
  })

  it('hides the GDPR bulk-anonymize control in the demo', async () => {
    renderList()
    await screen.findByText('Jana Nováková')

    expect(screen.queryByTestId('bulk-anonymize-button')).not.toBeInTheDocument()
  })
})
