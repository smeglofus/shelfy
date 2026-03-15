import { Link, Route, Routes } from 'react-router-dom'

import { ErrorToast } from './components/ErrorToast'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ROUTES } from './lib/routes'
import { BookDetailPage } from './pages/BookDetailPage'
import { BooksPage } from './pages/BooksPage'
import { HomePage } from './pages/HomePage'
import { LocationsPage } from './pages/LocationsPage'
import { LoginPage } from './pages/LoginPage'

export { ROUTES }

export function App() {
  return (
    <main style={{ fontFamily: 'sans-serif', margin: '2rem auto', maxWidth: 860 }}>
      <h1>Shelfy</h1>
      <nav style={{ display: 'flex', gap: '1rem' }}>
        <Link to={ROUTES.home}>Home</Link>
        <Link to={ROUTES.books}>Books</Link>
        <Link to={ROUTES.locations}>Locations</Link>
        <Link to={ROUTES.login}>Login</Link>
      </nav>

      <Routes>
        <Route path={ROUTES.login} element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path={ROUTES.home} element={<HomePage />} />
          <Route path={ROUTES.books} element={<BooksPage />} />
          <Route path={ROUTES.bookDetail} element={<BookDetailPage />} />
          <Route path={ROUTES.locations} element={<LocationsPage />} />
        </Route>
      </Routes>

      <ErrorToast />
    </main>
  )
}
