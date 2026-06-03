/**
 * DemoBanner (#287) — signup analytics + conversion nudge behaviour.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const trackDemoSignupClick = vi.fn()
vi.mock('../../lib/demoAnalytics', () => ({
  trackDemoSignupClick: (...args: unknown[]) => trackDemoSignupClick(...args),
}))

import { DemoBanner } from './DemoBanner'
import { useDemoActivity } from './useDemoActivity'

function renderBanner() {
  return render(
    <MemoryRouter>
      <DemoBanner />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useDemoActivity.getState().reset()
  trackDemoSignupClick.mockClear()
})

afterEach(() => {
  cleanup()
  useDemoActivity.getState().reset()
})

describe('DemoBanner', () => {
  it('tracks the banner signup CTA', () => {
    renderBanner()
    fireEvent.click(screen.getByText('demo.cta_signup'))
    expect(trackDemoSignupClick).toHaveBeenCalledWith('banner')
  })

  it('hides the nudge until the visitor shows intent', () => {
    renderBanner()
    expect(screen.queryByTestId('demo-nudge')).not.toBeInTheDocument()
  })

  it('shows the nudge after a completed scan and tracks its signup CTA', () => {
    useDemoActivity.getState().recordScan()
    renderBanner()
    expect(screen.getByTestId('demo-nudge')).toBeInTheDocument()
    fireEvent.click(screen.getByText('demo.nudge_cta'))
    expect(trackDemoSignupClick).toHaveBeenCalledWith('nudge')
  })

  it('dismissing the nudge hides it', () => {
    useDemoActivity.getState().recordSearch()
    useDemoActivity.getState().recordAdd()
    renderBanner()
    expect(screen.getByTestId('demo-nudge')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('demo.nudge_dismiss'))
    expect(screen.queryByTestId('demo-nudge')).not.toBeInTheDocument()
  })
})
