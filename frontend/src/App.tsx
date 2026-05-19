import { useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRegisterSW } from 'virtual:pwa-register/react'

import { MergeUndoToast } from './components/MergeUndoToast'
import { Toast } from './components/Toast'
import { Navigation } from './components/Navigation'
import { UpgradePrompt } from './components/UpgradePrompt'
import { useToastStore } from './lib/toast-store'
import { useAuth } from './contexts/AuthContext'

import { LoginPage, ProtectedRoute } from './features/auth'
import { BooksPage, AddBookPage, BookDetailPage } from './features/books'
import { ScanShelfPage } from './pages/ScanShelfPage'
import { BookshelfViewPage } from './pages/BookshelfViewPage'
import { PricingPage } from './pages/PricingPage'
import { SettingsPage } from './pages/SettingsPage'
import { BorrowersPage } from './pages/BorrowersPage'
import { BorrowerDetailPage } from './pages/BorrowerDetailPage'
import { LandingPage } from './pages/LandingPage'
import { OAuthCallbackPage } from './pages/OAuthCallbackPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { TermsPage } from './pages/TermsPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { ChangelogPage } from './pages/ChangelogPage'

import { ROUTES } from './lib/routes'

export { ROUTES }

/**
 * Smart home route — drives `/`.
 *
 * Auth truth is whatever ``useAuth()`` says; we never fall back to reading
 * the module-level access-token singleton (that used to cause a blank
 * render whenever the token was set before ``user`` committed — see #125).
 *
 * While auth is bootstrapping OR a login is mid-flight we show an explicit
 * spinner fallback rather than returning ``null``. A silent null render
 * is exactly what the issue report described as "blank until refresh".
 */
function HomeRoute() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div
        data-testid='home-route-loading'
        style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}
      >
        <div className='sh-spinner' aria-label='loading' />
      </div>
    )
  }
  if (isAuthenticated) return <Navigate to={ROUTES.books} replace />
  return <LandingPage />
}

const PUBLIC_PATHS = new Set([
  '/',
  ROUTES.login,
  ROUTES.forgotPassword,
  ROUTES.resetPassword,
  ROUTES.pricing,
  ROUTES.changelog,
  ROUTES.privacy,
  ROUTES.terms,
  ROUTES.oauthCallback,
])

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
          <Route path={ROUTES.forgotPassword} element={<ForgotPasswordPage />} />
          <Route path={ROUTES.resetPassword} element={<ResetPasswordPage />} />
          <Route path={ROUTES.oauthCallback} element={<OAuthCallbackPage />} />
          <Route path={ROUTES.privacy} element={<PrivacyPage />} />
          <Route path={ROUTES.terms} element={<TermsPage />} />
          <Route path={ROUTES.pricing} element={<PricingPage />} />
          <Route path={ROUTES.changelog} element={<ChangelogPage />} />

          {/* ── Protected routes ── */}
          <Route element={<ProtectedRoute />}>
            <Route path={ROUTES.books} element={<BooksPage />} />
            <Route path={ROUTES.addBook} element={<AddBookPage />} />
            <Route path={ROUTES.scanShelf} element={<ScanShelfPage />} />
            <Route path={ROUTES.bookshelfView} element={<BookshelfViewPage />} />
            <Route path={ROUTES.bookDetail} element={<BookDetailPage />} />
            <Route path={ROUTES.locations} element={<Navigate to={`${ROUTES.bookshelfView}?tab=locations`} replace />} />
            <Route path={ROUTES.borrowers} element={<BorrowersPage />} />
            <Route path={ROUTES.borrowerDetail} element={<BorrowerDetailPage />} />
            <Route path={ROUTES.settings} element={<SettingsPage />} />
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
      <MergeUndoToast />
    </div>
  )
}

export function App() {
  return <AppShell />
}
