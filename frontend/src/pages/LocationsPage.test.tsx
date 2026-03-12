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

import { createLocation, deleteLocation, listLocations, updateLocation } from '../lib/api'

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

  it('shows loading state while locations are being fetched', () => {
    vi.mocked(listLocations).mockImplementation(
      () => new Promise<Location[]>(() => undefined),
    )

    renderWithProviders(<LocationsPage />)

    expect(screen.getByText('Loading locations…')).toBeInTheDocument()
  })

  it('shows error state when loading locations fails', async () => {
    vi.mocked(listLocations).mockRejectedValue(new Error('Failed'))

    renderWithProviders(<LocationsPage />)

    expect(await screen.findByText('Failed to load locations.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
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

    await userEvent.type(screen.getByLabelText('Room'), 'Living Room')
    await userEvent.type(screen.getByLabelText('Furniture'), 'Cabinet')
    await userEvent.type(screen.getByLabelText('Shelf'), 'Top')
    await userEvent.click(screen.getByRole('button', { name: 'Create location' }))

    expect(await screen.findByText('Living Room')).toBeInTheDocument()
    expect(screen.getByText('Cabinet')).toBeInTheDocument()
    expect(screen.getByText('Top')).toBeInTheDocument()
  })

  it('updates a location using inline edit form', async () => {
    vi.mocked(listLocations).mockResolvedValue(baseLocations)
    vi.mocked(updateLocation).mockImplementation(async (_id, payload) => ({
      ...baseLocations[0],
      ...payload,
      updated_at: '2024-01-02T00:00:00Z',
    }))

    renderWithProviders(<LocationsPage />)

    await screen.findByText('Office')
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const editRoom = screen.getByLabelText('Edit room')
    await userEvent.clear(editRoom)
    await userEvent.type(editRoom, 'Study')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateLocation).toHaveBeenCalledWith('loc-1', {
        room: 'Study',
        furniture: 'Bookshelf',
        shelf: 'Shelf 1',
      })
    })

    expect(await screen.findByText('Study')).toBeInTheDocument()
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
