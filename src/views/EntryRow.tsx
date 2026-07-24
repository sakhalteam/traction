import { useState } from 'react'
import type { TimeEntry, TractionState } from '../types'
import { formatDuration, formatMoney, liveSeconds, lineAmount } from '../store'

export function EntryRow({
  entry, state, now, onUpdate, onDelete, onStop, showDate = false,
}: {
  entry: TimeEntry
  state: TractionState
  now: number
  onUpdate: (e: TimeEntry) => void
  onDelete: (id: string) => void
  onStop?: (id: string) => void
  showDate?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const service = state.services.find(s => s.id === entry.serviceId)
  const clientName = entry.clientId
    ? (state.clients.find(c => c.id === entry.clientId)?.name ?? 'Unknown')
    : 'General'
  const secs = liveSeconds(entry, now)
  const invoiced = !!entry.invoiceId
  const isRunning = !!entry.runningSince

  if (editing) {
    return (
      <li className="entry-row editing">
        <EntryEditor
          entry={entry}
          state={state}
          onSave={e => { onUpdate(e); setEditing(false) }}
          onCancel={() => setEditing(false)}
          showDate={showDate}
        />
      </li>
    )
  }

  return (
    <li className={`entry-row ${isRunning ? 'live' : ''}`}>
      <span className="entry-swatch" style={{ background: service?.color ?? '#64748b' }} />
      <div className="entry-main">
        <div className="entry-title">
          {service?.name ?? 'Unknown service'}
          {entry.note && <span className="entry-note"> · {entry.note}</span>}
        </div>
        <div className="entry-sub">
          <span className={`client-tag ${entry.clientId ? '' : 'general'}`}>{clientName}</span>
          {showDate && <span> · {entry.date}</span>}
          <span> · {formatMoney(entry.rate, state.settings.currency)}/hr</span>
          {invoiced && <span className="invoiced-tag" title="On an invoice">invoiced</span>}
        </div>
      </div>
      <div className="entry-figures">
        <span className="entry-dur">{isRunning ? 'running…' : formatDuration(secs)}</span>
        <span className="entry-amt">{formatMoney(lineAmount(secs, entry.rate), state.settings.currency)}</span>
      </div>
      <div className="entry-actions">
        {isRunning && onStop && (
          <button className="icon-btn danger" title="Stop" onClick={() => onStop(entry.id)}>■</button>
        )}
        {!isRunning && !invoiced && (
          <button className="icon-btn" title="Edit" onClick={() => setEditing(true)}>✎</button>
        )}
        {!invoiced && !isRunning && (
          <button className="icon-btn danger" title="Delete" onClick={() => onDelete(entry.id)}>✕</button>
        )}
      </div>
    </li>
  )
}

function EntryEditor({
  entry, state, onSave, onCancel, showDate,
}: {
  entry: TimeEntry
  state: TractionState
  onSave: (e: TimeEntry) => void
  onCancel: () => void
  showDate: boolean
}) {
  const [serviceId, setServiceId] = useState(entry.serviceId)
  const [clientId, setClientId] = useState(entry.clientId ?? '')
  const [note, setNote] = useState(entry.note)
  const [date, setDate] = useState(entry.date)
  const [rate, setRate] = useState(String(entry.rate))
  const [hours, setHours] = useState(String(Math.floor(entry.seconds / 3600)))
  const [minutes, setMinutes] = useState(String(Math.floor((entry.seconds % 3600) / 60)))

  function save() {
    const secs = (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60
    onSave({
      ...entry,
      serviceId,
      clientId: clientId || null,
      note: note.trim(),
      date,
      rate: Number(rate) || 0,
      seconds: secs,
    })
  }

  return (
    <div className="entry-editor">
      <div className="field-row">
        <label className="field">
          <span>Service</span>
          <select value={serviceId} onChange={e => setServiceId(e.target.value)}>
            {state.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Client</span>
          <select value={clientId} onChange={e => setClientId(e.target.value)}>
            <option value="">General (no client)</option>
            {state.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {showDate && (
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </label>
        )}
      </div>
      <div className="field-row">
        <label className="field">
          <span>Note</span>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. south side rock wall" />
        </label>
        <label className="field narrow-field">
          <span>Hours</span>
          <input type="number" min="0" value={hours} onChange={e => setHours(e.target.value)} />
        </label>
        <label className="field narrow-field">
          <span>Minutes</span>
          <input type="number" min="0" max="59" value={minutes} onChange={e => setMinutes(e.target.value)} />
        </label>
        <label className="field narrow-field">
          <span>Rate /hr</span>
          <input type="number" min="0" value={rate} onChange={e => setRate(e.target.value)} />
        </label>
      </div>
      <div className="editor-actions">
        <button className="btn primary" onClick={save}>Save</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
