import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { LandingPage } from './LandingPage'

afterEach(() => {
  cleanup()
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
})
