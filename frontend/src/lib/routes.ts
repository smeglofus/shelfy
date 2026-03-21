export const ROUTES = {
  home: '/',
  login: '/login',
  books: '/books',
  bookDetail: '/books/:bookId',
  addBook: '/books/new',
  locations: '/locations',
} as const

export function getBookDetailRoute(bookId: string): string {
  return `/books/${bookId}`
}
