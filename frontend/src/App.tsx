import { useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useRegisterSW } from 'virtual:pwa-register/react'

import { Toast } from './components/Toast'
import { Navigation } from './components/Navigation'
import { useToastStore } from './lib/toast-store'

import { LoginPage, ProtectedRoute } from './features/auth'
import { BooksPage, AddBookPage, BookDetailPage } from './features/books'
import { ScanShelfPage } from './pages/ScanShelfPage'
import { BookshelfViewPage } from './pages/BookshelfViewPage'
import { SettingsPage } from './pages/SettingsPage'

import { ROUTES } from './lib/routes'

export { ROUTES }

function AppShell() {
  const showInfo = useToastStore((s) => s.showInfo)
  const [showReload, setShowReload] = useState(false)
  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh() {
      setShowReload(true)
      showInfo('Je dostupná nová verze Shelfy — klikni pro aktualizaci.')
    },
    onOfflineReady() {
      showInfo('Shelfy je připravené i offline.')
    },
  })
  const location = useLocation()
  const hideNav = location.pathname === ROUTES.login

  return (
    <div className='sh-app'>
      <div className={'sh-scroll' + (hideNav ? ' no-nav' : '')}>
        <Routes>
          <Route path={ROUTES.login} element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Navigate to={ROUTES.books} replace />} />
            <Route path={ROUTES.books} element={<BooksPage />} />
            <Route path={ROUTES.addBook} element={<AddBookPage />} />
            <Route path={ROUTES.scanShelf} element={<ScanShelfPage />} />
            <Route path={ROUTES.bookshelfView} element={<BookshelfViewPage />} />
            <Route path={ROUTES.bookDetail} element={<BookDetailPage />} />
            <Route path={ROUTES.locations} element={<Navigate to={`${ROUTES.bookshelfView}?tab=locations`} replace />} />
            <Route path={ROUTES.settings} element={<SettingsPage />} />
          </Route>
        </Routes>
      </div>
      {!hideNav && <Navigation />}
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
          Aktualizovat aplikaci
        </button>
      )}
      <Toast />
    </div>
  )
}

export function App() {
  return <AppShell />
}
