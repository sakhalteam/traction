import type { User } from '@supabase/supabase-js'

export type View = 'timer' | 'clients' | 'services' | 'log' | 'invoices' | 'reports' | 'settings'

const NAV: { id: View; label: string }[] = [
  { id: 'timer', label: 'Timer' },
  { id: 'log', label: 'Log' },
  { id: 'clients', label: 'Clients' },
  { id: 'services', label: 'Services' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
]

export function Chrome({
  view, onNav, user, onLogin, onLogout, cloudStatus, running,
}: {
  view: View
  onNav: (v: View) => void
  user: User | null
  onLogin: () => void
  onLogout: () => void
  cloudStatus: 'idle' | 'saving' | 'saved' | 'error'
  running: boolean
}) {
  return (
    <header className="chrome">
      <div className="chrome-left">
        <a href="https://sakhalteam.github.io/" className="home-btn" title="Back to island">
          <svg width="20" height="12" viewBox="0 0 32 18" fill="currentColor" aria-hidden="true">
            <path d="M 4,10 C 5,4 9,2 14,3 C 18,4 20,2 24,4 C 28,6 29,11 26,15 C 22,18 12,18 6,15 C 2,13 2,11 4,10 Z" />
          </svg>
          sakhalteam
        </a>
        <span className="brand">
          traction
          {running && <span className="brand-live" title="A timer is running" />}
        </span>
      </div>

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
              {user.user_metadata?.user_name ?? 'signed in'}
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
  )
}

/** Shared small building blocks reused across views. */

export function ClientLabel({ name }: { name: string | null }) {
  return <span className={`client-tag ${name ? '' : 'general'}`}>{name ?? 'General'}</span>
}
