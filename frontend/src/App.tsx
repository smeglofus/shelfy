import { useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRegisterSW } from 'virtual:pwa-register/react'

import { Toast } from './components/Toast'
import { Navigation } from './components/Navigation'
import { UpgradePrompt } from './components/UpgradePrompt'
import { useToastStore } from './lib/toast-store'
import { useAuth } from './contexts/AuthContext'
import { getAccessToken } from './lib/auth'

import { LoginPage, ProtectedRoute } from './features/auth'
import { BooksPage, AddBookPage, BookDetailPage } from './features/books'
import { ScanShelfPage } from './pages/ScanShelfPage'
import { BookshelfViewPage } from './pages/BookshelfViewPage'
import { PricingPage } from './pages/PricingPage'
import { SettingsPage } from './pages/SettingsPage'
import { LandingPage } from './pages/LandingPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { TermsPage } from './pages/TermsPage'

import { ROUTES } from './lib/routes'

export { ROUTES }

/** Smart home route: authenticated → /books, else → Landing page. */
function HomeRoute() {
  const { user } = useAuth()
  const hasToken = !!getAccessToken()

  // Token present but user not yet loaded → still initializing; show nothing.
  if (!user && hasToken) return null
  if (user) return <Navigate to={ROUTES.books} replace />
  return <LandingPage />
}

const PUBLIC_PATHS = new Set(['/', ROUTES.login, ROUTES.privacy, ROUTES.terms])

function AppShell() {
  const { t } = useTranslation()
  const showInfo = useToastStore((s) => s.showInfo)
  const [showReload, setShowReload] = useState(false)
  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh() {
      setShowReload(true)
      showInfo(t('app.update_available'))
    },
    onOfflineReady() {
      showInfo(t('app.offline_ready'))
    },
  })
  const location = useLocation()
  const hideNav = PUBLIC_PATHS.has(location.pathname)

  return (
    <div className='sh-app'>
      <div className={'sh-scroll' + (hideNav ? ' no-nav' : '')}>
        <Routes>
          {/* ── Public routes ── */}
          <Route path='/' element={<HomeRoute />} />
          <Route path={ROUTES.login} element={<LoginPage />} />
          <Route path={ROUTES.privacy} element={<PrivacyPage />} />
          <Route path={ROUTES.terms} element={<TermsPage />} />

          {/* ── Protected routes ── */}
          <Route element={<ProtectedRoute />}>
            <Route path={ROUTES.books} element={<BooksPage />} />
            <Route path={ROUTES.addBook} element={<AddBookPage />} />
            <Route path={ROUTES.scanShelf} element={<ScanShelfPage />} />
            <Route path={ROUTES.bookshelfView} element={<BookshelfViewPage />} />
            <Route path={ROUTES.bookDetail} element={<BookDetailPage />} />
            <Route path={ROUTES.locations} element={<Navigate to={`${ROUTES.bookshelfView}?tab=locations`} replace />} />
            <Route path={ROUTES.settings} element={<SettingsPage />} />
            <Route path={ROUTES.pricing} element={<PricingPage />} />
          </Route>
        </Routes>
      </div>
      {!hideNav && <Navigation />}
      <UpgradePrompt />
      {showReload && (
        <button
          type='button'
          onClick={() => updateServiceWorker(true)}
          style={{
            position: 'fixed',
            bottom: 88,
            right: 16,
            zIndex: 10000,
            background: 'var(--sh-primary)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--sh-radius-pill)',
            padding: '10px 14px',
            boxShadow: 'var(--sh-shadow-lg)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {t('app.update_button')}
        </button>
      )}
      <Toast />
    </div>
  )
}

export function App() {
  return <AppShell />
}
