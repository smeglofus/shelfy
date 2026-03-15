export const ROUTES = {
  home: '/',
  login: '/login',
  books: '/books',
  bookDetail: '/books/:bookId',
  locations: '/locations',
} as const

export function getBookDetailRoute(bookId: string): string {
  return ROUTES.bookDetail.replace(':bookId', bookId)
}
