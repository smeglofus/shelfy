import { Link, Route, Routes } from 'react-router-dom'

import { ErrorToast } from './components/ErrorToast'
import { ProtectedRoute } from './components/ProtectedRoute'
import { BooksPage } from './pages/BooksPage'
import { HomePage } from './pages/HomePage'
import { LocationsPage } from './pages/LocationsPage'
import { LoginPage } from './pages/LoginPage'

export function App() {
  return (
    <main style={{ fontFamily: 'sans-serif', margin: '2rem auto', maxWidth: 860 }}>
      <h1>Shelfy</h1>
      <nav style={{ display: 'flex', gap: '1rem' }}>
        <Link to="/">Home</Link>
        <Link to="/books">Books</Link>
        <Link to="/locations">Locations</Link>
        <Link to="/login">Login</Link>
      </nav>

      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/books" element={<BooksPage />} />
          <Route path="/locations" element={<LocationsPage />} />
        </Route>
      </Routes>

      <ErrorToast />
    </main>
  )
}
