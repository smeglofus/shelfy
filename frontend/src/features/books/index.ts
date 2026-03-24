// Feature barrel – Books
// Pages (keep co-located with tests in src/pages/)
export { BooksPage } from '../../pages/BooksPage'
export { AddBookPage } from '../../pages/AddBookPage'
export { BookDetailPage } from '../../pages/BookDetailPage'

// Hooks
export {
  useBooks,
  useBook,
  useCreateBook,
  useUpdateBook,
  useDeleteBook,
  useUploadBookImage,
  useJobStatus,
  BOOKS_QUERY_KEY,
} from './hooks'

// Components
export { BookCard } from '../../components/BookCard'
