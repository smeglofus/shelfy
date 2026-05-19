/**
 * Tiny Zustand store for the merge-undo toast (#244 PR #3).
 *
 * Lives separately from ``toast-store`` because the merge undo toast
 * needs:
 *   - a deadline timestamp (not just a string)
 *   - an action button (the existing toast component is text-only)
 *   - to survive the navigation that happens *after* merge (modal closes,
 *     router pushes to the target borrower's detail page)
 *
 * Single in-flight undo at a time — if a second merge happens before the
 * first window expires, the new entry replaces the old (the previous
 * token is then unrecoverable, which is fine: librarian moved on).
 */
import { create } from 'zustand'

export interface PendingMergeUndo {
  token: string
  undoUntil: string // ISO timestamp
  sourceName: string
  targetName: string
}

interface MergeUndoState {
  pending: PendingMergeUndo | null
  set: (entry: PendingMergeUndo) => void
  clear: () => void
}

export const useMergeUndoStore = create<MergeUndoState>((set) => ({
  pending: null,
  set: (entry) => set({ pending: entry }),
  clear: () => set({ pending: null }),
}))
