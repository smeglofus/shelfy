import { useQuery } from '@tanstack/react-query'

import { suggestBooks } from '../lib/api'
import type { BookSuggestion } from '../lib/types'

/** Minimum typed characters before the catalogue is queried (#308). */
export const MIN_SUGGEST_QUERY_LENGTH = 3

/**
 * Autocomplete candidates for the add-book form (#308).
 *
 * Pass an already-debounced query (the caller owns the debounce — see
 * `useDebounce`, 250ms, same as BorrowersPage search). The query only
 * fires once the trimmed input reaches 3 characters and `enabled` is
 * true, so the demo mode / closed dropdown never hit the network.
 */
export function useBookSuggestions(query: string, enabled: boolean) {
  const trimmed = query.trim()
  return useQuery<BookSuggestion[]>({
    queryKey: ['book-suggestions', trimmed],
    queryFn: () => suggestBooks(trimmed),
    enabled: enabled && trimmed.length >= MIN_SUGGEST_QUERY_LENGTH,
    // Server caches per-query too; keeping results fresh client-side for a
    // few minutes avoids re-fetching while the user edits back and forth.
    staleTime: 5 * 60 * 1000,
  })
}
