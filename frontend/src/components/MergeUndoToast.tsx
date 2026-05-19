import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useUndoMerge } from '../hooks/useBorrowers'
import { useMergeUndoStore } from '../lib/merge-undo-store'

/**
 * Floating Undo toast for the 10s merge-undo window (#244 PR #3).
 *
 * Mounted once at App-shell level so it survives the router navigation
 * the merge modal triggers (modal closes → user lands on target borrower
 * → toast must still be visible).
 *
 * Self-clears when:
 * - User clicks Undo → mutation handles the clear.
 * - Window expires → ``useEffect`` timer clears the store.
 * - User clicks the dismiss × → manual clear.
 *
 * Re-renders every 250 ms while a pending entry exists so the
 * countdown updates smoothly. That tick rate is fine: the toast lives
 * for ≤10 s and is unmounted as soon as the entry clears, so we're
 * spending at most ~40 renders per merge.
 */
export function MergeUndoToast() {
  const { t } = useTranslation()
  const pending = useMergeUndoStore((s) => s.pending)
  const clear = useMergeUndoStore((s) => s.clear)
  const undo = useUndoMerge()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!pending) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [pending])

  useEffect(() => {
    if (!pending) return
    const remaining = new Date(pending.undoUntil).getTime() - Date.now()
    if (remaining <= 0) {
      clear()
      return
    }
    const id = setTimeout(clear, remaining)
    return () => clearTimeout(id)
  }, [pending, clear])

  if (!pending) return null

  const remainingMs = new Date(pending.undoUntil).getTime() - now
  if (remainingMs <= 0) {
    // The timeout will fire ~immediately to clear; render nothing in
    // the meantime so the user doesn't see a "0s" frame.
    return null
  }
  const remainingSeconds = Math.ceil(remainingMs / 1000)

  return (
    <div
      role="status"
      data-testid="merge-undo-toast"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        padding: '12px 16px',
        borderRadius: 'var(--sh-radius-md)',
        background: 'var(--sh-surface-inverse, #1f2937)',
        color: 'var(--sh-text-inverse, #f9fafb)',
        boxShadow: 'var(--sh-shadow-lg)',
        fontSize: 14,
        maxWidth: 'min(560px, calc(100vw - 32px))',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        {t('borrowers.merge_undo_toast', {
          source: pending.sourceName,
          target: pending.targetName,
        })}
      </span>
      <button
        type="button"
        data-testid="merge-undo-button"
        onClick={() => undo.mutate(pending.token)}
        disabled={undo.isPending}
        style={{
          background: 'transparent',
          border: '1px solid currentColor',
          color: 'inherit',
          padding: '6px 12px',
          borderRadius: 'var(--sh-radius-sm)',
          fontWeight: 600,
          cursor: undo.isPending ? 'wait' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {undo.isPending
          ? t('borrowers.merge_undo_undoing')
          : t('borrowers.merge_undo_button', { seconds: remainingSeconds })}
      </button>
      <button
        type="button"
        data-testid="merge-undo-dismiss"
        aria-label={t('common.close')}
        onClick={clear}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          fontSize: 18,
          cursor: 'pointer',
          padding: '0 4px',
        }}
      >
        ×
      </button>
    </div>
  )
}
