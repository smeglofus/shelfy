import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsPage } from './SettingsPage'

// ── Mock API ────────────────────────────────────────────────────────────────

vi.mock('../lib/api', () => ({
  formatApiError: vi.fn((e: unknown) => String(e)),
  exportBooksCsv: vi.fn(),
  exportUserData: vi.fn(),
  deleteAccount: vi.fn(),
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
  getBillingStatus: vi.fn(() => Promise.resolve({
    plan: 'free',
    usage: { scans_used: 0, scans_limit: 10, enrichments_used: 0, enrichments_limit: 50 },
    current_period_end: null,
  })),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  ACTIVE_LIBRARY_ID_KEY: 'shelfy.activeLibraryId',
  getActiveLibraryId: vi.fn(() => null),
  updateLibrary: vi.fn(),
  listWishlist: vi.fn(),
  createWishlistItem: vi.fn(),
  deleteWishlistItem: vi.fn(),
  createLibrary: vi.fn(),
}))

const mockLogout = vi.fn()

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'user-owner', email: 'owner@example.com' },
    logout: mockLogout,
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
import { useAuth } from '../contexts/AuthContext'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LIBRARIES = [
  { id: 'lib-1', name: 'Home Library', role: 'owner' as const, wishlist_enabled: true },
  { id: 'lib-2', name: 'Work Library', role: 'viewer' as const, wishlist_enabled: true },
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

function resetAuthMock(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'user-owner', email: 'owner@example.com', ...overrides },
    logout: mockLogout,
    // Only user and logout are consumed by SettingsPage
  } as unknown as ReturnType<typeof useAuth>)
}

// ── Tests: page structure ────────────────────────────────────────────────────

describe('SettingsPage – page structure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAuthMock()
    vi.mocked(listLibraries).mockResolvedValue(LIBRARIES)
    vi.mocked(listLibraryMembers).mockResolvedValue(MEMBERS)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders all core sections', async () => {
    renderWithProviders(<SettingsPage />)

    expect(screen.getByTestId('section-preferences')).toBeInTheDocument()
    expect(screen.getByTestId('section-account')).toBeInTheDocument()
    expect(screen.getByTestId('section-data')).toBeInTheDocument()
    expect(screen.getByTestId('section-about')).toBeInTheDocument()
    expect(screen.getByTestId('section-danger')).toBeInTheDocument()
  })

  it('renders section headings with correct text', () => {
    renderWithProviders(<SettingsPage />)

    expect(screen.getByText('settings.preferences_title')).toBeInTheDocument()
    expect(screen.getByText('settings.profile_title')).toBeInTheDocument()
    expect(screen.getByText('settings.data_title')).toBeInTheDocument()
    expect(screen.getByText('settings.about_title')).toBeInTheDocument()
    expect(screen.getByText('settings.danger_title')).toBeInTheDocument()
  })

  it('danger zone is the last section on the page', () => {
    renderWithProviders(<SettingsPage />)

    const sections = document.querySelectorAll('[data-testid^="section-"]')
    const last = sections[sections.length - 1]
    expect(last.getAttribute('data-testid')).toBe('section-danger')
  })

  it('shows user email in the account section', () => {
    renderWithProviders(<SettingsPage />)

    const accountSection = screen.getByTestId('section-account')
    expect(within(accountSection).getByText('owner@example.com')).toBeInTheDocument()
  })

  it('shows dark mode toggle in preferences section', () => {
    renderWithProviders(<SettingsPage />)

    const prefs = screen.getByTestId('section-preferences')
    expect(within(prefs).getByLabelText('dark-mode-toggle')).toBeInTheDocument()
  })

  it('shows language selector with two options', () => {
    renderWithProviders(<SettingsPage />)

    const prefs = screen.getByTestId('section-preferences')
    expect(within(prefs).getByText('settings.language_cs')).toBeInTheDocument()
    expect(within(prefs).getByText('settings.language_en')).toBeInTheDocument()
  })
})

// ── Tests: danger zone ──────────────────────────────────────────────────────

describe('SettingsPage – danger zone (OAuth user)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAuthMock({ has_local_password: false })
    vi.mocked(listLibraries).mockResolvedValue(LIBRARIES)
    vi.mocked(listLibraryMembers).mockResolvedValue(MEMBERS)
  })

  afterEach(() => {
    cleanup()
  })

  it('shows text confirmation input for purge', () => {
    renderWithProviders(<SettingsPage />)

    const danger = screen.getByTestId('section-danger')
    const input = within(danger).getAllByPlaceholderText('settings.type_delete_to_confirm')[0]
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('type', 'text')
  })

  it('purge button is disabled until DELETE is typed', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)

    const danger = screen.getByTestId('section-danger')
    const purgeBtn = within(danger).getByText('settings.purge_button')
    expect(purgeBtn).toBeDisabled()

    const input = within(danger).getAllByPlaceholderText('settings.type_delete_to_confirm')[0]
    await user.type(input, 'DELETE')

    expect(purgeBtn).toBeEnabled()
  })

  it('delete account expand shows text confirmation', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)

    await user.click(screen.getByText('settings.delete_account_button'))

    const danger = screen.getByTestId('section-danger')
    const inputs = within(danger).getAllByPlaceholderText('settings.type_delete_to_confirm')
    // One for purge, one for delete account
    expect(inputs.length).toBe(2)
    expect(inputs[1]).toHaveAttribute('type', 'text')
  })

  it('delete account confirm button is disabled until DELETE is typed', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)

    await user.click(screen.getByText('settings.delete_account_button'))

    const confirmBtn = screen.getByText('settings.delete_account_confirm')
    expect(confirmBtn).toBeDisabled()

    const danger = screen.getByTestId('section-danger')
    const inputs = within(danger).getAllByPlaceholderText('settings.type_delete_to_confirm')
    await user.type(inputs[1], 'DELETE')

    expect(confirmBtn).toBeEnabled()
  })
})

describe('SettingsPage – danger zone (local password user)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAuthMock({ has_local_password: true })
    vi.mocked(listLibraries).mockResolvedValue(LIBRARIES)
    vi.mocked(listLibraryMembers).mockResolvedValue(MEMBERS)
  })

  afterEach(() => {
    cleanup()
  })

  it('shows password confirmation input for purge', () => {
    renderWithProviders(<SettingsPage />)

    const danger = screen.getByTestId('section-danger')
    const input = within(danger).getByPlaceholderText('settings.confirm_password')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('type', 'password')
  })

  it('purge button is disabled until password is entered', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)

    const danger = screen.getByTestId('section-danger')
    const purgeBtn = within(danger).getByText('settings.purge_button')
    expect(purgeBtn).toBeDisabled()

    const input = within(danger).getByPlaceholderText('settings.confirm_password')
    await user.type(input, 'mypassword')

    expect(purgeBtn).toBeEnabled()
  })

  it('delete account expand shows password confirmation', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)

    await user.click(screen.getByText('settings.delete_account_button'))

    const danger = screen.getByTestId('section-danger')
    const inputs = within(danger).getAllByPlaceholderText('settings.confirm_password')
    // One for purge, one for delete account
    expect(inputs.length).toBe(2)
    expect(inputs[1]).toHaveAttribute('type', 'password')
  })
})

// ── Tests: library management ────────────────────────────────────────────────

describe('SettingsPage – library management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAuthMock()
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
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)
    await screen.findByText('editor@example.com')

    const removeBtn = screen.getByLabelText('remove-user-editor')
    await user.click(removeBtn)

    // Modal should appear
    expect(screen.getByRole('dialog', { name: 'library.remove_title' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'library.remove' }))

    await waitFor(() => {
      expect(removeLibraryMember).toHaveBeenCalledWith('lib-1', 'user-editor')
    })
  })

  it('does not call removeLibraryMember when confirm is cancelled', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)
    await screen.findByText('editor@example.com')

    const removeBtn = screen.getByLabelText('remove-user-editor')
    await user.click(removeBtn)

    expect(screen.getByRole('dialog', { name: 'library.remove_title' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(removeLibraryMember).not.toHaveBeenCalled()
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

// ── Tests: wishlist toggle (#309) ────────────────────────────────────────────

describe('SettingsPage – wishlist toggle (#309)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetAuthMock()
    // Earlier describes swap the store to lib-2 via mockImplementation, which
    // clearAllMocks does NOT undo — pin the active library back to lib-1.
    const { useLibraryStore } = await import('../store/useLibraryStore')
    vi.mocked(useLibraryStore).mockImplementation(
      (selector: (s: { activeLibraryId: string | null; setActiveLibraryId: (id: string | null) => void }) => unknown) =>
        selector({ activeLibraryId: 'lib-1', setActiveLibraryId: mockSetActiveLibraryId }),
    )
    vi.mocked(listLibraries).mockResolvedValue(LIBRARIES)
    vi.mocked(listLibraryMembers).mockResolvedValue(MEMBERS)
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the toggle to the owner, reflecting wishlist_enabled', async () => {
    renderWithProviders(<SettingsPage />)
    const row = await screen.findByTestId('wishlist-toggle-row')
    const checkbox = within(row).getByRole('checkbox')
    expect(checkbox).toBeChecked()
  })

  it('calls updateLibrary when the owner flips the toggle', async () => {
    const { updateLibrary } = await import('../lib/api')
    vi.mocked(updateLibrary).mockResolvedValue({
      id: 'lib-1', name: 'Home Library', role: 'owner', wishlist_enabled: false,
    })
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)

    const row = await screen.findByTestId('wishlist-toggle-row')
    await user.click(within(row).getByRole('checkbox'))

    await waitFor(() => {
      expect(updateLibrary).toHaveBeenCalledWith('lib-1', { wishlist_enabled: false })
    })
  })

  it('hides the toggle from non-owners', async () => {
    // Active library is lib-1 but the caller is only a viewer there.
    vi.mocked(listLibraries).mockResolvedValue([
      { id: 'lib-1', name: 'Home Library', role: 'viewer', wishlist_enabled: true },
    ])
    renderWithProviders(<SettingsPage />)
    await screen.findByText('Home Library')
    expect(screen.queryByTestId('wishlist-toggle-row')).not.toBeInTheDocument()
  })
})

// ── Tests: create library ────────────────────────────────────────────────────

describe('SettingsPage – create library', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetAuthMock()
    const { useLibraryStore } = await import('../store/useLibraryStore')
    vi.mocked(useLibraryStore).mockImplementation(
      (selector: (s: { activeLibraryId: string | null; setActiveLibraryId: (id: string | null) => void }) => unknown) =>
        selector({ activeLibraryId: 'lib-1', setActiveLibraryId: mockSetActiveLibraryId }),
    )
    vi.mocked(listLibraries).mockResolvedValue(LIBRARIES)
    vi.mocked(listLibraryMembers).mockResolvedValue(MEMBERS)
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the button and expands into the form', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)

    const button = await screen.findByTestId('create-library-button')
    await user.click(button)

    expect(screen.getByTestId('create-library-form')).toBeInTheDocument()
    expect(screen.getByLabelText('new-library-name')).toBeInTheDocument()
  })

  it('creates the library and switches to it as active', async () => {
    const { createLibrary } = await import('../lib/api')
    vi.mocked(createLibrary).mockResolvedValue({
      id: 'lib-new', name: 'Chata', role: 'owner', wishlist_enabled: true,
    })
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)

    await user.click(await screen.findByTestId('create-library-button'))
    await user.type(screen.getByLabelText('new-library-name'), 'Chata')
    await user.click(screen.getByTestId('create-library-submit'))

    await waitFor(() => {
      expect(createLibrary).toHaveBeenCalledWith({ name: 'Chata' })
    })
    await waitFor(() => {
      expect(mockSetActiveLibraryId).toHaveBeenCalledWith('lib-new')
    })
    // Form collapses back to the button.
    await waitFor(() => {
      expect(screen.queryByTestId('create-library-form')).not.toBeInTheDocument()
    })
  })

  it('does not switch libraries when the plan limit rejects the create (403)', async () => {
    const { createLibrary } = await import('../lib/api')
    vi.mocked(createLibrary).mockRejectedValue({ response: { status: 403 } })
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)

    await user.click(await screen.findByTestId('create-library-button'))
    await user.type(screen.getByLabelText('new-library-name'), 'Čtvrtá knihovna')
    await user.click(screen.getByTestId('create-library-submit'))

    await waitFor(() => {
      expect(createLibrary).toHaveBeenCalled()
    })
    expect(mockSetActiveLibraryId).not.toHaveBeenCalled()
    // Form stays open so the user can rename / retry after upgrading.
    expect(screen.getByTestId('create-library-form')).toBeInTheDocument()
  })
})
