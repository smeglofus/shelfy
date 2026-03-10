import { Link, Route, Routes } from 'react-router-dom'

import { BooksPage } from './pages/BooksPage'
import { HomePage } from './pages/HomePage'
import { LocationsPage } from './pages/LocationsPage'

export function App() {
  return (
    <main style={{ fontFamily: 'sans-serif', margin: '2rem auto', maxWidth: 860 }}>
      <h1>Shelfy</h1>
      <p>Project skeleton is running.</p>
      <nav style={{ display: 'flex', gap: '1rem' }}>
        <Link to="/">Home</Link>
        <Link to="/books">Books</Link>
        <Link to="/locations">Locations</Link>
      </nav>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/books" element={<BooksPage />} />
        <Route path="/locations" element={<LocationsPage />} />
      </Routes>
    </main>
  )
}
