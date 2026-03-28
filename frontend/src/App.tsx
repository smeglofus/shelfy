import { Route, Routes, useLocation } from 'react-router-dom'

import { ErrorToast } from './components/ErrorToast'
import { Navigation } from './components/Navigation'

import { LoginPage, ProtectedRoute } from './features/auth'
import { HomePage } from './pages/HomePage'
import { BooksPage, AddBookPage, BookDetailPage } from './features/books'
import { ScanShelfPage } from './pages/ScanShelfPage'
import { BookshelfViewPage } from './pages/BookshelfViewPage'
import { LocationsPage } from './features/locations'
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
            <Route path={ROUTES.home} element={<HomePage />} />
            <Route path={ROUTES.books} element={<BooksPage />} />
            <Route path={ROUTES.addBook} element={<AddBookPage />} />
            <Route path={ROUTES.scanShelf} element={<ScanShelfPage />} />
            <Route path={ROUTES.bookshelfView} element={<BookshelfViewPage />} />
            <Route path={ROUTES.bookDetail} element={<BookDetailPage />} />
            <Route path={ROUTES.locations} element={<LocationsPage />} />
            <Route path={ROUTES.settings} element={<SettingsPage />} />
          </Route>
        </Routes>
      </div>
      {!hideNav && <Navigation />}
      <ErrorToast />
    </div>
  )
}

export function App() {
  return <AppShell />
}
