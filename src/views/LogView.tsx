import { useMemo, useState } from 'react'
import type { TimeEntry, TractionState } from '../types'
import { formatDate, formatDuration, formatMoney, liveSeconds, lineAmount, todayISO } from '../store'
import { EntryRow } from './EntryRow'
import { useNow } from '../useNow'

export function LogView({
  state, onUpdateEntry, onDeleteEntry, onAddManual,
}: {
  state: TractionState
  onUpdateEntry: (e: TimeEntry) => void
  onDeleteEntry: (id: string) => void
  onAddManual: (serviceId: string, clientId: string | null, date: string, seconds: number, rate: number, note: string) => void
}) {
  const anyRunning = state.entries.some(e => e.runningSince)
  const now = useNow(anyRunning)
  const [filterClient, setFilterClient] = useState('')
  const [adding, setAdding] = useState(false)

  const filtered = useMemo(() => {
    return state.entries
      .filter(e => filterClient === '' ? true : (filterClient === 'general' ? !e.clientId : e.clientId === filterClient))
      .sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt)
  }, [state.entries, filterClient])

  // Group by date for readability.
  const byDate = useMemo(() => {
    const map = new Map<string, TimeEntry[]>()
    for (const e of filtered) {
      const arr = map.get(e.date) ?? []
      arr.push(e)
      map.set(e.date, arr)
    }
    return [...map.entries()]
  }, [filtered])

  return (
    <div className="view">
      <div className="panel">
        <div className="panel-head">
          <h2>Time log</h2>
          <button className="btn primary" onClick={() => setAdding(a => !a)}>
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
        </div>
        {adding && (
          <ManualEntryForm
            state={state}
            onAdd={(...args) => { onAddManual(...args); setAdding(false) }}
          />
        )}
      </div>

      {byDate.length === 0 ? (
        <p className="hint">No entries yet. Track time on the Timer tab, or add a manual entry.</p>
      ) : (
        byDate.map(([date, entries]) => {
          const daySecs = entries.reduce((s, e) => s + liveSeconds(e, now), 0)
          const dayAmt = entries.reduce((s, e) => s + lineAmount(liveSeconds(e, now), e.rate), 0)
          return (
            <div key={date} className="panel">
              <div className="panel-head">
                <h3>{formatDate(date)}</h3>
                <span className="total-pill">{formatDuration(daySecs)} · {formatMoney(dayAmt, state.settings.currency)}</span>
              </div>
              <ul className="entry-list">
                {entries.map(e => (
                  <EntryRow key={e.id} entry={e} state={state} now={now}
                    onUpdate={onUpdateEntry} onDelete={onDeleteEntry} showDate />
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
  const effectiveRate = rate !== '' ? Number(rate) : (selected?.defaultRate ?? 0)

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
          <input type="number" min="0" placeholder={String(selected?.defaultRate ?? 0)}
            value={rate} onChange={e => setRate(e.target.value)} /></label>
        <label className="field"><span>Note</span>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="optional" /></label>
      </div>
      <button className="btn primary" disabled={!serviceId} onClick={submit}>Add entry</button>
    </div>
  )
}
