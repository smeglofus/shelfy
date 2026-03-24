import { useLocation, useNavigate } from 'react-router-dom'
import { ROUTES } from '../lib/routes'

const TABS = [
  { label: 'Knihovna', icon: '⊞', path: ROUTES.books },
  { label: 'Přidat',   icon: '⊕', path: ROUTES.addBook },
  { label: 'Domů',     icon: '⌂', path: ROUTES.home },
] as const

export function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: 520,
      display: 'flex',
      background: 'rgba(255, 255, 255, 0.9)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderTop: '1px solid var(--sh-border)',
      paddingBottom: 'env(safe-area-inset-bottom, 8px)',
      zIndex: 100,
      boxShadow: '0 -4px 20px rgba(0,0,0,0.03)',
    }}>
      {TABS.map(tab => {
        const isActive = location.pathname === tab.path ||
          (tab.path === ROUTES.books && location.pathname.startsWith('/books') && location.pathname !== ROUTES.addBook)

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
            <span style={{ 
              fontSize: 22, 
              lineHeight: 1,
              marginBottom: 2,
              filter: isActive ? 'drop-shadow(0 2px 4px rgba(15, 157, 88, 0.3))' : 'none'
            }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
