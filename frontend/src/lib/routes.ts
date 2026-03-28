export const ROUTES = {
  home: '/',
  login: '/login',
  books: '/books',
  bookDetail: '/books/:bookId',
  addBook: '/books/new',
  scanShelf: '/scan',
  bookshelfView: '/bookshelf',
  locations: '/locations',
  settings: '/settings',
} as const

export function getBookDetailRoute(bookId: string): string {
  return `/books/${bookId}`
}
