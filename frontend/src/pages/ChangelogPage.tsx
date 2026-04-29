import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { changelogEntries, type ChangelogLocale } from '../content/changelog'

const P: CSSProperties = { margin: '0 0 10px', lineHeight: 1.7, color: 'var(--sh-text-secondary)' }
const UL: CSSProperties = { paddingLeft: 20, color: 'var(--sh-text-secondary)', lineHeight: 1.7, margin: '8px 0 0' }
const BADGE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 'var(--sh-radius-pill)',
  padding: '4px 10px',
  background: 'var(--sh-surface-elevated)',
  border: '1px solid var(--sh-border)',
  color: 'var(--sh-text-secondary)',
  fontSize: 12,
  fontWeight: 700,
}

function activeLocale(language: string | undefined): ChangelogLocale {
  return language?.startsWith('en') ? 'en' : 'cs'
}

function ChangeGroup({ label, items }: { label: string; items?: string[] }) {
  if (!items?.length) return null
  return (
    <div style={{ marginTop: 14 }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--sh-text-main)' }}>{label}</p>
      <ul style={UL}>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  )
}

export function ChangelogPage() {
  const navigate = useNavigate()
  const { i18n, t } = useTranslation()
  const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sh-bg)' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 24px',
          borderBottom: '1px solid var(--sh-border)',
          background: 'var(--sh-surface)',
        }}
      >
        <button
          type='button'
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 20 }}
          onClick={() => navigate('/')}
        >
          📚 Shelfy
        </button>
      </header>

      <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' }}>
        <h1 style={{ fontSize: 32, fontWeight: 900, margin: '0 0 8px' }}>{t('changelog.title')}</h1>
        <p style={{ ...P, fontSize: 16, marginBottom: 28 }}>
          {t('changelog.subtitle')}
        </p>

        <div style={{ display: 'grid', gap: 18 }}>
          {changelogEntries.map((entry) => (
            <article
              key={`${entry.date}-${entry.title.en}`}
              style={{
                background: 'var(--sh-surface)',
                border: '1px solid var(--sh-border)',
                borderRadius: 'var(--sh-radius-lg)',
                padding: '22px 24px',
                boxShadow: 'var(--sh-shadow-sm)',
              }}
            >
              <span style={BADGE}>{entry.date}</span>
              <h2 style={{ fontSize: 21, fontWeight: 850, margin: '12px 0 8px' }}>{entry.title[locale]}</h2>
              <p style={P}>{entry.summary[locale]}</p>
              <ChangeGroup label={t('changelog.added')} items={entry.added?.[locale]} />
              <ChangeGroup label={t('changelog.changed')} items={entry.changed?.[locale]} />
              <ChangeGroup label={t('changelog.fixed')} items={entry.fixed?.[locale]} />
            </article>
          ))}
        </div>
      </main>
    </div>
  )
}
