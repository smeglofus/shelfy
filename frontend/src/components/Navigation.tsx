import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import { ROUTES } from '../lib/routes'
import { useAuth } from '../contexts/AuthContext'
import { BookshelfInlineIcon } from './EmptyStateIcons'

/* ── SVG Icons (Lucide-inspired, 24×24 viewBox) ──────────────────── */

function IconHome({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function IconLibrary({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

function IconPlus({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconCamera({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function IconBookshelf({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18M3 12h18M3 19h18" />
      <path d="M7 5v14M11 5v14M17 5v14" />
    </svg>
  )
}

function IconLocations({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function IconSettings({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function IconLogout({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

function IconBookPlus({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <line x1="12" y1="8" x2="12" y2="14" />
      <line x1="9" y1="11" x2="15" y2="11" />
    </svg>
  )
}

/* ── Icon map ─────────────────────────────────────────────────────── */

const iconComponents = {
  home: IconHome,
  library: IconLibrary,
  add: IconBookPlus,
  scan: IconCamera,
  bookshelf: IconBookshelf,
  locations: IconLocations,
  settings: IconSettings,
}

type NavIcon = keyof typeof iconComponents
type NavItem = { label: string; icon: NavIcon; path: string }

/* ── Navigation component ─────────────────────────────────────────── */

export function Navigation() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768)
  const [fabOpen, setFabOpen] = useState(false)
  const fabRef = useRef<HTMLDivElement>(null)
  const { logout } = useAuth()

  /* Grouped sidebar items (desktop) — Locations removed, accessible via Bookshelf → tab */
  const navGroup = useMemo<NavItem[]>(
    () => [
      { label: t('nav.home'), icon: 'home', path: ROUTES.home },
      { label: t('nav.library'), icon: 'library', path: ROUTES.books },
      { label: t('nav.bookshelf'), icon: 'bookshelf', path: ROUTES.bookshelfView },
    ],
    [t],
  )

  const actionGroup = useMemo<NavItem[]>(
    () => [
      { label: t('nav.add'), icon: 'add', path: ROUTES.addBook },
      { label: t('nav.scan'), icon: 'scan', path: ROUTES.scanShelf },
    ],
    [t],
  )

  const settingsGroup = useMemo<NavItem[]>(
    () => [
      { label: t('nav.settings'), icon: 'settings', path: ROUTES.settings },
    ],
    [t],
  )

  /* Mobile bottom nav: 4 items + center FAB */
  const mobileTabs = useMemo(
    () => [
      { label: t('nav.home'), icon: 'home', path: ROUTES.home },
      { label: t('nav.library'), icon: 'library', path: ROUTES.books },
      // FAB placeholder (handled separately)
      { label: t('nav.bookshelf'), icon: 'bookshelf', path: ROUTES.bookshelfView },
      { label: t('nav.settings'), icon: 'settings', path: ROUTES.settings },
    ],
    [t],
  )

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  /* Close FAB on click outside */
  useEffect(() => {
    if (!fabOpen) return
    const handler = (e: MouseEvent) => {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) {
        setFabOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [fabOpen])

  /* Close FAB with Escape */
  useEffect(() => {
    if (!fabOpen) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFabOpen(false)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [fabOpen])

  /* Close FAB on route change */
  useEffect(() => {
    setFabOpen(false)
  }, [location.pathname])

  function isActive(path: string) {
    return (
      location.pathname === path
      || (path === ROUTES.books
        && location.pathname.startsWith('/books')
        && location.pathname !== ROUTES.addBook)
      || (path === ROUTES.scanShelf && location.pathname === ROUTES.scanShelf)
      || (path === ROUTES.bookshelfView && location.pathname === ROUTES.bookshelfView)
    )
  }

  /* ── Desktop Sidebar ─────────────────────────────────────────────── */
  if (isDesktop) {
    return (
      <nav
        aria-label="Main navigation"
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
          gap: 4,
          zIndex: 100,
        }}
      >
        <div style={{ padding: '0 16px', marginBottom: 32, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ color: 'var(--sh-primary)' }}><BookshelfInlineIcon size={24} /></div>
          <h2 className="text-h3" style={{ margin: 0 }}>Shelfy</h2>
        </div>

        {/* Group: Navigate */}
        {navGroup.map((tab) => {
          const active = isActive(tab.path)
          const Icon = iconComponents[tab.icon]
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={`sh-sidebar-btn${active ? ' active' : ''}`}
            >
              <Icon size={20} />
              <span>{tab.label}</span>
            </button>
          )
        })}

        {/* Group: Actions */}
        <div className="sh-sidebar-divider" />
        <span className="sh-sidebar-group-label">{t('nav.actions', 'Actions')}</span>
        {actionGroup.map((tab) => {
          const active = isActive(tab.path)
          const Icon = iconComponents[tab.icon]
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={`sh-sidebar-btn${active ? ' active' : ''}`}
            >
              <Icon size={20} />
              <span>{tab.label}</span>
            </button>
          )
        })}

        {/* Group: Settings + Logout */}
        <div className="sh-sidebar-divider" style={{ marginTop: 'auto' }} />
        {settingsGroup.map((tab) => {
          const active = isActive(tab.path)
          const Icon = iconComponents[tab.icon]
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={`sh-sidebar-btn${active ? ' active' : ''}`}
            >
              <Icon size={20} />
              <span>{tab.label}</span>
            </button>
          )
        })}
        <button
          onClick={logout}
          className="sh-sidebar-btn"
        >
          <IconLogout size={20} />
          <span>{t('nav.logout', 'Logout')}</span>
        </button>
      </nav>
    )
  }

  /* ── Mobile Bottom Nav ───────────────────────────────────────────── */
  const isFabActionActive = isActive(ROUTES.addBook) || isActive(ROUTES.scanShelf)

  return (
    <nav
      aria-label="Main navigation"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-around',
        background: 'var(--sh-surface)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderTop: '1px solid var(--sh-border)',
        paddingBottom: 'env(safe-area-inset-bottom, 8px)',
        zIndex: 100,
        boxShadow: '0 -4px 20px rgba(0,0,0,0.03)',
      }}
    >
      {/* First two tabs */}
      {mobileTabs.slice(0, 2).map((tab) => {
        const active = isActive(tab.path)
        const Icon = iconComponents[tab.icon]
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
              padding: '10px 0 8px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: active ? 'var(--sh-teal)' : 'var(--sh-text-muted)',
              fontSize: 11,
              fontWeight: active ? 600 : 500,
              transition: 'color 0.2s ease',
              minHeight: 56,
            }}
          >
            <Icon size={22} />
            <span>{tab.label}</span>
          </button>
        )
      })}

      {/* Center FAB */}
      <div ref={fabRef} style={{ flex: 1, display: 'flex', justifyContent: 'center', position: 'relative' }}>
        {/* FAB popup menu */}
        {fabOpen && (
          <>
            {/* Backdrop */}
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.3)',
                zIndex: 98,
              }}
              onClick={() => setFabOpen(false)}
            />
            <div
              id="fab-actions-menu"
              role="menu"
              aria-label={t('nav.actions', 'Actions')}
              className="sh-fab-menu"
              style={{
                position: 'absolute',
                bottom: 64,
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                zIndex: 99,
              }}
            >
              <button
                role="menuitem"
                onClick={() => navigate(ROUTES.addBook)}
                className="sh-fab-menu-item"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 20px',
                  background: 'var(--sh-surface)',
                  border: '1px solid var(--sh-border)',
                  borderRadius: 'var(--sh-radius-md)',
                  cursor: 'pointer',
                  color: 'var(--sh-text-main)',
                  fontSize: 14,
                  fontWeight: 500,
                  fontFamily: "'Outfit', sans-serif",
                  whiteSpace: 'nowrap',
                  boxShadow: 'var(--sh-shadow-lg)',
                  transition: 'all 0.15s ease',
                }}
              >
                <IconBookPlus size={20} />
                {t('nav.add_book', 'Přidat knihu')}
              </button>
              <button
                role="menuitem"
                onClick={() => navigate(ROUTES.scanShelf)}
                className="sh-fab-menu-item"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 20px',
                  background: 'var(--sh-surface)',
                  border: '1px solid var(--sh-border)',
                  borderRadius: 'var(--sh-radius-md)',
                  cursor: 'pointer',
                  color: 'var(--sh-text-main)',
                  fontSize: 14,
                  fontWeight: 500,
                  fontFamily: "'Outfit', sans-serif",
                  whiteSpace: 'nowrap',
                  boxShadow: 'var(--sh-shadow-lg)',
                  transition: 'all 0.15s ease',
                }}
              >
                <IconCamera size={20} />
                {t('nav.scan_shelf', 'Skenovat polici')}
              </button>
            </div>
          </>
        )}

        {/* FAB button */}
        <button
          onClick={() => setFabOpen((v) => !v)}
          aria-label={t('nav.actions', 'Actions')}
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: fabOpen ? 'var(--sh-teal-dark)' : 'var(--sh-teal)',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(45, 122, 95, 0.35)',
            transform: `translateY(-14px) rotate(${fabOpen ? '45deg' : '0deg'})`,
            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            position: 'relative',
            zIndex: 101,
          }}
        >
          <IconPlus size={26} />
        </button>
        {/* Active indicator dot for FAB when on add/scan page */}
        {isFabActionActive && !fabOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: 4,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--sh-teal)',
            }}
          />
        )}
      </div>

      {/* Last two tabs */}
      {mobileTabs.slice(2).map((tab) => {
        const active = isActive(tab.path)
        const Icon = iconComponents[tab.icon]
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
              padding: '10px 0 8px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: active ? 'var(--sh-teal)' : 'var(--sh-text-muted)',
              fontSize: 11,
              fontWeight: active ? 600 : 500,
              transition: 'color 0.2s ease',
              minHeight: 56,
            }}
          >
            <Icon size={22} />
            <span>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
