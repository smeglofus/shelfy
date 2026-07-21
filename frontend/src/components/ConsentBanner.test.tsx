import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/analytics', () => ({ initAnalytics: vi.fn() }))

import { initAnalytics } from '../lib/analytics'
import { ConsentBanner } from './ConsentBanner'

const KEY = 'shelfy_analytics_consent'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

describe('ConsentBanner', () => {
  it('shows when the user has not decided yet', () => {
    render(<ConsentBanner />)
    expect(screen.getByRole('dialog', { name: 'consent.aria_label' })).toBeInTheDocument()
  })

  it('does not show once a choice is already stored', () => {
    localStorage.setItem(KEY, 'granted')
    render(<ConsentBanner />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('accept stores consent, starts analytics, and hides the banner', async () => {
    render(<ConsentBanner />)
    await userEvent.click(screen.getByRole('button', { name: 'consent.accept' }))

    expect(localStorage.getItem(KEY)).toBe('granted')
    expect(initAnalytics).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('decline stores denial, never starts analytics, and hides the banner', async () => {
    render(<ConsentBanner />)
    await userEvent.click(screen.getByRole('button', { name: 'consent.decline' }))

    expect(localStorage.getItem(KEY)).toBe('denied')
    expect(initAnalytics).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
