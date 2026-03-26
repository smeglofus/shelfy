import { useSettingsStore } from '../store/useSettingsStore'
import { exportBooksCsv } from '../lib/api'
import { useToastStore } from '../lib/toast-store'

export function SettingsPage() {
  const darkMode = useSettingsStore((s) => s.darkMode)
  const setDarkMode = useSettingsStore((s) => s.setDarkMode)
  const showError = useToastStore((s) => s.showError)

  return (
    <section className='container' style={{ maxWidth: 760 }}>
      <h2 className='text-h2'>Nastavení</h2>

      <article
        style={{
          border: '1px solid var(--sh-border)',
          borderRadius: 'var(--sh-radius-lg)',
          padding: 16,
          background: 'var(--sh-surface)',
          boxShadow: 'var(--sh-shadow-sm)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div>
          <h3 className='text-h3' style={{ marginTop: 0, marginBottom: 6 }}>Tmavý režim</h3>
          <p className='text-small'>Přepínání motivu se ukládá lokálně v prohlížeči.</p>
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            aria-label='dark-mode-toggle'
            type='checkbox'
            checked={darkMode}
            onChange={(event) => setDarkMode(event.target.checked)}
          />
          <span>{darkMode ? 'Zapnuto' : 'Vypnuto'}</span>
        </label>
      </article>

      <article
        style={{
          marginTop: 16,
          border: '1px solid var(--sh-border)',
          borderRadius: 'var(--sh-radius-lg)',
          padding: 16,
          background: 'var(--sh-surface)',
          boxShadow: 'var(--sh-shadow-sm)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div>
          <h3 className='text-h3' style={{ marginTop: 0, marginBottom: 6 }}>Export knihovny</h3>
          <p className='text-small'>Stáhne CSV se všemi knihami pro zálohu nebo další zpracování.</p>
        </div>

        <button
          type='button'
          className='sh-btn-secondary'
          onClick={async () => {
            try {
              const blob = await exportBooksCsv()
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = 'shelfy-export.csv'
              link.click()
              URL.revokeObjectURL(url)
            } catch {
              showError('Export knihovny selhal. Zkus to prosím znovu.')
            }
          }}
        >
          Stáhnout knihovnu (CSV)
        </button>
      </article>

    </section>
  )
}
