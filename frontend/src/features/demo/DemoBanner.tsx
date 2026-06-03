/**
 * DemoBanner — the persistent chrome shown across every `/demo/*` page (#285).
 *
 * It replaces the authenticated `Navigation` for demo visitors, makes the
 * sandbox nature explicit ("changes reset when you leave"), and offers the
 * primary conversion path (sign up) plus an exit back to the landing page.
 *
 * #287 adds the conversion funnel: the signup CTA emits `demo_signup_click`,
 * and once the visitor shows real intent (see {@link shouldShowDemoNudge}) a
 * non-blocking nudge invites them to sign up to keep their library.
 */
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { ROUTES } from '../../lib/routes'
import { trackDemoSignupClick } from '../../lib/demoAnalytics'
import { shouldShowDemoNudge, useDemoActivity } from './useDemoActivity'

export function DemoBanner() {
  const { t } = useTranslation()
  const activity = useDemoActivity()
  const showNudge = shouldShowDemoNudge(activity)

  return (
    <>
      <div className='sh-demo-banner' role='region' aria-label={t('demo.badge')}>
        <span className='sh-demo-banner__badge'>{t('demo.badge')}</span>
        <span className='sh-demo-banner__text'>{t('demo.banner_text')}</span>
        <span className='sh-demo-banner__actions'>
          <Link className='sh-demo-banner__exit' to='/'>
            {t('demo.exit')}
          </Link>
          <Link
            className='sh-demo-banner__cta'
            to={ROUTES.login}
            onClick={() => trackDemoSignupClick('banner')}
          >
            {t('demo.cta_signup')}
          </Link>
        </span>
      </div>

      {showNudge && (
        <div className='sh-demo-nudge' role='status' data-testid='demo-nudge'>
          <span className='sh-demo-nudge__text'>{t('demo.nudge_text')}</span>
          <span className='sh-demo-nudge__actions'>
            <Link
              className='sh-demo-nudge__cta'
              to={ROUTES.login}
              onClick={() => trackDemoSignupClick('nudge')}
            >
              {t('demo.nudge_cta')}
            </Link>
            <button
              type='button'
              className='sh-demo-nudge__dismiss'
              aria-label={t('demo.nudge_dismiss')}
              onClick={() => useDemoActivity.getState().dismissNudge()}
            >
              ✕
            </button>
          </span>
        </div>
      )}
    </>
  )
}
