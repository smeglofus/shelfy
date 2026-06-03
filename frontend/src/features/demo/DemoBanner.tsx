/**
 * DemoBanner — the persistent chrome shown across every `/demo/*` page (#285).
 *
 * It replaces the authenticated `Navigation` for demo visitors, makes the
 * sandbox nature explicit ("changes reset when you leave"), and offers the
 * primary conversion path (sign up) plus an exit back to the landing page.
 *
 * Conversion analytics for these CTAs are wired in #287; the markup/hooks here
 * intentionally stay minimal so that work can slot in without restructuring.
 */
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { ROUTES } from '../../lib/routes'

export function DemoBanner() {
  const { t } = useTranslation()

  return (
    <div className='sh-demo-banner' role='region' aria-label={t('demo.badge')}>
      <span className='sh-demo-banner__badge'>{t('demo.badge')}</span>
      <span className='sh-demo-banner__text'>{t('demo.banner_text')}</span>
      <span className='sh-demo-banner__actions'>
        <Link className='sh-demo-banner__exit' to='/'>
          {t('demo.exit')}
        </Link>
        <Link className='sh-demo-banner__cta' to={ROUTES.login}>
          {t('demo.cta_signup')}
        </Link>
      </span>
    </div>
  )
}
