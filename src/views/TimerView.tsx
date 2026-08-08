import { useEffect, useMemo, useRef, useState } from 'react'
import type { Client, Service, TimeEntry, TractionState } from '../types'
import {
  formatClock, formatDate, formatDuration, formatMoney, liveSeconds, lineAmount, resolveRate, todayISO,
  paymentStateOf, rollupPaymentState, isMixedPayment, type PaymentState,
} from '../store'
import { useNow } from '../useNow'
import { EntryRow } from './EntryRow'

/** Sentinel <option> value meaning "open the create form", not a real id. */
const NEW_OPTION = '__new__'

const PAY_HINT: Record<PaymentState, string> = {
  unbilled: "Not on an invoice yet — this is money you still have to bill",
  invoiced: 'On an invoice, waiting to be paid',
  paid: "Paid — you've collected this",
}

export function TimerView({
  state, onStart, onStop, onUpdateEntry, onDeleteEntry, onAddManual, onAddService, onAddClient,
}: {
  state: TractionState
  onStart: (serviceId: string, clientId: string | null, rate: number, note: string) => void
  onStop: (id: string) => void
  onUpdateEntry: (e: TimeEntry) => void
  onDeleteEntry: (id: string) => void
  onAddManual: (serviceId: string, clientId: string | null, date: string, seconds: number, rate: number, note: string) => void
  onAddService: (name: string, rate: number) => Service
  onAddClient: (name: string) => Client
}) {
  const services = state.services.filter(s => !s.archived)
  const clients = state.clients.filter(c => !c.archived)
  const running = state.entries.find(e => e.runningSince) ?? null
  const now = useNow(!!running)

  const [serviceId, setServiceId] = useState('')
  const [clientId, setClientId] = useState('')
  const [note, setNote] = useState('')
  const [rate, setRate] = useState('')

  // Create-in-place forms, opened from the "+ New …" option in each dropdown.
  const [creating, setCreating] = useState<'service' | 'client' | null>(null)
  const [newService, setNewService] = useState('')
  const [newServiceRate, setNewServiceRate] = useState('')
  const [newClient, setNewClient] = useState('')
  const newServiceRef = useRef<HTMLInputElement>(null)
  const newClientRef = useRef<HTMLInputElement>(null)

  // Focus the field the moment it appears, so you can just keep typing.
  useEffect(() => {
    if (creating === 'service') newServiceRef.current?.focus()
    if (creating === 'client') newClientRef.current?.focus()
  }, [creating])

  // History controls (absorbed from the old separate Log tab)
  const [filterClient, setFilterClient] = useState('')
  const [filterPayment, setFilterPayment] = useState<PaymentState | ''>('')
  const [adding, setAdding] = useState(false)

  const selectedService = services.find(s => s.id === serviceId)
  const selectedClient = clientId ? (clients.find(c => c.id === clientId) ?? null) : null
  const resolvedRate = resolveRate(selectedService, selectedClient)
  const effectiveRate = rate !== '' ? Number(rate) : resolvedRate

  const clientName = (id: string | null) => id ? (state.clients.find(c => c.id === id)?.name ?? null) : null

  // Full history, newest day first, grouped by date — the Toggl home list.
  const byDate = useMemo(() => {
    const filtered = state.entries
      .filter(e => filterClient === '' ? true
        : filterClient === 'general' ? !e.clientId
        : e.clientId === filterClient)
      .filter(e => filterPayment === '' ? true
        : paymentStateOf(e, state.invoices) === filterPayment)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt))
    const map = new Map<string, TimeEntry[]>()
    for (const e of filtered) {
      const arr = map.get(e.date) ?? []
      arr.push(e)
      map.set(e.date, arr)
    }
    return [...map.entries()]
  }, [state.entries, state.invoices, filterClient, filterPayment])

  // Totals for whatever the filters are currently showing — answers "how much
  // do the Steins still owe me?" without leaving the time log.
  const shown = useMemo(() => {
    const all = byDate.flatMap(([, entries]) => entries)
    return {
      count: all.length,
      seconds: all.reduce((s, e) => s + liveSeconds(e, now), 0),
      amount: all.reduce((s, e) => s + lineAmount(liveSeconds(e, now), e.rate), 0),
    }
  }, [byDate, now])

  // Recent distinct service+client combos, for one-tap resume.
  const recentJobs = useMemo(() => {
    const seen = new Set<string>()
    const out: { serviceId: string; clientId: string | null; label: string; color: string }[] = []
    for (const e of [...state.entries].sort((a, b) => b.createdAt - a.createdAt)) {
      const key = `${e.serviceId}::${e.clientId ?? ''}`
      if (seen.has(key)) continue
      const svc = services.find(s => s.id === e.serviceId)
      if (!svc) continue
      seen.add(key)
      const cName = clientName(e.clientId)
      out.push({
        serviceId: e.serviceId, clientId: e.clientId, color: svc.color,
        label: cName ? `${svc.name} · ${cName}` : svc.name,
      })
      if (out.length >= 6) break
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.entries, services, state.clients])

  function handleStart() {
    if (!serviceId) return
    onStart(serviceId, clientId || null, effectiveRate, note.trim())
    setNote('')
  }

  function resume(job: { serviceId: string; clientId: string | null }) {
    const svc = services.find(s => s.id === job.serviceId)
    const cli = job.clientId ? (clients.find(c => c.id === job.clientId) ?? null) : null
    onStart(job.serviceId, job.clientId, resolveRate(svc, cli), '')
  }

  /**
   * Toggl-style continue. Never resumes the original entry — it starts a fresh
   * one carrying the same service, client, note and rate, so a job split across
   * a lunch break becomes two independently editable entries.
   */
  function continueEntry(e: TimeEntry) {
    onStart(e.serviceId, e.clientId, e.rate, e.note)
  }

  /** The dropdowns carry a sentinel row that opens the creator instead of selecting. */
  function handleServicePick(value: string) {
    if (value === NEW_OPTION) {
      setCreating('service')
      return // leave the current selection alone until the new one exists
    }
    setServiceId(value)
    setRate('')
  }

  function handleClientPick(value: string) {
    if (value === NEW_OPTION) {
      setCreating('client')
      return
    }
    setClientId(value)
  }

  function cancelCreate() {
    setCreating(null)
    setNewService('')
    setNewServiceRate('')
    setNewClient('')
  }

  function handleAddService() {
    const name = newService.trim()
    if (!name) return
    const svc = onAddService(name, Number(newServiceRate) || 0)
    setServiceId(svc.id) // select what you just made
    setRate('')
    setNewService('')
    setNewServiceRate('')
    setCreating(null)
  }

  function handleAddClient() {
    const name = newClient.trim()
    if (!name) return
    const c = onAddClient(name)
    setClientId(c.id)
    setNewClient('')
    setCreating(null)
  }

  return (
    <div className="view timer-view">
      {running ? (
        <RunningCard
          entry={running}
          now={now}
          serviceName={state.services.find(s => s.id === running.serviceId)?.name ?? 'Work'}
          clientName={clientName(running.clientId)}
          currency={state.settings.currency}
          onStop={() => onStop(running.id)}
        />
      ) : (
        <div className="panel start-panel">
          <h2>Track time</h2>
          {recentJobs.length > 0 && (
            <div className="resume-chips">
              <span className="quick-label">Resume</span>
              {recentJobs.map(j => (
                <button key={`${j.serviceId}-${j.clientId ?? 'gen'}`} className="chip"
                  onClick={() => resume(j)} title="Start this again">
                  <span className="chip-dot" style={{ background: j.color }} />
                  {j.label}
                </button>
              ))}
            </div>
          )}
          <div className="field-row">
            <label className="field">
              <span>Service</span>
              <select value={serviceId} onChange={e => handleServicePick(e.target.value)}>
                <option value="">Pick a service…</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.name} · {formatMoney(s.defaultRate, state.settings.currency)}/hr</option>
                ))}
                <option value={NEW_OPTION}>+ New service…</option>
              </select>
            </label>
            <label className="field">
              <span>Client</span>
              <select value={clientId} onChange={e => handleClientPick(e.target.value)}>
                <option value="">General (no client)</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value={NEW_OPTION}>+ New client…</option>
              </select>
            </label>
            <label className="field rate-field">
              <span>Rate /hr</span>
              <input
                type="number" min="0" step="1" inputMode="decimal"
                placeholder={String(resolvedRate)}
                value={rate}
                onChange={e => setRate(e.target.value)}
              />
            </label>
          </div>

          {/* Create-in-place, so adding a service you just remembered never
              means leaving the timer screen. */}
          {creating === 'service' && (
            <div className="inline-create">
              <input
                ref={newServiceRef}
                placeholder="New service name" value={newService}
                onChange={e => setNewService(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddService()
                  if (e.key === 'Escape') cancelCreate()
                }}
              />
              <input
                className="narrow" type="number" min="0" placeholder="$/hr"
                value={newServiceRate}
                onChange={e => setNewServiceRate(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddService()
                  if (e.key === 'Escape') cancelCreate()
                }}
              />
              <button className="btn primary" disabled={!newService.trim()} onClick={handleAddService}>Add</button>
              <button className="btn ghost" onClick={cancelCreate}>Cancel</button>
            </div>
          )}

          {creating === 'client' && (
            <div className="inline-create">
              <input
                ref={newClientRef}
                placeholder="New client name" value={newClient}
                onChange={e => setNewClient(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddClient()
                  if (e.key === 'Escape') cancelCreate()
                }}
              />
              <button className="btn primary" disabled={!newClient.trim()} onClick={handleAddClient}>Add</button>
              <button className="btn ghost" onClick={cancelCreate}>Cancel</button>
            </div>
          )}

          <label className="field">
            <span>Note (optional — e.g. "south side rock wall")</span>
            <input
              type="text" value={note} placeholder="What are you working on?"
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleStart() }}
            />
          </label>
          <button className="btn primary big" disabled={!serviceId} onClick={handleStart}>
            ▶ Start timer
          </button>
          {services.length === 0 && (
            <p className="hint tiny">
              No services yet — pick <strong>+ New service…</strong> above to make your first one.
            </p>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h3>Time log</h3>
          <button className="btn" onClick={() => setAdding(a => !a)}>
            {adding ? 'Close' : '+ Manual entry'}
          </button>
        </div>
        <div className="quick-row">
          <label className="field">
            <span>Filter by client</span>
            <select value={filterClient} onChange={e => setFilterClient(e.target.value)}>
              <option value="">All</option>
              <option value="general">General (no client)</option>
              {state.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Payment</span>
            <select value={filterPayment} onChange={e => setFilterPayment(e.target.value as PaymentState | '')}>
              <option value="">Any</option>
              <option value="unbilled">● Unbilled — still to bill</option>
              <option value="invoiced">● Invoiced — awaiting payment</option>
              <option value="paid">● Paid — collected</option>
            </select>
          </label>
        </div>
        {shown.count > 0 && (filterClient !== '' || filterPayment !== '') && (
          <p className="filter-summary">
            {shown.count} entr{shown.count === 1 ? 'y' : 'ies'} · {formatDuration(shown.seconds)}
            <span className={`filter-total ${filterPayment || 'unbilled'}`}>
              {formatMoney(shown.amount, state.settings.currency)}
            </span>
          </p>
        )}
        {adding && (
          <ManualEntryForm
            state={state}
            onAdd={(...args) => { onAddManual(...args); setAdding(false) }}
          />
        )}
      </div>

      {byDate.length === 0 ? (
        <p className="hint">No time logged yet. Start a timer above, or add a manual entry.</p>
      ) : (
        byDate.map(([date, entries]) => {
          const daySecs = entries.reduce((s, e) => s + liveSeconds(e, now), 0)
          const dayAmt = entries.reduce((s, e) => s + lineAmount(liveSeconds(e, now), e.rate), 0)
          // Least-settled state wins, so a day with anything still to bill can't
          // read as collected. Mixed days say so rather than hiding it.
          const dayState = rollupPaymentState(entries, state.invoices)
          const mixed = isMixedPayment(entries, state.invoices)
          return (
            <div key={date} className="panel">
              <div className="panel-head">
                <h3>{date === todayISO() ? 'Today' : formatDate(date)} · {formatDuration(daySecs)}</h3>
                <span
                  className={`total-pill ${dayAmt === 0 ? 'zero' : dayState}${mixed ? ' mixed' : ''}`}
                  title={dayAmt === 0 ? 'No billable value — archived or unrated work'
                    : mixed ? `Mixed — showing the least settled (${dayState})`
                    : PAY_HINT[dayState]}
                >
                  {formatMoney(dayAmt, state.settings.currency)}
                </span>
              </div>
              <ul className="entry-list">
                {entries.map(e => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    state={state}
                    now={now}
                    onUpdate={onUpdateEntry}
                    onDelete={onDeleteEntry}
                    onStop={onStop}
                    onContinue={continueEntry}
                  />
                ))}
              </ul>
            </div>
          )
        })
      )}
    </div>
  )
}

function ManualEntryForm({
  state, onAdd,
}: {
  state: TractionState
  onAdd: (serviceId: string, clientId: string | null, date: string, seconds: number, rate: number, note: string) => void
}) {
  const services = state.services.filter(s => !s.archived)
  const [serviceId, setServiceId] = useState('')
  const [clientId, setClientId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  const [rate, setRate] = useState('')
  const [note, setNote] = useState('')

  const selected = services.find(s => s.id === serviceId)
  const selectedClient = clientId ? (state.clients.find(c => c.id === clientId) ?? null) : null
  const effectiveRate = rate !== '' ? Number(rate) : resolveRate(selected, selectedClient)

  function submit() {
    if (!serviceId) return
    const secs = (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60
    if (secs <= 0) return
    onAdd(serviceId, clientId || null, date, secs, effectiveRate, note.trim())
  }

  return (
    <div className="manual-form">
      <div className="field-row">
        <label className="field"><span>Service</span>
          <select value={serviceId} onChange={e => { setServiceId(e.target.value); setRate('') }}>
            <option value="">Pick…</option>
            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className="field"><span>Client</span>
          <select value={clientId} onChange={e => setClientId(e.target.value)}>
            <option value="">General (no client)</option>
            {state.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label className="field"><span>Date</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      </div>
      <div className="field-row">
        <label className="field narrow-field"><span>Hours</span>
          <input type="number" min="0" value={hours} onChange={e => setHours(e.target.value)} /></label>
        <label className="field narrow-field"><span>Minutes</span>
          <input type="number" min="0" max="59" value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
        <label className="field narrow-field"><span>Rate /hr</span>
          <input type="number" min="0" placeholder={String(resolveRate(selected, selectedClient))}
            value={rate} onChange={e => setRate(e.target.value)} /></label>
        <label className="field"><span>Note</span>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="optional" /></label>
      </div>
      <button className="btn primary" disabled={!serviceId} onClick={submit}>Add entry</button>
    </div>
  )
}

function RunningCard({
  entry, now, serviceName, clientName, currency, onStop,
}: {
  entry: TimeEntry
  now: number
  serviceName: string
  clientName: string | null
  currency: string
  onStop: () => void
}) {
  const secs = liveSeconds(entry, now)
  return (
    <div className="panel running-card">
      <div className="running-meta">
        <span className="running-dot" />
        <div>
          <div className="running-title">{serviceName}</div>
          <div className="running-sub">
            {clientName ?? 'General'}{entry.note ? ` · ${entry.note}` : ''} · {formatMoney(entry.rate, currency)}/hr
          </div>
        </div>
      </div>
      <div className="running-clock">{formatClock(secs)}</div>
      <div className="running-amount">{formatMoney(lineAmount(secs, entry.rate), currency)}</div>
      <button className="btn danger big" onClick={onStop}>■ Stop</button>
    </div>
  )
}
