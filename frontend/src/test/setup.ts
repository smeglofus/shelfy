import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params && typeof params === 'object') {
        const query = params.query
        if (typeof query === 'string' && key === 'books.empty_search') {
          return `books.empty_search:${query}`
        }
      }
      return key
    },
    i18n: { language: 'cs', changeLanguage: vi.fn() },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}))
