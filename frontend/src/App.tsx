import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { Toast } from './components/Toast'
import { Navigation } from './components/Navigation'

import { LoginPage, ProtectedRoute } from './features/auth'
import { BooksPage, AddBookPage, BookDetailPage } from './features/books'
import { ScanShelfPage } from './pages/ScanShelfPage'
import { BookshelfViewPage } from './pages/BookshelfViewPage'
import { SettingsPage } from './pages/SettingsPage'

import { ROUTES } from './lib/routes'

export { ROUTES }

function AppShell() {
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
      <Toast />
    </div>
  )
}

export function App() {
  return <AppShell />
}
