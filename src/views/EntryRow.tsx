import { useState } from 'react'
import type { TimeEntry, TractionState } from '../types'
import {
  formatClock, formatDuration, formatMoney, liveSeconds, lineAmount,
  toLocalInput, fromLocalInput, dateFromEpoch, validateRange, entrySpan, formatTimeOfDay,
  paymentStateOf, clientColor, clientFullName, clientShortName,
} from '../store'
import { useNow } from '../useNow'
import { ClientLabel } from '../Chrome'
import { DurationFields } from './DurationFields'
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
  const client = entry.clientId
    ? (state.clients.find(c => c.id === entry.clientId) ?? null)
    : null
  const clientName = entry.clientId ? clientShortName(client) : null
  const durationStyle = state.settings.durationFormat ?? 'hm'
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
          <ClientLabel name={clientName} color={clientColor(client)} />
          {showDate && <span> · {entry.date}</span>}
          {span && (
            <span className="entry-span"> · {formatTimeOfDay(span.start)}–{formatTimeOfDay(span.end)}</span>
          )}
          {isRunning && entry.startedAt != null && (
            <span className="entry-span"> · {formatTimeOfDay(entry.startedAt)}–now</span>
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
        <span className="entry-dur">{isRunning ? 'running…' : formatDuration(secs, durationStyle)}</span>
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
        {/* Available while running too: re-timing a live timer (you started it
            20 minutes late) is exactly when you most want to fix the start. */}
        {!invoiced && (
          <button
            className="icon-btn"
            title={isRunning ? 'Edit — including the start time' : 'Edit'}
            onClick={() => setEditing(true)}
          >✎</button>
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

  const wasRunning = !!entry.runningSince

  /**
   * Start and end are two INDEPENDENT values, exactly like Toggl: moving one
   * never drags the other along, it only changes the duration between them.
   *
   * The old model stored start + duration and derived the end, which meant
   * pushing the start back 15 minutes silently pushed the end back 15 minutes
   * too — you could never actually correct one edge of an entry. Duration is
   * now the derived value, because it's the one nobody types a specific truth
   * about: "I started at 11:29" is a fact, "it was 5h 12m" is a consequence.
   */
  const [start, setStart] = useState(() => seedStart(entry))
  /** null = no end yet, i.e. still running. Only reachable on a live entry. */
  const [end, setEnd] = useState<number | null>(
    () => wasRunning ? null : seedStart(entry) + entry.seconds * 1000,
  )

  // Ticking, not frozen at open: the future guard and a live entry's duration
  // both go stale the moment the editor sits open for a minute.
  const now = useNow(true, wasRunning ? 1000 : 30_000)
  const stillRunning = wasRunning && end == null
  const maxInput = toLocalInput(now)
  const secs = Math.max(0, Math.round(((end ?? now) - start) / 1000))
  const problem = validateRange(start, end ?? Math.max(start, now), now)
  const untimed = entry.startedAt == null

  function onStartChange(value: string) {
    const ms = fromLocalInput(value)
    if (ms == null) return
    setStart(ms) // the end stays exactly where the user left it
  }

  function onEndChange(value: string) {
    // Clearing the end of a live entry means "never mind, keep it running".
    if (value === '' && wasRunning) { setEnd(null); return }
    const ms = fromLocalInput(value)
    if (ms == null) return
    setEnd(ms) // the start stays exactly where the user left it
  }

  /** Typing a duration moves the END and pins the start — Toggl's behaviour. */
  function setDuration(seconds: number) {
    setEnd(start + Math.max(0, seconds) * 1000)
  }

  function nudgeEnd(deltaMin: number) {
    setEnd(e => (e ?? now) + deltaMin * 60_000)
  }

  function save() {
    if (problem) return
    const base = {
      ...entry,
      serviceId,
      clientId: clientId || null,
      note: note.trim(),
      startedAt: start,
      date: dateFromEpoch(start), // billed day always follows the start time
      rate: Number(rate) || 0,
    }
    onSave(stillRunning
      // Re-anchor the live span to the new start so the running clock and the
      // billed seconds keep telling the same story.
      ? { ...base, seconds: 0, runningSince: start }
      // Giving a running entry an end time stops it there, as it does on Toggl.
      : { ...base, seconds: secs, runningSince: null })
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
          options={state.clients.map(c => ({ id: c.id, label: clientFullName(c) }))}
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
            value={end == null ? '' : toLocalInput(end)}
            max={maxInput}
            placeholder="running"
            onChange={e => onEndChange(e.target.value)}
          />
        </label>
      </div>

      {stillRunning ? (
        <div className="field-row">
          <div className="field">
            <span>Running</span>
            <div className="running-inline">{formatClock(secs)}</div>
          </div>
        </div>
      ) : (
        <div className="field-row">
          <DurationFields
            seconds={secs}
            style={state.settings.durationFormat ?? 'hm'}
            onChange={setDuration}
          />
          <div className="field nudge-field">
            <span>Adjust end</span>
            <div className="nudge-btns">
              <button type="button" className="btn ghost tiny" onClick={() => nudgeEnd(-15)}>−15m</button>
              <button type="button" className="btn ghost tiny" onClick={() => nudgeEnd(-5)}>−5m</button>
              <button type="button" className="btn ghost tiny" onClick={() => nudgeEnd(5)}>+5m</button>
              <button type="button" className="btn ghost tiny" onClick={() => nudgeEnd(15)}>+15m</button>
            </div>
          </div>
        </div>
      )}

      <div className="field-row">
        <label className="field">
          <span>Note</span>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. south side rock wall" />
        </label>
      </div>

      {wasRunning && !problem && (
        <p className="hint tiny">
          {stillRunning
            ? 'Still running — leave End blank to keep it going. Setting an end time stops it there.'
            : `This will stop the timer at ${toLocalInput(end!).slice(11)}.`}
        </p>
      )}
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
