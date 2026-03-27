import { useTranslation } from 'react-i18next'

import { exportBooksCsv } from '../lib/api'
import { useToastStore } from '../lib/toast-store'
import { setLanguage } from '../i18n'
import { useSettingsStore } from '../store/useSettingsStore'

export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const darkMode = useSettingsStore((s) => s.darkMode)
  const setDarkMode = useSettingsStore((s) => s.setDarkMode)
  const showError = useToastStore((s) => s.showError)
  const currentLang = i18n.language === 'en' ? 'en' : 'cs'

  return (
    <section className='container md-max-w-3xl' style={{ margin: '0 auto', width: '100%' }}>
      <h2 className='text-h2'>{t('settings.title')}</h2>

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
          <h3 className='text-h3' style={{ marginTop: 0, marginBottom: 6 }}>{t('settings.dark_mode_title')}</h3>
          <p className='text-small'>{t('settings.dark_mode_description')}</p>
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            aria-label='dark-mode-toggle'
            type='checkbox'
            checked={darkMode}
            onChange={(event) => setDarkMode(event.target.checked)}
          />
          <span>{darkMode ? t('settings.dark_mode_on') : t('settings.dark_mode_off')}</span>
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
          <h3 className='text-h3' style={{ marginTop: 0, marginBottom: 6 }}>{t('settings.language_title')}</h3>
          <p className='text-small'>{t('settings.language_description')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              setLanguage('cs')
            }}
            className={currentLang === 'cs' ? 'sh-btn-primary' : 'sh-btn-secondary'}
          >
            {t('settings.language_cs')}
          </button>
          <button
            onClick={() => {
              setLanguage('en')
            }}
            className={currentLang === 'en' ? 'sh-btn-primary' : 'sh-btn-secondary'}
          >
            {t('settings.language_en')}
          </button>
        </div>
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
          <h3 className='text-h3' style={{ marginTop: 0, marginBottom: 6 }}>{t('settings.export_title')}</h3>
          <p className='text-small'>{t('settings.export_description')}</p>
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
              showError(t('settings.export_error'))
            }
          }}
        >
          {t('settings.export_button')}
        </button>
      </article>
    </section>
  )
}
