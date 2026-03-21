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
  const active = '#1D9E75'
  const inactive = '#888'

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: 480,
      display: 'flex',
      background: 'white',
      borderTop: '0.5px solid rgba(0,0,0,0.10)',
      paddingBottom: 'env(safe-area-inset-bottom, 8px)',
      zIndex: 100,
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
              gap: 3,
              padding: '10px 0 6px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: isActive ? active : inactive,
              fontSize: 11,
              transition: 'color 0.15s',
            }}
          >
            <span style={{ fontSize: 20, lineHeight: 1 }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
