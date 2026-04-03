import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsPage } from './SettingsPage'

// ── Mock API ────────────────────────────────────────────────────────────────

vi.mock('../lib/api', () => ({
  formatApiError: vi.fn((e: unknown) => String(e)),
  exportBooksCsv: vi.fn(),
  purgeLibrary: vi.fn(),
  listLibraries: vi.fn(),
  listLibraryMembers: vi.fn(),
  addLibraryMember: vi.fn(),
  updateLibraryMember: vi.fn(),
  removeLibraryMember: vi.fn(),
  getOnboardingStatus: vi.fn(),
  completeOnboarding: vi.fn(),
  skipOnboarding: vi.fn(),
  resetOnboarding: vi.fn(),
  enrichAll: vi.fn(),
  ACTIVE_LIBRARY_ID_KEY: 'shelfy.activeLibraryId',
  getActiveLibraryId: vi.fn(() => null),
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'user-owner', email: 'owner@example.com' },
    logout: vi.fn(),
  })),
}))

vi.mock('../store/useSettingsStore', () => ({
  useSettingsStore: vi.fn((selector: (s: { darkMode: boolean; setDarkMode: () => void }) => unknown) =>
    selector({ darkMode: false, setDarkMode: vi.fn() }),
  ),
}))

const mockSetActiveLibraryId = vi.fn()
vi.mock('../store/useLibraryStore', () => ({
  useLibraryStore: vi.fn((selector: (s: { activeLibraryId: string | null; setActiveLibraryId: (id: string | null) => void }) => unknown) =>
    selector({ activeLibraryId: 'lib-1', setActiveLibraryId: mockSetActiveLibraryId }),
  ),
}))

import {
  addLibraryMember,
  listLibraries,
  listLibraryMembers,
  removeLibraryMember,
  updateLibraryMember,
} from '../lib/api'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LIBRARIES = [
  { id: 'lib-1', name: 'Home Library', role: 'owner' as const },
  { id: 'lib-2', name: 'Work Library', role: 'viewer' as const },
]

const MEMBERS = [
  { user_id: 'user-owner', email: 'owner@example.com', role: 'owner' as const },
  { user_id: 'user-editor', email: 'editor@example.com', role: 'editor' as const },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function renderWithProviders(ui: ReactNode) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SettingsPage – library management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listLibraries).mockResolvedValue(LIBRARIES)
    vi.mocked(listLibraryMembers).mockResolvedValue(MEMBERS)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the library title and description', async () => {
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('library.title')).toBeInTheDocument()
    expect(screen.getByText('library.description')).toBeInTheDocument()
  })

  it('shows list of libraries after loading', async () => {
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('Home Library')).toBeInTheDocument()
    expect(screen.getByText('Work Library')).toBeInTheDocument()
  })

  it('shows a switch button for inactive libraries', async () => {
    renderWithProviders(<SettingsPage />)
    // lib-1 is active (no switch button), lib-2 is inactive (has switch button)
    const switchButtons = await screen.findAllByText('library.switch')
    expect(switchButtons).toHaveLength(1)
  })

  it('calls setActiveLibraryId when switch is clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)
    const switchBtn = await screen.findByText('library.switch')
    await user.click(switchBtn)
    expect(mockSetActiveLibraryId).toHaveBeenCalledWith('lib-2')
  })

  it('shows members of the active library', async () => {
    renderWithProviders(<SettingsPage />)
    // Wait for editor@example.com (only in members list, not in profile)
    expect(await screen.findByText('editor@example.com')).toBeInTheDocument()
    // owner@example.com appears in both profile and members list
    const ownerEmails = screen.getAllByText('owner@example.com')
    expect(ownerEmails.length).toBeGreaterThanOrEqual(2)
  })

  it('shows role selects for each member when current user is owner', async () => {
    renderWithProviders(<SettingsPage />)
    await screen.findByText('editor@example.com')
    const selects = screen.getAllByRole('combobox')
    // At least two role selects for existing members + one for new-member-role
    expect(selects.length).toBeGreaterThanOrEqual(2)
  })

  it('shows add-member form for owner', async () => {
    renderWithProviders(<SettingsPage />)
    await screen.findByText('editor@example.com')
    expect(screen.getByRole('form', { name: 'add-member-form' })).toBeInTheDocument()
    expect(screen.getByLabelText('new-member-email')).toBeInTheDocument()
    expect(screen.getByLabelText('new-member-role')).toBeInTheDocument()
  })

  it('submits add-member form with correct payload', async () => {
    vi.mocked(addLibraryMember).mockResolvedValue({
      user_id: 'user-new',
      email: 'new@example.com',
      role: 'viewer',
    })
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)
    await screen.findByLabelText('new-member-email')

    await user.type(screen.getByLabelText('new-member-email'), 'new@example.com')
    await user.selectOptions(screen.getByLabelText('new-member-role'), 'editor')
    await user.click(screen.getByText('library.add_button'))

    await waitFor(() => {
      expect(addLibraryMember).toHaveBeenCalledWith('lib-1', {
        email: 'new@example.com',
        role: 'editor',
      })
    })
  })

  it('calls addLibraryMember even when it returns 404', async () => {
    vi.mocked(addLibraryMember).mockRejectedValue({ response: { status: 404 } })
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)
    await screen.findByLabelText('new-member-email')

    await user.type(screen.getByLabelText('new-member-email'), 'nobody@example.com')
    await user.click(screen.getByText('library.add_button'))

    await waitFor(() => {
      expect(addLibraryMember).toHaveBeenCalledWith('lib-1', {
        email: 'nobody@example.com',
        role: 'viewer',
      })
    })
  })

  it('calls addLibraryMember even when it returns 403', async () => {
    vi.mocked(addLibraryMember).mockRejectedValue({ response: { status: 403 } })
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)
    await screen.findByLabelText('new-member-email')

    await user.type(screen.getByLabelText('new-member-email'), 'x@example.com')
    await user.click(screen.getByText('library.add_button'))

    await waitFor(() => {
      expect(addLibraryMember).toHaveBeenCalled()
    })
  })

  it('calls updateLibraryMember when role select changes', async () => {
    vi.mocked(updateLibraryMember).mockResolvedValue({
      user_id: 'user-editor',
      email: 'editor@example.com',
      role: 'viewer',
    })
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)
    await screen.findByText('editor@example.com')

    const roleSelect = screen.getByLabelText('role-select-user-editor')
    await user.selectOptions(roleSelect, 'viewer')

    await waitFor(() => {
      expect(updateLibraryMember).toHaveBeenCalledWith('lib-1', 'user-editor', { role: 'viewer' })
    })
  })

  it('calls removeLibraryMember after confirming remove', async () => {
    vi.mocked(removeLibraryMember).mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)
    await screen.findByText('editor@example.com')

    const removeBtn = screen.getByLabelText('remove-user-editor')
    await user.click(removeBtn)

    await waitFor(() => {
      expect(removeLibraryMember).toHaveBeenCalledWith('lib-1', 'user-editor')
    })
  })

  it('does not call removeLibraryMember when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)
    await screen.findByText('editor@example.com')

    const removeBtn = screen.getByLabelText('remove-user-editor')
    await user.click(removeBtn)

    await waitFor(() => {
      expect(removeLibraryMember).not.toHaveBeenCalled()
    })
  })

  it('shows read-only role badge for non-owner user', async () => {
    // Change active library to lib-2 (viewer role) for this test
    const { useLibraryStore } = await import('../store/useLibraryStore')
    vi.mocked(useLibraryStore).mockImplementation(
      (selector: (s: { activeLibraryId: string | null; setActiveLibraryId: (id: string | null) => void }) => unknown) =>
        selector({ activeLibraryId: 'lib-2', setActiveLibraryId: vi.fn() }),
    )

    // Members for lib-2 — current user is a viewer
    vi.mocked(listLibraryMembers).mockResolvedValue([
      { user_id: 'user-other', email: 'owner2@example.com', role: 'owner' as const },
      { user_id: 'user-owner', email: 'owner@example.com', role: 'viewer' as const },
    ])

    renderWithProviders(<SettingsPage />)
    // Wait for the member that's only in the members list
    await screen.findByText('owner2@example.com')

    // No add-member form for viewers
    expect(screen.queryByRole('form', { name: 'add-member-form' })).not.toBeInTheDocument()
    // No comboboxes (role selects) for non-owners
    expect(screen.queryByLabelText('role-select-user-other')).not.toBeInTheDocument()
  })
})
