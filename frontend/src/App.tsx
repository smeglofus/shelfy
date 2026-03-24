import { Route, Routes, useLocation } from 'react-router-dom'

// Shared components
import { ErrorToast } from './components/ErrorToast'
import { BottomNav } from './components/BottomNav'

// Feature barrels
import { LoginPage, ProtectedRoute } from './features/auth'
import { HomePage } from './pages/HomePage'
import { BooksPage, AddBookPage, BookDetailPage } from './features/books'
import { LocationsPage } from './features/locations'

import { ROUTES } from './lib/routes'

export { ROUTES }

function AppShell() {
  const location = useLocation()
  const hideNav = location.pathname === ROUTES.login

  return (
    <div className="sh-app">
      <div className={`sh-scroll${hideNav ? ' no-nav' : ''}`}>
        <Routes>
          <Route path={ROUTES.login} element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path={ROUTES.home}       element={<HomePage />} />
            <Route path={ROUTES.books}      element={<BooksPage />} />
            <Route path={ROUTES.addBook}    element={<AddBookPage />} />
            <Route path={ROUTES.bookDetail} element={<BookDetailPage />} />
            <Route path={ROUTES.locations}  element={<LocationsPage />} />
          </Route>
        </Routes>
      </div>
      {!hideNav && <BottomNav />}
      <ErrorToast />
    </div>
  )
}

export function App() {
  return <AppShell />
}
