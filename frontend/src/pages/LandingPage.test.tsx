import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LandingPage } from './LandingPage'

const trackEventMock = vi.fn()

vi.mock('../lib/analytics', () => ({
  trackEvent: (event: string, props?: Record<string, unknown>) => trackEventMock(event, props),
}))

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  trackEventMock.mockReset()
})

describe('LandingPage conversion sections', () => {
  it('renders pricing teaser, faq, and final cta sections', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('landing.pricing_title')).toBeInTheDocument()
    expect(screen.getByText('landing.faq_title')).toBeInTheDocument()
    expect(screen.getByText('landing.final_cta_title')).toBeInTheDocument()
    expect(screen.getByText('landing.pricing_compare')).toBeInTheDocument()
  })

  it('toggles faq answers via accordion interaction', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    const faqHeading = screen.getByText('landing.faq_title')
    const faqSection = faqHeading.closest('section')
    expect(faqSection).not.toBeNull()
    const faqWithin = within(faqSection as HTMLElement)

    expect(faqWithin.getAllByText('landing.faq_a_1').length).toBeGreaterThan(0)
    const secondQuestion = faqWithin.getByRole('button', { name: 'landing.faq_q_2' })
    expect(secondQuestion).toHaveAttribute('aria-expanded', 'false')

    await user.click(secondQuestion)

    expect(secondQuestion).toHaveAttribute('aria-expanded', 'true')
    expect(faqWithin.getAllByText('landing.faq_a_2').length).toBeGreaterThan(0)
  })

  it('tracks landing view with experiment variant from URL', () => {
    render(
      <MemoryRouter initialEntries={['/?lp_variant=hero_b']}>
        <LandingPage />
      </MemoryRouter>,
    )

    expect(trackEventMock).toHaveBeenCalledWith(
      'lp_view',
      expect.objectContaining({
        variant_id: 'hero_b',
        locale: 'cs',
      }),
    )
  })

  it('tracks hero signup CTA click and signup start event', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    await user.click(screen.getAllByRole('button', { name: 'landing.hero_cta_signup' })[0])

    expect(trackEventMock).toHaveBeenCalledWith(
      'lp_signup_start',
      expect.objectContaining({
        source_section: 'hero',
        cta_label: 'landing.hero_cta_signup',
      }),
    )
    expect(trackEventMock).toHaveBeenCalledWith(
      'lp_hero_cta_click',
      expect.objectContaining({
        section: 'hero',
      }),
    )
  })

  it('tracks faq expand events when closed question is opened', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    const secondQuestion = screen.getByRole('button', { name: 'landing.faq_q_2' })
    await user.click(secondQuestion)

    expect(trackEventMock).toHaveBeenCalledWith(
      'lp_faq_expand',
      expect.objectContaining({
        faq_id: 'faq_2',
        faq_topic: 'landing.faq_q_2',
      }),
    )
  })
})
