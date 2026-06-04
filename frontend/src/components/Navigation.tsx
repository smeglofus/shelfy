import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import { ROUTES } from '../lib/routes'
import { useAuth } from '../contexts/AuthContext'
import { withDemoPrefix } from '../features/demo/demoNav'
import { BookshelfInlineIcon } from './EmptyStateIcons'
import { UsageMeterCard } from './UsageMeterCard'

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

function IconBorrowers({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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
  borrowers: IconBorrowers,
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

  /* Inside the public demo (#285/#288) the same sidebar is reused, but every
     destination must stay within the `/demo/*` subtree and the authenticated-
     only controls (borrowers, settings, usage, logout) are dropped. */
  const isDemo = location.pathname.startsWith(ROUTES.demo)
  const prefix = useCallback(
    (path: string) => (isDemo ? withDemoPrefix(path) : path),
    [isDemo],
  )

  /* Grouped sidebar items (desktop) */
  const navGroup = useMemo<NavItem[]>(
    () => [
      { label: t('nav.library'), icon: 'library', path: prefix(ROUTES.books) },
      { label: t('nav.bookshelf'), icon: 'bookshelf', path: prefix(ROUTES.bookshelfView) },
    ],
    [t, prefix],
  )

  const actionGroup = useMemo<NavItem[]>(
    () => [
      { label: t('nav.add'), icon: 'add', path: prefix(ROUTES.addBook) },
      { label: t('nav.scan'), icon: 'scan', path: prefix(ROUTES.scanShelf) },
    ],
    [t, prefix],
  )

  const secondaryGroup = useMemo<NavItem[]>(
    () => [
      { label: t('nav.borrowers'), icon: 'borrowers', path: ROUTES.borrowers },
    ],
    [t],
  )

  const settingsGroup = useMemo<NavItem[]>(
    () => [
      { label: t('nav.settings'), icon: 'settings', path: ROUTES.settings },
    ],
    [t],
  )

  /* Mobile bottom nav: tabs split around the center FAB.
     App:  [library] [bookshelf] [FAB] [borrowers] [settings]
     Demo: [library]            [FAB] [bookshelf]            */
  const mobileTabs = useMemo<NavItem[]>(
    () =>
      isDemo
        ? [
            { label: t('nav.library'), icon: 'library', path: prefix(ROUTES.books) },
            { label: t('nav.bookshelf'), icon: 'bookshelf', path: prefix(ROUTES.bookshelfView) },
          ]
        : [
            { label: t('nav.library'), icon: 'library', path: ROUTES.books },
            { label: t('nav.bookshelf'), icon: 'bookshelf', path: ROUTES.bookshelfView },
            { label: t('nav.borrowers'), icon: 'borrowers', path: ROUTES.borrowers },
            { label: t('nav.settings'), icon: 'settings', path: ROUTES.settings },
          ],
    [t, isDemo, prefix],
  )
  const mobileSplit = Math.ceil(mobileTabs.length / 2)

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
    const booksPath = prefix(ROUTES.books)
    const addBookPath = prefix(ROUTES.addBook)
    return (
      location.pathname === path
      || (path === booksPath
        && (location.pathname === booksPath || location.pathname.startsWith(`${booksPath}/`))
        && location.pathname !== addBookPath)
    )
  }

  /* ── Desktop Sidebar (unchanged) ──────────────────────────────── */
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
          overflowY: 'auto',
          gap: 4,
          zIndex: 100,
        }}
      >
        <div style={{ padding: '0 16px', marginBottom: 32, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ color: 'var(--sh-primary)' }}><BookshelfInlineIcon size={24} /></div>
          <h2 className="text-h3" style={{ margin: 0 }}>Shelfy</h2>
        </div>

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

        {!isDemo && (
          <>
            <div className="sh-sidebar-divider" />
            {secondaryGroup.map((tab) => {
              const active = isActive(tab.path)
              const Icon = iconComponents[tab.icon]
              return (
                <button
                  key={tab.path}
                  onClick={() => navigate(tab.path)}
                  className={`sh-sidebar-btn${active ? ' active' : ''}`}
                  data-testid={`nav-${tab.icon}`}
                >
                  <Icon size={20} />
                  <span>{tab.label}</span>
                </button>
              )
            })}

            <div className="sh-sidebar-divider" style={{ marginTop: 'auto' }} />
            <UsageMeterCard />
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
            <button onClick={logout} className="sh-sidebar-btn">
              <IconLogout size={20} />
              <span>{t('nav.logout', 'Logout')}</span>
            </button>
          </>
        )}
      </nav>
    )
  }

  /* ── Mobile Bottom Nav ─────────────────────────────────────────── */
  // CHANGED: nav is split into two rows:
  //   1. Tab row  — the actual tappable items (Library | FAB | Shelves | Settings)
  //   2. Safe zone — fills env(safe-area-inset-bottom) so items never overlap
  //                  the iPhone home indicator. Minimum 16px even on non-notch devices.
  //
  // Requires `viewport-fit=cover` in <meta name="viewport"> (see index.html).

  const isFabActionActive = isActive(prefix(ROUTES.addBook)) || isActive(prefix(ROUTES.scanShelf))

  const mobileTabStyle = (active: boolean): CSSProperties => ({
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
  })

  return (
    <nav
      aria-label="Main navigation"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',   // ← key: stack tab row above safe zone
        background: 'var(--sh-surface)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderTop: '1px solid var(--sh-border)',
        zIndex: 100,
        boxShadow: '0 -4px 20px rgba(0,0,0,0.03)',
      }}
    >
      {/* ── Tab row ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around' }}>

        {/* Tabs to the left of the FAB */}
        {mobileTabs.slice(0, mobileSplit).map((tab) => {
          const active = isActive(tab.path)
          const Icon = iconComponents[tab.icon as NavIcon]
          return (
            <button key={tab.path} onClick={() => navigate(tab.path)} style={mobileTabStyle(active)}>
              <Icon size={22} />
              <span>{tab.label}</span>
            </button>
          )
        })}

        {/* Center FAB */}
        <div ref={fabRef} style={{ flex: 1, display: 'flex', justifyContent: 'center', position: 'relative' }}>
          {fabOpen && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 98 }}
                onClick={() => setFabOpen(false)}
              />
              <div
                id="fab-actions-menu"
                role="menu"
                aria-label={t('nav.actions', 'Actions')}
                className="sh-fab-menu"
                style={{
                  position: 'absolute',
                  bottom: 68,   // slightly higher to clear the safe zone bar
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
                  onClick={() => navigate(prefix(ROUTES.addBook))}
                  className="sh-fab-menu-item"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 20px',
                    background: 'var(--sh-surface)',
                    border: '1px solid var(--sh-border)',
                    borderRadius: 'var(--sh-radius-md)',
                    cursor: 'pointer',
                    color: 'var(--sh-text-main)',
                    fontSize: 14, fontWeight: 500,
                    fontFamily: "'Inter', sans-serif",
                    whiteSpace: 'nowrap',
                    boxShadow: 'var(--sh-shadow-lg)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <IconBookPlus size={20} />
                  {t('nav.add_book', 'Add book')}
                </button>
                <button
                  role="menuitem"
                  onClick={() => navigate(prefix(ROUTES.scanShelf))}
                  className="sh-fab-menu-item"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 20px',
                    background: 'var(--sh-surface)',
                    border: '1px solid var(--sh-border)',
                    borderRadius: 'var(--sh-radius-md)',
                    cursor: 'pointer',
                    color: 'var(--sh-text-main)',
                    fontSize: 14, fontWeight: 500,
                    fontFamily: "'Inter', sans-serif",
                    whiteSpace: 'nowrap',
                    boxShadow: 'var(--sh-shadow-lg)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <IconCamera size={20} />
                  {t('nav.scan_shelf', 'Scan shelf')}
                </button>
              </div>
            </>
          )}

          {/* FAB button */}
          <button
            onClick={() => setFabOpen((v) => !v)}
            aria-label={t('nav.actions', 'Actions')}
            aria-expanded={fabOpen}
            aria-controls="fab-actions-menu"
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
              // Lifted higher to clear the safe zone bar below
              transform: `translateY(-16px) rotate(${fabOpen ? '45deg' : '0deg'})`,
              transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
              position: 'relative',
              zIndex: 101,
            }}
          >
            <IconPlus size={26} />
          </button>

          {/* Active dot */}
          {isFabActionActive && !fabOpen && (
            <div style={{
              position: 'absolute',
              bottom: 4,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 5, height: 5,
              borderRadius: '50%',
              background: 'var(--sh-teal)',
            }} />
          )}
        </div>

        {/* Tabs to the right of the FAB */}
        {mobileTabs.slice(mobileSplit).map((tab) => {
          const active = isActive(tab.path)
          const Icon = iconComponents[tab.icon as NavIcon]
          return (
            <button key={tab.path} onClick={() => navigate(tab.path)} style={mobileTabStyle(active)}>
              <Icon size={22} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* ── Safe zone bar ──────────────────────────────────────────────
           Fills the iPhone home indicator area. Height = the larger of:
           - env(safe-area-inset-bottom): the actual safe inset (0 on non-notch)
           - 16px: minimum so there's always some breathing room
           
           Requires viewport-fit=cover in <meta name="viewport">.
      ─────────────────────────────────────────────────────────────── */}
      <div
        aria-hidden
        style={{
          height: 'max(env(safe-area-inset-bottom, 0px), 16px)',
          background: 'var(--sh-surface)',
          borderTop: '1px solid var(--sh-border)',
          flexShrink: 0,
        }}
      />
    </nav>
  )
}
