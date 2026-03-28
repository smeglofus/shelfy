import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import { ROUTES } from '../lib/routes'

export function Navigation() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768)

  const tabs = useMemo(
    () => [
      { label: t('nav.library'), icon: '⊞', path: ROUTES.books },
      { label: t('nav.add'), icon: '⊕', path: ROUTES.addBook },
      { label: t('nav.home'), icon: '⌂', path: ROUTES.home },
      { label: t('nav.locations'), icon: '⌗', path: ROUTES.locations },
      { label: t('nav.settings'), icon: '⎈', path: ROUTES.settings },
    ],
    [t],
  )

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (isDesktop) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 240,
          background: 'var(--sh-surface)',
          borderRight: '1px solid var(--sh-border)',
          padding: '32px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 100,
        }}
      >
        <div style={{ padding: '0 16px', marginBottom: 32, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 24 }}>📚</div>
          <h2 className="text-h3" style={{ margin: 0 }}>Shelfy</h2>
        </div>

        {tabs.map((tab) => {
          const isActive =
            location.pathname === tab.path
            || (tab.path === ROUTES.books
              && location.pathname.startsWith('/books')
              && location.pathname !== ROUTES.addBook)

          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className="hover-lift"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '14px 16px',
                background: isActive ? 'var(--sh-teal-bg)' : 'transparent',
                border: 'none',
                borderRadius: 'var(--sh-radius-md)',
                cursor: 'pointer',
                color: isActive ? 'var(--sh-teal)' : 'var(--sh-text-muted)',
                fontSize: 15,
                fontWeight: isActive ? 600 : 500,
                transition: 'all 0.2s ease',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 22, lineHeight: 1 }}>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        background: 'var(--sh-surface-blur, rgba(255, 255, 255, 0.9))',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderTop: '1px solid var(--sh-border)',
        paddingBottom: 'env(safe-area-inset-bottom, 8px)',
        zIndex: 100,
        boxShadow: '0 -4px 20px rgba(0,0,0,0.03)',
      }}
    >
      {tabs.map((tab) => {
        const isActive =
          location.pathname === tab.path
          || (tab.path === ROUTES.books
            && location.pathname.startsWith('/books')
            && location.pathname !== ROUTES.addBook)

        return (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '12px 0 8px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: isActive ? 'var(--sh-teal)' : 'var(--sh-text-muted)',
              fontSize: 12,
              fontWeight: isActive ? 600 : 500,
              transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
              transform: isActive ? 'scale(1.05)' : 'scale(1)',
            }}
          >
            <span
              style={{
                fontSize: 22,
                lineHeight: 1,
                marginBottom: 2,
                filter: isActive ? 'drop-shadow(0 2px 4px rgba(15, 157, 88, 0.3))' : 'none',
              }}
            >
              {tab.icon}
            </span>
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
