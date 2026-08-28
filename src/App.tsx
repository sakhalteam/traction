import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import {
  emptyState, isEmptyState, loadLocal, saveLocal, touchLocal, saveRemote, loadRemote,
  getLocalUpdatedAt, isNewer, mergeStates, isDirty, setDirty, toggleFavorite,
  makeClient, makeService, makeEntry, makeExpense, todayISO, buildBreakdown, formatClock, liveSeconds,
  addDays, nextInvoiceNumber, dateFromEpoch,
} from './store'
import type { RemoteState } from './store'
import type {
  Client, DurationStyle, Expense, Invoice, InvoiceStatus, Service, Settings, TimeEntry, TractionState,
} from './types'
import { deleteReceipt, uploadJobPhoto } from './receipts'
import { useNow } from './useNow'
import { Chrome, type CloudStatus, type View } from './Chrome'
import { TimerBar } from './TimerBar'
import { TimerView } from './views/TimerView'
import { ClientsView } from './views/ClientsView'
import { ServicesView } from './views/ServicesView'
import { ExpensesView } from './views/ExpensesView'
import { InvoicesView } from './views/InvoicesView'
import { ReportsView } from './views/ReportsView'
import { SettingsView } from './views/SettingsView'

/** Warn if a timer's been running longer than this (forgot-to-stop). */
const RUNAWAY_SECONDS = 8 * 3600

const REMOTE_SAVE_DELAY = 4000

export default function App() {
  const [state, setStateRaw] = useState<TractionState>(loadLocal)
  const [view, setView] = useState<View>('timer')
  /** Client to preselect the next time the invoice builder opens, if any. */
  const [invoiceClient, setInvoiceClient] = useState<string | null>(null)

  /** Jump to the invoice builder, optionally with a client already chosen. */
  const goInvoice = useCallback((clientId?: string) => {
    setInvoiceClient(clientId ?? null)
    setView('invoices')
  }, [])
  const [user, setUser] = useState<User | null>(null)
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>('idle')
  const remoteSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const needsRemoteSave = useRef(false)

  // Mirror to localStorage on every change. The updated-at stamp sync compares
  // is bumped in `mutate` instead — only a real edit makes this device newer.
  // The ref lets async sync callbacks read the current state without re-subscribing.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
    saveLocal(state)
  }, [state])

  /** Show a transient status in the chrome, then fall back to idle. */
  const flash = useCallback((status: CloudStatus) => {
    setCloudStatus(status)
    setTimeout(() => setCloudStatus('idle'), 1600)
  }, [])

  /** Take the cloud copy as this device's truth. */
  const adoptRemote = useCallback((remote: RemoteState) => {
    setStateRaw(remote.state)
    saveLocal(remote.state)
    // Inherit the cloud's stamp rather than claiming we edited just now —
    // otherwise every pull would leave this device looking like the freshest writer.
    touchLocal(remote.updatedAt)
    needsRemoteSave.current = false
    // This device now matches the cloud exactly — nothing left to push.
    setDirty(false)
  }, [])

  /**
   * Does the cloud copy win? Normally that's just "is it newer", but the first
   * time a device ever sees the cloud row its local stamp isn't trustworthy — it
   * can be junk left by a build that stamped on page load rather than on edit.
   * An untouched device therefore yields to the cloud; one holding real unsynced
   * work still gets to defend it on timestamp.
   */
  const cloudWins = useCallback((remote: RemoteState, local: TractionState) => {
    if (remote.firstSight && isEmptyState(local)) return true
    return isNewer(remote.updatedAt, getLocalUpdatedAt())
  }, [])

  // ---- Auth ----
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

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

  /**
   * Push a state document to the cloud, reconciling if the cloud moved ahead.
   *
   * Returns nothing; all outcomes land in the dirty flag, which is what makes a
   * failed save recoverable after a reload rather than forgotten.
   */
  const push = useCallback(async (s: TractionState, force = false) => {
    setCloudStatus('saving')
    const result = await saveRemote(supabase, s, { force })

    if (result === 'stale') {
      // The cloud holds a version this device never read. Both copies may hold
      // real work, so union them instead of picking a winner — see mergeStates.
      const remote = await loadRemote(supabase)
      if (!remote) {
        flash('error')
        return
      }
      // An untouched device has nothing worth merging; just take the cloud copy.
      if (isEmptyState(stateRef.current)) {
        adoptRemote(remote)
        flash('pulled')
        return
      }
      const merged = mergeStates(stateRef.current, remote.state)
      setStateRaw(merged)
      saveLocal(merged)
      touchLocal()
      // Force past the compare-and-swap: we've just read the cloud's version and
      // folded it in, so the merged copy is strictly the most complete one.
      const after = await saveRemote(supabase, merged, { force: true })
      const ok = after === 'saved'
      needsRemoteSave.current = !ok
      setDirty(!ok)
      flash(ok ? 'merged' : 'error')
      return
    }

    const ok = result === 'saved'
    needsRemoteSave.current = !ok
    setDirty(!ok)
    flash(ok ? 'saved' : 'error')
  }, [adoptRemote, flash])

  const scheduleRemoteSave = useCallback((s: TractionState, force = false) => {
    needsRemoteSave.current = true
    setDirty(true)
    clearTimeout(remoteSaveTimer.current)
    remoteSaveTimer.current = setTimeout(() => {
      if (!needsRemoteSave.current) return
      void push(s, force)
    }, REMOTE_SAVE_DELAY)
  }, [push])

  /**
   * Reconcile this device with the cloud. One entry point on purpose: the
   * direction is decided by whether we're holding unsynced edits, so a pull and
   * a push can never run against each other and undo one another's work.
   *
   * Dirty means push — and `push` merges if the cloud has moved on, so local
   * work is never traded away for being a few seconds older. Clean means pull,
   * which is the cheap common case (opening the laptop after a day on the phone).
   */
  const sync = useCallback(async () => {
    if (!navigator.onLine) return
    if (isDirty()) {
      // Supersede any debounced save rather than letting both fire.
      clearTimeout(remoteSaveTimer.current)
      needsRemoteSave.current = true
      await push(stateRef.current)
      return
    }
    const remote = await loadRemote(supabase)
    if (remote && cloudWins(remote, stateRef.current)) {
      adoptRemote(remote)
      flash('pulled')
    }
  }, [adoptRemote, cloudWins, flash, push])

  /**
   * Sync on sign-in, whenever the tab comes back to the foreground, and the
   * moment the network returns. That last one is what rescues an entry logged in
   * a dead-zone: without it, a failed save waits for the next unrelated edit.
   */
  useEffect(() => {
    if (!user) return
    const run = () => {
      if (document.visibilityState === 'hidden') return
      void sync()
    }
    run()
    window.addEventListener('focus', run)
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', run)
    return () => {
      window.removeEventListener('focus', run)
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', run)
    }
  }, [user, sync])

  /** Single mutation entry point: applies a producer, persists, schedules sync. */
  const mutate = useCallback((
    producer: (prev: TractionState) => TractionState,
    opts: { force?: boolean } = {},
  ) => {
    setStateRaw(prev => {
      const next = producer(prev)
      if (next === prev) return prev
      // Only a real change makes this device the freshest writer.
      touchLocal()
      scheduleRemoteSave(next, opts.force)
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
      // Orphan any entries pointing here rather than deleting billable history —
      // but never touch invoiced ones. An entry on an invoice is frozen
      // everywhere else in the app, and rewriting it here would let deleting a
      // client silently edit what a sent invoice was built from.
      entries: s.entries.map(e => e.clientId === id && !e.invoiceId ? { ...e, clientId: null } : e),
      expenses: s.expenses.map(x => x.clientId === id && !x.invoiceId ? { ...x, clientId: null } : x),
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
  // Entries on an invoice are frozen — block edits/deletes so a sent invoice's
  // numbers can never drift. (UI hides the buttons too; this is the guarantee.)
  const updateEntry = useCallback((entry: TimeEntry) => {
    mutate(s => {
      const existing = s.entries.find(e => e.id === entry.id)
      if (!existing || existing.invoiceId) return s
      return { ...s, entries: s.entries.map(e => e.id === entry.id ? entry : e) }
    })
  }, [mutate])
  const deleteEntry = useCallback((id: string) => {
    mutate(s => {
      const existing = s.entries.find(e => e.id === id)
      if (!existing || existing.invoiceId) return s
      // Don't strand job photos in Storage. Best-effort and deliberately
      // un-awaited: a failed cleanup must never block deleting the entry.
      for (const p of existing.photoPaths ?? []) void deleteReceipt(supabase, p)
      return { ...s, entries: s.entries.filter(e => e.id !== id) }
    })
  }, [mutate])

  /** Attach a job photo: upload first, then record the path on the entry. */
  const attachEntryPhoto = useCallback(async (entryId: string, file: File) => {
    const path = await uploadJobPhoto(supabase, entryId, file)
    mutate(s => ({
      ...s,
      entries: s.entries.map(e => e.id === entryId
        ? { ...e, photoPaths: [...(e.photoPaths ?? []), path] }
        : e),
    }))
  }, [mutate])

  /** Remove the most recent job photo from an entry, and from Storage. */
  const removeEntryPhoto = useCallback(async (entryId: string) => {
    let doomed: string | undefined
    mutate(s => ({
      ...s,
      entries: s.entries.map(e => {
        if (e.id !== entryId) return e
        const paths = [...(e.photoPaths ?? [])]
        doomed = paths.pop()
        return { ...e, photoPaths: paths }
      }),
    }))
    if (doomed) await deleteReceipt(supabase, doomed)
  }, [mutate])
  const addManualEntry = useCallback((
    serviceId: string, clientId: string | null, startedAt: number, seconds: number, rate: number, note: string,
  ) => {
    // A hand-logged entry now carries a real wall-clock start, so the times
    // printed on an invoice are the times you were actually there.
    const e = {
      ...makeEntry(serviceId, rate, clientId, dateFromEpoch(startedAt), startedAt),
      seconds, note,
    }
    mutate(s => ({ ...s, entries: [...s.entries, e] }))
  }, [mutate])

  /**
   * The app-wide h:m ↔ decimal switch. Its own action rather than a settings
   * form save, because it's offered on several screens as a one-tap toggle.
   */
  const setDurationFormat = useCallback((durationFormat: DurationStyle) => {
    mutate(s => ({ ...s, settings: { ...s.settings, durationFormat } }))
  }, [mutate])

  // ---- Expense actions (locked once billed onto an invoice) ----
  const addExpense = useCallback((exp: Expense) => {
    mutate(s => ({ ...s, expenses: [...s.expenses, exp] }))
  }, [mutate])
  const updateExpense = useCallback((exp: Expense) => {
    mutate(s => {
      const existing = s.expenses.find(x => x.id === exp.id)
      if (!existing || existing.invoiceId) return s
      return { ...s, expenses: s.expenses.map(x => x.id === exp.id ? exp : x) }
    })
  }, [mutate])
  const deleteExpense = useCallback((id: string) => {
    mutate(s => {
      const existing = s.expenses.find(x => x.id === id)
      if (!existing || existing.invoiceId) return s
      // Don't strand the receipt photo in Storage. Best-effort and deliberately
      // un-awaited: a failed cleanup must never block deleting the expense.
      if (existing.receiptPath) void deleteReceipt(supabase, existing.receiptPath)
      return { ...s, expenses: s.expenses.filter(x => x.id !== id) }
    })
  }, [mutate])

  /** Start a fresh running timer, stopping any other that's live. */
  const startTimer = useCallback((serviceId: string, clientId: string | null, rate: number, note: string) => {
    const now = Date.now()
    // startedAt is the real wall-clock start, so the entry can be re-timed later.
    const fresh = { ...makeEntry(serviceId, rate, clientId, todayISO(), now), note, runningSince: now }
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

  /** Pin / unpin a service+client pairing so it stays one tap away. */
  const toggleFav = useCallback((serviceId: string, clientId: string | null) => {
    mutate(s => ({
      ...s,
      settings: { ...s.settings, favorites: toggleFavorite(s.settings.favorites, serviceId, clientId) },
    }))
  }, [mutate])

  // ---- Invoice actions ----
  /**
   * Build the invoice from the CURRENT state, then apply it.
   *
   * The invoice is deliberately constructed outside the state producer. Callers
   * need the new invoice back synchronously (the builder opens it the moment
   * it's made), and a producer passed to setState is not guaranteed to have run
   * by the time this function returns — React only happens to invoke it eagerly
   * while no other update is pending. Building here makes the return value real
   * instead of relying on that.
   */
  const createInvoice = useCallback((
    clientId: string, entryIds: string[], expenseIds: string[], periodStart: string, periodEnd: string,
    opts: { alreadyPaid?: boolean } = {},
  ): Invoice => {
    const s = stateRef.current
    // Freeze labor AND expense lines NOW so later edits can't rewrite the invoice.
    const snapshot = buildBreakdown(s.entries.filter(e => entryIds.includes(e.id)), s.services)
    const expensesSnapshot = s.expenses
      .filter(x => expenseIds.includes(x.id))
      .map(x => ({ id: x.id, label: x.label || 'Charge', amount: x.amount || 0 }))
    // Work settled outside traction (cash on the day, an old paper invoice) is
    // dated to when it happened, not today — issuing a 2025 job "today" would
    // land it in the wrong month in Reports.
    const issuedDate = opts.alreadyPaid ? periodEnd : todayISO()
    const invoice: Invoice = {
      id: crypto.randomUUID(),
      clientId,
      // CLIENTCODE-YYYYMMDD-NN, sequenced against the numbers already issued
      // under that same prefix — see nextInvoiceNumber.
      number: nextInvoiceNumber(s.invoices, s.clients.find(c => c.id === clientId), issuedDate),
      issuedDate,
      // Freeze the terms in effect today; changing netDays later must not
      // retroactively make already-issued invoices overdue.
      dueDate: addDays(issuedDate, s.settings.netDays),
      periodStart, periodEnd, entryIds: [...entryIds], snapshot,
      expenseIds: [...expenseIds], expensesSnapshot,
      status: opts.alreadyPaid ? 'paid' : 'draft',
      paidDate: opts.alreadyPaid ? periodEnd : null,
      notes: '', createdAt: Date.now(),
    }

    mutate(prev => ({
      ...prev,
      invoices: [...prev.invoices, invoice],
      entries: prev.entries.map(e => entryIds.includes(e.id) ? { ...e, invoiceId: invoice.id } : e),
      expenses: prev.expenses.map(x => expenseIds.includes(x.id) ? { ...x, invoiceId: invoice.id } : x),
    }))
    return invoice
  }, [mutate])

  // Add / edit / remove a one-off charge directly on an invoice (backed by a
  // real billable Expense so it still shows up in Reports and the Expenses tab).
  const addInvoiceCharge = useCallback((invoiceId: string) => {
    mutate(s => {
      const inv = s.invoices.find(i => i.id === invoiceId)
      if (!inv || inv.status === 'paid') return s
      const exp: Expense = { ...makeExpense(inv.issuedDate), clientId: inv.clientId, billable: true, invoiceId }
      return {
        ...s,
        expenses: [...s.expenses, exp],
        invoices: s.invoices.map(i => i.id === invoiceId
          ? { ...i, expenseIds: [...i.expenseIds, exp.id], expensesSnapshot: [...i.expensesSnapshot, { id: exp.id, label: '', amount: 0 }] }
          : i),
      }
    })
  }, [mutate])
  const updateInvoiceCharge = useCallback((invoiceId: string, expenseId: string, patch: { label?: string; amount?: number }) => {
    mutate(s => ({
      ...s,
      expenses: s.expenses.map(x => x.id === expenseId ? { ...x, ...patch } : x),
      invoices: s.invoices.map(i => i.id === invoiceId
        ? { ...i, expensesSnapshot: i.expensesSnapshot.map(l => l.id === expenseId
            ? { ...l, ...(patch.label !== undefined ? { label: patch.label } : {}), ...(patch.amount !== undefined ? { amount: patch.amount } : {}) }
            : l) }
        : i),
    }))
  }, [mutate])
  const removeInvoiceCharge = useCallback((invoiceId: string, expenseId: string) => {
    mutate(s => ({
      ...s,
      expenses: s.expenses.filter(x => x.id !== expenseId),
      invoices: s.invoices.map(i => i.id === invoiceId
        ? { ...i, expenseIds: i.expenseIds.filter(id => id !== expenseId), expensesSnapshot: i.expensesSnapshot.filter(l => l.id !== expenseId) }
        : i),
    }))
  }, [mutate])

  const setInvoiceStatus = useCallback((id: string, status: InvoiceStatus) => {
    mutate(s => ({
      ...s,
      invoices: s.invoices.map(i => i.id === id
        ? { ...i, status, paidDate: status === 'paid' ? (i.paidDate ?? todayISO()) : null }
        : i),
    }))
  }, [mutate])
  const updateInvoice = useCallback((invoice: Invoice) => {
    mutate(s => ({ ...s, invoices: s.invoices.map(i => i.id === invoice.id ? invoice : i) }))
  }, [mutate])
  const deleteInvoice = useCallback((id: string) => {
    mutate(s => ({
      ...s,
      invoices: s.invoices.filter(i => i.id !== id),
      // Release billed entries back to unbilled. Inline one-off charges (which
      // only exist because of this invoice) are removed; pre-logged expenses are
      // released back to the unbilled pool.
      entries: s.entries.map(e => e.invoiceId === id ? { ...e, invoiceId: null } : e),
      expenses: s.expenses
        .filter(x => !(x.invoiceId === id && !x.label && !x.amount))
        .map(x => x.invoiceId === id ? { ...x, invoiceId: null } : x),
    }))
  }, [mutate])

  // ---- Settings ----
  const updateSettings = useCallback((settings: Settings) => {
    mutate(s => ({ ...s, settings }))
  }, [mutate])

  // Reset and import are the two deliberate "make the cloud match this device"
  // actions, so they skip the compare-and-swap that guards accidental overwrites.
  const resetAll = useCallback(() => {
    mutate(() => emptyState(), { force: true })
  }, [mutate])

  const importData = useCallback((imported: TractionState) => {
    mutate(() => imported, { force: true })
  }, [mutate])

  const runningEntry = useMemo(() => state.entries.find(e => e.runningSince) ?? null, [state.entries])
  const nowTick = useNow(!!runningEntry)

  // Live elapsed time in the browser tab title, so a forgotten timer is obvious.
  useEffect(() => {
    document.title = runningEntry
      ? `▶ ${formatClock(liveSeconds(runningEntry, nowTick))} · traction`
      : 'traction'
  }, [runningEntry, nowTick])

  // Forgot-to-stop nudge once a timer crosses the runaway threshold.
  const [runawayDismissed, setRunawayDismissed] = useState<string | null>(null)
  const runningSecs = runningEntry ? liveSeconds(runningEntry, nowTick) : 0
  const showRunaway = !!runningEntry && runningSecs > RUNAWAY_SECONDS && runawayDismissed !== runningEntry.id

  return (
    <div className="app">
      <Chrome
        view={view}
        onNav={setView}
        user={user}
        onLogin={login}
        onLogout={logout}
        cloudStatus={cloudStatus}
        running={!!runningEntry}
      />

      {showRunaway && runningEntry && (
        <div className="runaway-nudge" role="status">
          <span>⏱️ A timer's been running <strong>{formatClock(runningSecs)}</strong> — still on the clock?</span>
          <div className="runaway-actions">
            <button className="btn danger" onClick={() => stopTimer(runningEntry.id)}>■ Stop it</button>
            <button className="btn ghost" onClick={() => setRunawayDismissed(runningEntry.id)}>Keep going</button>
          </div>
        </div>
      )}

      <main className="content">
        {view === 'timer' && (
          <TimerView
            state={state}
            onStart={startTimer}
            onStop={stopTimer}
            onUpdateEntry={updateEntry}
            onDeleteEntry={deleteEntry}
            onAddManual={addManualEntry}
            onSetDurationFormat={setDurationFormat}
            onAddService={addService}
            onAddClient={addClient}
            onGoInvoice={goInvoice}
            onAttachPhoto={attachEntryPhoto}
            onRemovePhoto={removeEntryPhoto}
            onToggleFavorite={toggleFav}
          />
        )}
        {view === 'clients' && (
          <ClientsView
            state={state}
            onAdd={addClient}
            onUpdate={updateClient}
            onDelete={deleteClient}
            onGoInvoice={goInvoice}
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
        {view === 'expenses' && (
          <ExpensesView
            state={state}
            onAdd={addExpense}
            onUpdate={updateExpense}
            onDelete={deleteExpense}
          />
        )}
        {view === 'invoices' && (
          <InvoicesView
            state={state}
            initialClientId={invoiceClient}
            onCreate={createInvoice}
            onSetStatus={setInvoiceStatus}
            onUpdate={updateInvoice}
            onDelete={deleteInvoice}
            onAddCharge={addInvoiceCharge}
            onUpdateCharge={updateInvoiceCharge}
            onRemoveCharge={removeInvoiceCharge}
          />
        )}
        {view === 'reports' && (
          <ReportsView state={state} onSetDurationFormat={setDurationFormat} />
        )}

        {view === 'settings' && (
          <SettingsView
            state={state}
            onUpdate={updateSettings}
            onReset={resetAll}
            onImport={importData}
            onSetDurationFormat={setDurationFormat}
          />
        )}
      </main>

      {/* The running clock follows you across every tab except the one that
          already shows it full size — doubling it up on the Timer screen would
          just cover the log with a copy of the card above it. */}
      {runningEntry && view !== 'timer' && (
        <TimerBar
          entry={runningEntry}
          state={state}
          now={nowTick}
          onStop={stopTimer}
          onOpen={() => setView('timer')}
        />
      )}
    </div>
  )
}
