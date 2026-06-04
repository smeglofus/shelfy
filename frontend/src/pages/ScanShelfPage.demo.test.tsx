/**
 * Demo-mode behaviour for ScanShelfPage — the scripted shelf-scan walkthrough
 * (#286).
 *
 * Drives the full wizard (location → scan → review → confirm) for a logged-out
 * visitor and asserts:
 *  - tapping a sample photo replays a canned result (no upload / AI / network),
 *  - confirming writes the books into the in-memory demo store,
 *  - the scan API surface is never touched.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: false })),
}))

// Loud stubs: any reach for the network fails the demo's core promise.
vi.mock('../lib/api', () => ({
  scanShelf: vi.fn(),
  getShelfScanResult: vi.fn(),
  confirmShelfScan: vi.fn(),
  listBooksByLocation: vi.fn(),
  listLocations: vi.fn(),
  createLocation: vi.fn(),
  formatApiError: (e: unknown) => String(e),
}))

vi.mock('../lib/analytics', () => ({ trackEvent: vi.fn() }))

vi.mock('../lib/toast-store', () => ({
  useToastStore: vi.fn(
    (selector: (s: { showError: () => void; showSuccess: () => void; showInfo: () => void }) => unknown) =>
      selector({ showError: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn() }),
  ),
}))

import * as api from '../lib/api'
import { ScanShelfPage } from './ScanShelfPage'
import { DemoModeProvider } from '../features/demo/DemoContext'
import { useDemoStore } from '../store/useDemoStore'

function renderDemo() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/demo/scan']}>
        <DemoModeProvider>{children}</DemoModeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(<ScanShelfPage />, { wrapper })
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  useDemoStore.getState().reset()
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  useDemoStore.getState().reset()
})

describe('ScanShelfPage — demo mode (#286)', () => {
  it('runs the scripted scan and writes results to the in-memory store, no network', async () => {
    renderDemo()

    // ── Step 1: pick the seeded Living room / Bookcase / Shelf 1 ──
    // Locations arrive asynchronously from the demo store via React Query.
    await waitFor(
      () => expect(screen.getAllByRole('combobox')[0].querySelectorAll('option').length).toBeGreaterThan(1),
      { timeout: 5000 }, // React Query hydration is slow on CI runners; default 1s flakes
    )
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'Living room' } })
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'Bookcase' } })
    fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: 'Shelf 1' } })
    fireEvent.click(screen.getByText('scan.next_step'))

    // ── Step 2: a sample photo, not a file input, drives the scan ──
    expect(screen.getByTestId('demo-scan-note')).toBeInTheDocument()
    expect(document.querySelector('input[type="file"]')).toBeNull()

    fireEvent.click(screen.getByTestId('demo-scan-photo-photo-1'))

    // Canned result lands after the simulated processing delay.
    await waitFor(() => expect(screen.getByText('scan.go_to_review')).toBeInTheDocument(), { timeout: 2000 })
    fireEvent.click(screen.getByText('scan.go_to_review'))

    // ── Step 3: review shows the detected titles ──
    expect(await screen.findByDisplayValue('Krakatit')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Saturnin')).toBeInTheDocument()

    fireEvent.click(screen.getByText('scan.confirm_books'))

    // Replace mode wiped the 6 seeded Shelf-1 books and wrote the 3 named ones
    // (the no-text / needs-review entry was dropped for having no title).
    await waitFor(() => {
      const shelf = useDemoStore.getState().booksByLocation('demo-loc-1')
      expect(shelf.map((b) => b.title)).toEqual(['Krakatit', 'Bílá nemoc', 'Saturnin'])
    })

    expect(api.scanShelf).not.toHaveBeenCalled()
    expect(api.getShelfScanResult).not.toHaveBeenCalled()
    expect(api.confirmShelfScan).not.toHaveBeenCalled()
  }, 20000) // multi-step wizard + simulated scan delay; generous for slow CI
})
