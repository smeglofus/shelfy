export const ROUTES = {
  login: '/login',
  books: '/books',
  bookDetail: '/books/:bookId',
  addBook: '/books/new',
  scanShelf: '/scan',
  bookshelfView: '/bookshelf',
  locations: '/locations',
  settings: '/settings',
  pricing: '/pricing',
  privacy: '/privacy',
  terms: '/terms',
} as const

export function getBookDetailRoute(bookId: string): string {
  return `/books/${bookId}`
}
