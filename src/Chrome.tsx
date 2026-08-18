import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'

// The old separate 'log' view is gone — the Timer screen IS the log now, the
// way Toggl's home screen works: timer on top, date-grouped history below.
export type View = 'timer' | 'clients' | 'services' | 'expenses' | 'invoices' | 'reports' | 'settings'

/**
 * 'pulled' = this device adopted a newer copy from the cloud.
 * 'merged' = this device and the cloud had both moved on, and the two were
 *            reconciled rather than one overwriting the other.
 */
export type CloudStatus = 'idle' | 'saving' | 'saved' | 'pulled' | 'merged' | 'error'

interface NavItem { id: View; label: string; icon: ReactNode }

/** 24×24 stroked glyphs — legible at tab-bar size without an icon dependency. */
const ICONS: Record<View, ReactNode> = {
  timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></>,
  expenses: <><path d="M3 7h18v12H3zM3 11h18" /><circle cx="7.5" cy="15" r="1.2" /></>,
  clients: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M17 11.5a2.8 2.8 0 1 0-2-4.8M18 20c0-2.3-.8-4-2.2-5" /></>,
  services: <><path d="M14.5 3.5a4.5 4.5 0 0 0 6 6L12 18l-3.5 3.5L5 18l3.5-3.5z" /><path d="M5 5l3 3" /></>,
  invoices: <><path d="M6 2h9l4 4v16l-3-1.5L13 22l-3-1.5L7 22l-1-.5z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  reports: <><path d="M4 20V4M4 20h16" /><path d="M8 20v-6M13 20V8M18 20v-9" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2" /></>,
}

function icon(id: View) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[id]}
    </svg>
  )
}

const NAV: NavItem[] = (
  ['timer', 'expenses', 'clients', 'services', 'invoices', 'reports', 'settings'] as View[]
).map(id => ({ id, label: id[0].toUpperCase() + id.slice(1), icon: icon(id) }))

/**
 * What earns a slot in the mobile tab bar: the things you do standing in a yard.
 * Services, Reports and Settings are desk work and live behind "More", which
 * keeps every primary target wide enough to hit with one thumb.
 */
const PHONE_TABS: View[] = ['timer', 'expenses', 'invoices', 'clients']
const MORE_TABS: View[] = ['services', 'reports', 'settings']

export function Chrome({
  view, onNav, user, onLogin, onLogout, cloudStatus, running,
}: {
  view: View
  onNav: (v: View) => void
  user: User | null
  onLogin: () => void
  onLogout: () => void
  cloudStatus: CloudStatus
  running: boolean
}) {
  const [moreOpen, setMoreOpen] = useState(false)

  // Never leave the sheet covering the screen after it has done its job.
  useEffect(() => { setMoreOpen(false) }, [view])

  const go = (v: View) => { onNav(v); setMoreOpen(false) }
  const item = (id: View) => NAV.find(n => n.id === id)!

  return (
    <>
      <header className="chrome">
        <div className="chrome-left">
          <a href="https://sakhalteam.github.io/" className="home-btn" title="Back to island">
            <svg width="15" height="9" viewBox="0 0 32 18" fill="currentColor" aria-hidden="true">
              <path d="M 4,10 C 5,4 9,2 14,3 C 18,4 20,2 24,4 C 28,6 29,11 26,15 C 22,18 12,18 6,15 C 2,13 2,11 4,10 Z" />
            </svg>
            sakhalteam
          </a>
          <span className="brand">
            traction
            {running && <span className="brand-live" title="A timer is running" />}
          </span>
        </div>

        {/* Desktop navigation. On phones this collapses and the bottom tab bar
            takes over, so nothing here has to survive at 360px wide. */}
        <nav className="nav">
          {NAV.map(n => (
            <button
              key={n.id}
              className={`nav-btn ${view === n.id ? 'active' : ''}`}
              onClick={() => onNav(n.id)}
            >
              {n.label}
            </button>
          ))}
        </nav>

        <div className="chrome-right">
          {user && cloudStatus !== 'idle' && (
            <span className={`cloud-indicator ${cloudStatus}`}>
              {cloudStatus === 'saving' && 'syncing…'}
              {cloudStatus === 'saved' && 'synced'}
              {cloudStatus === 'pulled' && 'loaded from cloud'}
              {cloudStatus === 'merged' && 'merged with cloud'}
              {cloudStatus === 'error' && 'sync failed'}
            </span>
          )}
          <button
            className="auth-btn"
            onClick={() => (user ? onLogout() : onLogin())}
            title={user ? `Signed in as ${user.user_metadata?.user_name ?? user.email}` : 'Sign in to sync across devices'}
          >
            {user ? (
              <>
                <span className="auth-dot" />
                <span className="auth-name">{user.user_metadata?.user_name ?? 'signed in'}</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                sign in
              </>
            )}
          </button>
        </div>
      </header>

      {moreOpen && (
        <>
          <button className="sheet-scrim" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
          <div className="more-sheet" role="dialog" aria-label="More sections">
            {MORE_TABS.map(id => (
              <button
                key={id}
                className={`more-row ${view === id ? 'active' : ''}`}
                onClick={() => go(id)}
              >
                {item(id).icon}
                {item(id).label}
              </button>
            ))}
          </div>
        </>
      )}

      <nav className="tabbar" aria-label="Sections">
        {PHONE_TABS.map(id => (
          <button
            key={id}
            className={`tab ${view === id ? 'active' : ''}`}
            onClick={() => go(id)}
            aria-current={view === id ? 'page' : undefined}
          >
            {item(id).icon}
            <span>{item(id).label}</span>
            {id === 'timer' && running && <span className="tab-live" aria-hidden="true" />}
          </button>
        ))}
        <button
          className={`tab ${MORE_TABS.includes(view) ? 'active' : ''} ${moreOpen ? 'open' : ''}`}
          onClick={() => setMoreOpen(o => !o)}
          aria-expanded={moreOpen}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <span>More</span>
        </button>
      </nav>
    </>
  )
}

/** Shared small building blocks reused across views. */

export function ClientLabel({ name }: { name: string | null }) {
  return <span className={`client-tag ${name ? '' : 'general'}`}>{name ?? 'General'}</span>
}
