import { useMemo, useState } from 'react'
import type { Client, Service, TimeEntry, TractionState } from '../types'
import {
  formatClock, formatDuration, formatMoney, liveSeconds, lineAmount, resolveRate, todayISO,
} from '../store'
import { useNow } from '../useNow'
import { EntryRow } from './EntryRow'

export function TimerView({
  state, onStart, onStop, onUpdateEntry, onDeleteEntry, onAddService, onAddClient,
}: {
  state: TractionState
  onStart: (serviceId: string, clientId: string | null, rate: number, note: string) => void
  onStop: (id: string) => void
  onUpdateEntry: (e: TimeEntry) => void
  onDeleteEntry: (id: string) => void
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

  // Quick-add inline forms
  const [newService, setNewService] = useState('')
  const [newServiceRate, setNewServiceRate] = useState('')
  const [newClient, setNewClient] = useState('')

  const selectedService = services.find(s => s.id === serviceId)
  const selectedClient = clientId ? (clients.find(c => c.id === clientId) ?? null) : null
  const resolvedRate = resolveRate(selectedService, selectedClient)
  const effectiveRate = rate !== '' ? Number(rate) : resolvedRate

  const today = todayISO()
  const todayEntries = useMemo(
    () => state.entries
      .filter(e => e.date === today)
      .sort((a, b) => b.createdAt - a.createdAt),
    [state.entries, today],
  )
  const todaySeconds = todayEntries.reduce((sum, e) => sum + liveSeconds(e, now), 0)
  const todayTotal = todayEntries.reduce((sum, e) => sum + lineAmount(liveSeconds(e, now), e.rate), 0)

  const clientName = (id: string | null) => id ? (state.clients.find(c => c.id === id)?.name ?? null) : null

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

  function handleAddService() {
    const name = newService.trim()
    if (!name) return
    const svc = onAddService(name, Number(newServiceRate) || 0)
    setServiceId(svc.id)
    setNewService('')
    setNewServiceRate('')
  }

  function handleAddClient() {
    const name = newClient.trim()
    if (!name) return
    const c = onAddClient(name)
    setClientId(c.id)
    setNewClient('')
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
          {services.length === 0 ? (
            <p className="hint">Add a service below to start your first timer.</p>
          ) : (
            <>
              <div className="field-row">
                <label className="field">
                  <span>Service</span>
                  <select value={serviceId} onChange={e => { setServiceId(e.target.value); setRate('') }}>
                    <option value="">Pick a service…</option>
                    {services.map(s => (
                      <option key={s.id} value={s.id}>{s.name} · {formatMoney(s.defaultRate, state.settings.currency)}/hr</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Client</span>
                  <select value={clientId} onChange={e => setClientId(e.target.value)}>
                    <option value="">General (no client)</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
            </>
          )}

          <div className="quick-add-grid">
            <div className="quick-add">
              <span className="quick-label">+ New service</span>
              <div className="quick-row">
                <input placeholder="Service name" value={newService}
                  onChange={e => setNewService(e.target.value)} />
                <input className="narrow" type="number" min="0" placeholder="$/hr" value={newServiceRate}
                  onChange={e => setNewServiceRate(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddService() }} />
                <button className="btn" onClick={handleAddService}>Add</button>
              </div>
            </div>
            <div className="quick-add">
              <span className="quick-label">+ New client</span>
              <div className="quick-row">
                <input placeholder="Client name" value={newClient}
                  onChange={e => setNewClient(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddClient() }} />
                <button className="btn" onClick={handleAddClient}>Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h3>Today · {formatDuration(todaySeconds)}</h3>
          <span className="total-pill">{formatMoney(todayTotal, state.settings.currency)}</span>
        </div>
        {todayEntries.length === 0 ? (
          <p className="hint">No time logged today yet.</p>
        ) : (
          <ul className="entry-list">
            {todayEntries.map(e => (
              <EntryRow
                key={e.id}
                entry={e}
                state={state}
                now={now}
                onUpdate={onUpdateEntry}
                onDelete={onDeleteEntry}
                onStop={onStop}
              />
            ))}
          </ul>
        )}
      </div>
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
