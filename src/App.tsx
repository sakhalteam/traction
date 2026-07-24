import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import {
  emptyState, loadLocal, saveLocal, saveRemote, loadRemote, getLocalUpdatedAt,
  makeClient, makeService, makeEntry, todayISO,
} from './store'
import type {
  Client, Invoice, InvoiceStatus, Service, Settings, TimeEntry, TractionState,
} from './types'
import { Chrome, type View } from './Chrome'
import { TimerView } from './views/TimerView'
import { ClientsView } from './views/ClientsView'
import { ServicesView } from './views/ServicesView'
import { LogView } from './views/LogView'
import { InvoicesView } from './views/InvoicesView'
import { SettingsView } from './views/SettingsView'

const REMOTE_SAVE_DELAY = 4000

export default function App() {
  const [state, setStateRaw] = useState<TractionState>(loadLocal)
  const [view, setView] = useState<View>('timer')
  const [user, setUser] = useState<User | null>(null)
  const [cloudStatus, setCloudStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const remoteSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const needsRemoteSave = useRef(false)

  // Persist locally on every change.
  useEffect(() => { saveLocal(state) }, [state])

  // ---- Auth ----
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // On login, prefer the newest of local vs remote.
  useEffect(() => {
    if (!user) return
    loadRemote(supabase).then(remote => {
      if (!remote) return
      const localUpdatedAt = getLocalUpdatedAt()
      if (!localUpdatedAt || remote.updatedAt > localUpdatedAt) {
        setStateRaw(remote.state)
        saveLocal(remote.state)
      }
    })
  }, [user])

  const login = useCallback(() => {
    supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: window.location.origin + window.location.pathname },
    })
  }, [])

  const logout = useCallback(() => {
    supabase.auth.signOut()
    setUser(null)
  }, [])

  const scheduleRemoteSave = useCallback((s: TractionState) => {
    needsRemoteSave.current = true
    clearTimeout(remoteSaveTimer.current)
    remoteSaveTimer.current = setTimeout(async () => {
      if (!needsRemoteSave.current) return
      setCloudStatus('saving')
      const ok = await saveRemote(supabase, s)
      setCloudStatus(ok ? 'saved' : 'error')
      if (ok) needsRemoteSave.current = false
      setTimeout(() => setCloudStatus('idle'), 1600)
    }, REMOTE_SAVE_DELAY)
  }, [])

  /** Single mutation entry point: applies a producer, persists, schedules sync. */
  const mutate = useCallback((producer: (prev: TractionState) => TractionState) => {
    setStateRaw(prev => {
      const next = producer(prev)
      if (next === prev) return prev
      scheduleRemoteSave(next)
      return next
    })
  }, [scheduleRemoteSave])

  // ---- Client actions ----
  const addClient = useCallback((name: string): Client => {
    const c = makeClient(name)
    mutate(s => ({ ...s, clients: [...s.clients, c] }))
    return c
  }, [mutate])
  const updateClient = useCallback((client: Client) => {
    mutate(s => ({ ...s, clients: s.clients.map(c => c.id === client.id ? client : c) }))
  }, [mutate])
  const deleteClient = useCallback((id: string) => {
    mutate(s => ({
      ...s,
      clients: s.clients.filter(c => c.id !== id),
      // Orphan any entries pointing here rather than deleting billable history.
      entries: s.entries.map(e => e.clientId === id ? { ...e, clientId: null } : e),
    }))
  }, [mutate])

  // ---- Service actions ----
  const addService = useCallback((name: string, rate: number): Service => {
    const svc = makeService(name, rate)
    mutate(s => ({ ...s, services: [...s.services, svc] }))
    return svc
  }, [mutate])
  const updateService = useCallback((service: Service) => {
    mutate(s => ({ ...s, services: s.services.map(v => v.id === service.id ? service : v) }))
  }, [mutate])
  const deleteService = useCallback((id: string) => {
    mutate(s => ({ ...s, services: s.services.filter(v => v.id !== id) }))
  }, [mutate])

  // ---- Entry actions ----
  const updateEntry = useCallback((entry: TimeEntry) => {
    mutate(s => ({ ...s, entries: s.entries.map(e => e.id === entry.id ? entry : e) }))
  }, [mutate])
  const deleteEntry = useCallback((id: string) => {
    mutate(s => ({ ...s, entries: s.entries.filter(e => e.id !== id) }))
  }, [mutate])
  const addManualEntry = useCallback((
    serviceId: string, clientId: string | null, date: string, seconds: number, rate: number, note: string,
  ) => {
    const e = { ...makeEntry(serviceId, rate, clientId, date), seconds, note }
    mutate(s => ({ ...s, entries: [...s.entries, e] }))
  }, [mutate])

  /** Start a fresh running timer, stopping any other that's live. */
  const startTimer = useCallback((serviceId: string, clientId: string | null, rate: number, note: string) => {
    const now = Date.now()
    const fresh = { ...makeEntry(serviceId, rate, clientId, todayISO()), note, runningSince: now }
    mutate(s => ({
      ...s,
      entries: [
        ...s.entries.map(e => e.runningSince
          ? { ...e, seconds: e.seconds + Math.max(0, Math.floor((now - e.runningSince) / 1000)), runningSince: null }
          : e),
        fresh,
      ],
    }))
  }, [mutate])

  const stopTimer = useCallback((id: string) => {
    const now = Date.now()
    mutate(s => ({
      ...s,
      entries: s.entries.map(e => e.id === id && e.runningSince
        ? { ...e, seconds: e.seconds + Math.max(0, Math.floor((now - e.runningSince) / 1000)), runningSince: null }
        : e),
    }))
  }, [mutate])

  // ---- Invoice actions ----
  const createInvoice = useCallback((
    clientId: string, entryIds: string[], periodStart: string, periodEnd: string,
  ): Invoice => {
    const num = `INV-${String(state.settings.invoiceCounter).padStart(4, '0')}`
    const invoice: Invoice = {
      id: crypto.randomUUID(), clientId, number: num, issuedDate: todayISO(),
      periodStart, periodEnd, entryIds: [...entryIds], status: 'draft', notes: '',
      createdAt: Date.now(),
    }
    mutate(s => ({
      ...s,
      invoices: [...s.invoices, invoice],
      entries: s.entries.map(e => entryIds.includes(e.id) ? { ...e, invoiceId: invoice.id } : e),
      settings: { ...s.settings, invoiceCounter: s.settings.invoiceCounter + 1 },
    }))
    return invoice
  }, [mutate, state.settings.invoiceCounter])

  const setInvoiceStatus = useCallback((id: string, status: InvoiceStatus) => {
    mutate(s => ({ ...s, invoices: s.invoices.map(i => i.id === id ? { ...i, status } : i) }))
  }, [mutate])
  const updateInvoice = useCallback((invoice: Invoice) => {
    mutate(s => ({ ...s, invoices: s.invoices.map(i => i.id === invoice.id ? invoice : i) }))
  }, [mutate])
  const deleteInvoice = useCallback((id: string) => {
    mutate(s => ({
      ...s,
      invoices: s.invoices.filter(i => i.id !== id),
      entries: s.entries.map(e => e.invoiceId === id ? { ...e, invoiceId: null } : e),
    }))
  }, [mutate])

  // ---- Settings ----
  const updateSettings = useCallback((settings: Settings) => {
    mutate(s => ({ ...s, settings }))
  }, [mutate])

  const resetAll = useCallback(() => {
    mutate(() => emptyState())
  }, [mutate])

  const anyRunning = useMemo(() => state.entries.some(e => e.runningSince), [state.entries])

  return (
    <div className="app">
      <Chrome
        view={view}
        onNav={setView}
        user={user}
        onLogin={login}
        onLogout={logout}
        cloudStatus={cloudStatus}
        running={anyRunning}
      />

      <main className="content">
        {view === 'timer' && (
          <TimerView
            state={state}
            onStart={startTimer}
            onStop={stopTimer}
            onUpdateEntry={updateEntry}
            onDeleteEntry={deleteEntry}
            onAddService={addService}
            onAddClient={addClient}
          />
        )}
        {view === 'clients' && (
          <ClientsView
            state={state}
            onAdd={addClient}
            onUpdate={updateClient}
            onDelete={deleteClient}
            onGoInvoice={() => setView('invoices')}
          />
        )}
        {view === 'services' && (
          <ServicesView
            state={state}
            onAdd={addService}
            onUpdate={updateService}
            onDelete={deleteService}
          />
        )}
        {view === 'log' && (
          <LogView
            state={state}
            onUpdateEntry={updateEntry}
            onDeleteEntry={deleteEntry}
            onAddManual={addManualEntry}
          />
        )}
        {view === 'invoices' && (
          <InvoicesView
            state={state}
            onCreate={createInvoice}
            onSetStatus={setInvoiceStatus}
            onUpdate={updateInvoice}
            onDelete={deleteInvoice}
          />
        )}
        {view === 'settings' && (
          <SettingsView
            state={state}
            onUpdate={updateSettings}
            onReset={resetAll}
          />
        )}
      </main>
    </div>
  )
}
