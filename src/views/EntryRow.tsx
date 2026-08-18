import { useState } from 'react'
import type { TimeEntry, TractionState } from '../types'
import {
  formatDuration, formatMoney, liveSeconds, lineAmount,
  toLocalInput, fromLocalInput, dateFromEpoch, validateRange, entrySpan, formatTimeOfDay,
  paymentStateOf,
} from '../store'
import { JobPhotos } from './JobPhotos'
import { Picker } from './Picker'

export function EntryRow({
  entry, state, now, onUpdate, onDelete, onStop, onContinue, showDate = false,
  onAttachPhoto, onRemovePhoto,
}: {
  entry: TimeEntry
  state: TractionState
  now: number
  onUpdate: (e: TimeEntry) => void
  onDelete: (id: string) => void
  onAttachPhoto?: (entryId: string, file: File) => Promise<void>
  onRemovePhoto?: (entryId: string) => Promise<void>
  onStop?: (id: string) => void
  /** Toggl-style continue: starts a NEW entry carrying this one's details. */
  onContinue?: (e: TimeEntry) => void
  showDate?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const service = state.services.find(s => s.id === entry.serviceId)
  const clientName = entry.clientId
    ? (state.clients.find(c => c.id === entry.clientId)?.name ?? 'Unknown')
    : 'General'
  const secs = liveSeconds(entry, now)
  const invoiced = !!entry.invoiceId
  const payment = paymentStateOf(entry, state.invoices)
  const isRunning = !!entry.runningSince
  // Only meaningful once stopped — a running entry's end is still moving.
  const span = isRunning ? null : entrySpan(entry)

  if (editing) {
    return (
      <li className="entry-row editing">
        <EntryEditor
          entry={entry}
          state={state}
          onSave={e => { onUpdate(e); setEditing(false) }}
          onCancel={() => setEditing(false)}
        />
      </li>
    )
  }

  const photos = entry.photoPaths ?? []
  // Hidden until there's something to show or somewhere to put it, so the row
  // stays as light as it is today for anyone not using photos.
  const showPhotos = photos.length > 0 || (expanded && !!onAttachPhoto)

  return (
    <li className={`entry-row ${isRunning ? 'live' : ''} ${showPhotos ? 'has-photos' : ''}`}>
      <span className="entry-swatch" style={{ background: service?.color ?? '#64748b' }} />
      <div className="entry-main">
        <div className="entry-title">
          {service?.name ?? 'Unknown service'}
          {entry.note && <span className="entry-note"> · {entry.note}</span>}
        </div>
        <div className="entry-sub">
          <span className={`client-tag ${entry.clientId ? '' : 'general'}`}>{clientName}</span>
          {showDate && <span> · {entry.date}</span>}
          {span && (
            <span className="entry-span"> · {formatTimeOfDay(span.start)}–{formatTimeOfDay(span.end)}</span>
          )}
          <span> · {formatMoney(entry.rate, state.settings.currency)}/hr</span>
          {payment === 'paid' && (
            <span className="pay-tag paid" title="On an invoice you've marked paid">paid</span>
          )}
          {payment === 'invoiced' && (
            <span className="pay-tag invoiced" title="On an invoice, not yet paid">invoiced</span>
          )}
        </div>
      </div>
      <div className="entry-figures">
        <span className="entry-dur">{isRunning ? 'running…' : formatDuration(secs)}</span>
        {/* Colour is derived from the invoice, so it can never claim "paid"
            about work whose invoice still says draft. */}
        {/* A $0 entry (archived agency work carries no rate) is neither owed nor
            collected — colouring it "unbilled" would imply money to chase. */}
        <span className={`entry-amt ${entry.rate === 0 ? 'zero' : payment}`}>
          {formatMoney(lineAmount(secs, entry.rate), state.settings.currency)}
        </span>
      </div>
      <div className="entry-actions">
        {/* Camera toggle. Stays available on invoiced entries — a photo is a
            record of the work, not a billing input, so adding one later can't
            change what an invoice says. */}
        {onAttachPhoto && !isRunning && (
          <button
            className={`icon-btn ${photos.length > 0 ? 'has-shots' : ''}`}
            title={photos.length > 0 ? `${photos.length} job photo${photos.length === 1 ? '' : 's'}` : 'Add a job photo'}
            onClick={() => setExpanded(v => !v)}
          >
            📷{photos.length > 0 && <span className="shot-count">{photos.length}</span>}
          </button>
        )}
        {isRunning && onStop && (
          <button className="icon-btn danger" title="Stop" onClick={() => onStop(entry.id)}>■</button>
        )}
        {/* Continue works even on invoiced entries — it never touches this one,
            it starts a separate new entry with the same job details. */}
        {!isRunning && onContinue && (
          <button
            className="icon-btn continue-btn"
            title="Continue — starts a new entry with these details"
            onClick={() => onContinue(entry)}
          >
            ▶
          </button>
        )}
        {!isRunning && !invoiced && (
          <button className="icon-btn" title="Edit" onClick={() => setEditing(true)}>✎</button>
        )}
        {!invoiced && !isRunning && (
          <button className="icon-btn danger" title="Delete" onClick={() => onDelete(entry.id)}>✕</button>
        )}
      </div>
      {showPhotos && (
        <div className="entry-photos">
          <JobPhotos
            paths={photos}
            editable={!!onAttachPhoto && expanded}
            onAdd={onAttachPhoto ? f => onAttachPhoto(entry.id, f) : undefined}
            onRemove={onRemovePhoto ? () => onRemovePhoto(entry.id) : undefined}
          />
        </div>
      )}
    </li>
  )
}

/**
 * Legacy entries only ever stored a date + a duration, so they have no clock
 * time to edit. Seed them at 9am on their existing day: the billed date and
 * duration are preserved exactly, and the user can drag the times from there.
 */
const LEGACY_SEED_HOUR = 9

function seedStart(entry: TimeEntry): number {
  if (entry.startedAt != null) return entry.startedAt
  const [y, m, d] = entry.date.split('-').map(Number)
  return new Date(y, m - 1, d, LEGACY_SEED_HOUR, 0, 0, 0).getTime()
}

function EntryEditor({
  entry, state, onSave, onCancel,
}: {
  entry: TimeEntry
  state: TractionState
  onSave: (e: TimeEntry) => void
  onCancel: () => void
}) {
  const [serviceId, setServiceId] = useState(entry.serviceId)
  const [clientId, setClientId] = useState(entry.clientId ?? '')
  const [note, setNote] = useState(entry.note)
  const [rate, setRate] = useState(String(entry.rate))

  // Start + duration are the two state vars; the end time is always derived,
  // so the range and the billed seconds can never drift apart.
  const [start, setStart] = useState(() => seedStart(entry))
  const [secs, setSecs] = useState(entry.seconds)

  const end = start + secs * 1000
  const [now] = useState(() => Date.now())
  const maxInput = toLocalInput(now)
  const problem = validateRange(start, end, now)
  const untimed = entry.startedAt == null

  function onStartChange(value: string) {
    const ms = fromLocalInput(value)
    if (ms == null) return
    setStart(ms) // duration is pinned; the end time follows the start
  }

  function onEndChange(value: string) {
    const ms = fromLocalInput(value)
    if (ms == null) return
    setSecs(Math.round((ms - start) / 1000)) // may go negative → validation catches it
  }

  function setDuration(h: number, m: number) {
    setSecs(Math.max(0, h * 3600 + m * 60))
  }

  function nudgeEnd(deltaMin: number) {
    setSecs(s => Math.max(0, s + deltaMin * 60))
  }

  function save() {
    if (problem) return
    onSave({
      ...entry,
      serviceId,
      clientId: clientId || null,
      note: note.trim(),
      startedAt: start,
      date: dateFromEpoch(start), // billed day always follows the start time
      rate: Number(rate) || 0,
      seconds: secs,
    })
  }

  return (
    <div className="entry-editor">
      <div className="field-row">
        <Picker
          label="Service"
          value={serviceId || null}
          placeholder="Search services…"
          options={state.services.map(s => ({ id: s.id, label: s.name, color: s.color }))}
          onChange={id => setServiceId(id ?? serviceId)}
        />
        <Picker
          label="Client"
          value={clientId || null}
          noneLabel="General (no client)"
          placeholder="Search clients…"
          options={state.clients.map(c => ({ id: c.id, label: c.name }))}
          onChange={id => setClientId(id ?? '')}
        />
        <label className="field narrow-field">
          <span>Rate /hr</span>
          <input type="number" min="0" value={rate} onChange={e => setRate(e.target.value)} />
        </label>
      </div>

      <div className="field-row time-range">
        <label className="field">
          <span>Start</span>
          <input
            type="datetime-local"
            value={toLocalInput(start)}
            max={maxInput}
            onChange={e => onStartChange(e.target.value)}
          />
        </label>
        <span className="range-arrow" aria-hidden="true">→</span>
        <label className="field">
          <span>End</span>
          <input
            type="datetime-local"
            value={toLocalInput(end)}
            max={maxInput}
            onChange={e => onEndChange(e.target.value)}
          />
        </label>
      </div>

      <div className="field-row">
        <label className="field narrow-field">
          <span>Hours</span>
          <input
            type="number" min="0"
            value={Math.floor(Math.max(0, secs) / 3600)}
            onChange={e => setDuration(Number(e.target.value) || 0, Math.floor((Math.max(0, secs) % 3600) / 60))}
          />
        </label>
        <label className="field narrow-field">
          <span>Minutes</span>
          <input
            type="number" min="0" max="59"
            value={Math.floor((Math.max(0, secs) % 3600) / 60)}
            onChange={e => setDuration(Math.floor(Math.max(0, secs) / 3600), Number(e.target.value) || 0)}
          />
        </label>
        <div className="field nudge-field">
          <span>Adjust end</span>
          <div className="nudge-row">
            <button type="button" className="btn ghost tiny" onClick={() => nudgeEnd(-15)}>−15m</button>
            <button type="button" className="btn ghost tiny" onClick={() => nudgeEnd(-5)}>−5m</button>
            <button type="button" className="btn ghost tiny" onClick={() => nudgeEnd(5)}>+5m</button>
            <button type="button" className="btn ghost tiny" onClick={() => nudgeEnd(15)}>+15m</button>
          </div>
        </div>
      </div>

      <div className="field-row">
        <label className="field">
          <span>Note</span>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. south side rock wall" />
        </label>
      </div>

      {untimed && !problem && (
        <p className="hint tiny">
          This entry predates clock times — start was seeded at {LEGACY_SEED_HOUR}:00 on {entry.date}.
          Its duration is unchanged; adjust the times if you remember them.
        </p>
      )}
      {problem && <p className="hint tiny err">{problem.message}</p>}

      <div className="editor-actions">
        <button className="btn primary" onClick={save} disabled={!!problem}>Save</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
