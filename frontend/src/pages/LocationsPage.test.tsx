import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LocationsPage } from './LocationsPage'
import type { Location } from '../lib/types'

vi.mock('../lib/api', () => ({
  listLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
  formatApiError: vi.fn(() => 'API error'),
}))

import { createLocation, deleteLocation, listLocations } from '../lib/api'

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const baseLocations: Location[] = [
  {
    id: 'loc-1',
    room: 'Office',
    furniture: 'Bookshelf',
    shelf: 'Shelf 1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
]

describe('LocationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders location list with mock data', async () => {
    vi.mocked(listLocations).mockResolvedValue(baseLocations)

    renderWithProviders(<LocationsPage />)

    expect(await screen.findByText('Office')).toBeInTheDocument()
    expect(screen.getByText('Bookshelf')).toBeInTheDocument()
    expect(screen.getByText('Shelf 1')).toBeInTheDocument()
  })

  it('submits create form and refreshes the list', async () => {
    vi.mocked(listLocations).mockResolvedValue(baseLocations)
    vi.mocked(createLocation).mockImplementation(async (payload) => ({
      id: 'loc-2',
      room: payload.room,
      furniture: payload.furniture,
      shelf: payload.shelf,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }))

    renderWithProviders(<LocationsPage />)

    await screen.findByText('Office')

    await userEvent.type(screen.getByPlaceholderText('Room'), 'Living Room')
    await userEvent.type(screen.getByPlaceholderText('Furniture'), 'Cabinet')
    await userEvent.type(screen.getByPlaceholderText('Shelf'), 'Top')
    await userEvent.click(screen.getByRole('button', { name: 'Create location' }))

    expect(await screen.findByText('Living Room')).toBeInTheDocument()
    expect(screen.getByText('Cabinet')).toBeInTheDocument()
    expect(screen.getByText('Top')).toBeInTheDocument()
  })

  it('requires confirmation before deleting a location', async () => {
    vi.mocked(listLocations).mockResolvedValue(baseLocations)
    vi.mocked(deleteLocation).mockResolvedValue()

    renderWithProviders(<LocationsPage />)

    await screen.findByText('Office')
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('dialog', { name: 'delete-location-dialog' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => {
      expect(screen.queryByText('Office')).not.toBeInTheDocument()
    })
  })
})
