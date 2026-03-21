import { Route, Routes, useLocation } from 'react-router-dom'
import { ErrorToast } from './components/ErrorToast'
import { ProtectedRoute } from './components/ProtectedRoute'
import { BottomNav } from './components/BottomNav'
import { ROUTES } from './lib/routes'
import { BookDetailPage } from './pages/BookDetailPage'
import { BooksPage } from './pages/BooksPage'
import { HomePage } from './pages/HomePage'
import { LocationsPage } from './pages/LocationsPage'
import { LoginPage } from './pages/LoginPage'
import { AddBookPage } from './pages/AddBookPage'

export { ROUTES }

function AppShell() {
  const location = useLocation()
  const hideNav = location.pathname === ROUTES.login

  return (
    <div style={{
      maxWidth: 480,
      margin: '0 auto',
      minHeight: '100dvh',
      background: 'white',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: hideNav ? 0 : 80 }}>
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
