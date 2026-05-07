export const ROUTES = {
  login: '/login',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  books: '/books',
  bookDetail: '/books/:bookId',
  addBook: '/books/new',
  scanShelf: '/scan',
  bookshelfView: '/bookshelf',
  locations: '/locations',
  borrowers: '/borrowers',
  borrowerDetail: '/borrowers/:borrowerId',
  settings: '/settings',
  pricing: '/pricing',
  changelog: '/changelog',
  privacy: '/privacy',
  terms: '/terms',
  oauthCallback: '/auth/callback',
} as const

export function getBookDetailRoute(bookId: string): string {
  return `/books/${bookId}`
}

export function getBorrowerDetailRoute(borrowerId: string): string {
  return `/borrowers/${borrowerId}`
}
