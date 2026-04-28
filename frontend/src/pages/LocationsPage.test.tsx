import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
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

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'user-1', email: 'test@example.com' },
    isAuthenticated: true,
    logout: vi.fn(),
  })),
}))

import { createLocation, deleteLocation, listLocations, updateLocation } from '../lib/api'

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
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

    // Loading state shows skeleton rows, not a text node
    expect(screen.queryByText('Office')).not.toBeInTheDocument()
  })

  it('shows error state when loading locations fails', async () => {
    vi.mocked(listLocations).mockRejectedValue(new Error('Failed'))

    renderWithProviders(<LocationsPage />)

    expect(await screen.findByText('locations.error')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'locations.retry' })).toBeInTheDocument()
  })

  it('renders location list with mock data', async () => {
    vi.mocked(listLocations).mockResolvedValue(baseLocations)

    renderWithProviders(<LocationsPage />)

    // Page renders both desktop table and mobile cards — use findAllByText
    expect((await screen.findAllByText('Office')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bookshelf').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Shelf 1').length).toBeGreaterThan(0)
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

    await screen.findAllByText('Office')

    await userEvent.type(screen.getByLabelText('locations.room'), 'Living Room')
    await userEvent.type(screen.getByLabelText('locations.furniture'), 'Cabinet')
    await userEvent.type(screen.getByLabelText('locations.shelf'), 'Top')
    await userEvent.click(screen.getByRole('button', { name: 'locations.create' }))

    expect((await screen.findAllByText('Living Room')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cabinet').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Top').length).toBeGreaterThan(0)
  })

  it('updates a location using inline edit form', async () => {
    vi.mocked(listLocations).mockResolvedValue(baseLocations)
    vi.mocked(updateLocation).mockImplementation(async (_id, payload) => ({
      ...baseLocations[0],
      ...payload,
      updated_at: '2024-01-02T00:00:00Z',
    }))

    renderWithProviders(<LocationsPage />)

    await screen.findAllByText('Office')
    // Click the first edit button (desktop table row)
    await userEvent.click(screen.getAllByRole('button', { name: 'locations.edit' })[0])

    const editRoom = screen.getByLabelText('locations.edit_room')
    await userEvent.clear(editRoom)
    await userEvent.type(editRoom, 'Study')
    await userEvent.click(screen.getAllByRole('button', { name: 'locations.save' })[0])

    await waitFor(() => {
      expect(updateLocation).toHaveBeenCalledWith('loc-1', expect.objectContaining({
        room: 'Study',
        furniture: 'Bookshelf',
        shelf: 'Shelf 1',
      }))
    })

    expect((await screen.findAllByText('Study')).length).toBeGreaterThan(0)
  })

  it('requires confirmation before deleting a location', async () => {
    vi.mocked(listLocations).mockResolvedValue(baseLocations)
    vi.mocked(deleteLocation).mockResolvedValue()

    renderWithProviders(<LocationsPage />)

    await screen.findAllByText('Office')
    await userEvent.click(screen.getAllByRole('button', { name: 'locations.delete' })[0])

    expect(screen.getByRole('dialog', { name: 'locations.delete_title' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'locations.delete_forever' }))

    await waitFor(() => {
      expect(screen.queryAllByText('Office').length).toBe(0)
    })
  })
})
