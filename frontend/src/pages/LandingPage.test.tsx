import { cleanup, render, screen } from '@testing-library/react'
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

describe('LandingPage', () => {
  it('renders all sections', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('landing.hero_title')).toBeInTheDocument()
    expect(screen.getByText('landing.how_title')).toBeInTheDocument()
    expect(screen.getByText('landing.visual_proof_title')).toBeInTheDocument()
    expect(screen.getByText('landing.pricing_teaser_title')).toBeInTheDocument()
    expect(screen.getByText('landing.faq_title')).toBeInTheDocument()
    expect(screen.getByText('landing.final_cta_title')).toBeInTheDocument()
  })

  it('renders visual proof block with poster image', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    const section = screen.getByTestId('visual-proof')
    expect(section).toBeInTheDocument()
    const poster = section.querySelector('img[src="/landing/demo-poster.webp"]')
    expect(poster).toBeInTheDocument()
  })

  it('renders 3 flow steps in visual proof', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('landing.visual_proof_step1_title')).toBeInTheDocument()
    expect(screen.getByText('landing.visual_proof_step2_title')).toBeInTheDocument()
    expect(screen.getByText('landing.visual_proof_step3_title')).toBeInTheDocument()
  })

  it('shows demo fallback when no video URL is configured', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    expect(screen.getByText(/landing\.visual_proof_demo_coming/)).toBeInTheDocument()
  })

  it('renders FAQ section with 5 questions', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    const faqSection = screen.getByTestId('faq')
    expect(faqSection).toBeInTheDocument()
    expect(screen.getByText('landing.faq_1_q')).toBeInTheDocument()
    expect(screen.getByText('landing.faq_5_q')).toBeInTheDocument()
  })

  it('expands FAQ answer on click and tracks event', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    const firstQuestion = screen.getByText('landing.faq_1_q')
    await user.click(firstQuestion.closest('button')!)

    expect(trackEventMock).toHaveBeenCalledWith(
      'lp_faq_expand',
      expect.objectContaining({
        faq_id: 'scanning',
        faq_topic: 'how_scanning_works',
      }),
    )
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

    await user.click(screen.getByRole('button', { name: 'landing.hero_cta_signup' }))

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

  it('tracks pricing teaser click', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'landing.pricing_teaser_cta' }))

    expect(trackEventMock).toHaveBeenCalledWith(
      'lp_pricing_teaser_click',
      expect.objectContaining({
        cta_label: 'landing.pricing_teaser_cta',
      }),
    )
  })
})
