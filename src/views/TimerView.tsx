import { useMemo, useState } from 'react'
import type { Client, DurationStyle, Service, SettledHow, TimeEntry, TractionState } from '../types'
import {
  formatClock, formatDate, formatDuration, formatMoney, liveSeconds, lineAmount, resolveRate, todayISO,
  paymentStateOf, rollupPaymentState, isMixedPayment, daysBetween, jobKey, isFavorite,
  clientColor, epochFromDateTime, toTimeInput, validateRange, dateFromEpoch,
  clientFullName, clientShortName, entryAmount, isFlat,
  SETTLED_TIME_LABELS, SETTLED_TIME_OPTIONS,
  type PaymentState,
} from '../store'
import { useNow } from '../useNow'
import { ClientLabel } from '../Chrome'
import { DurationFields, DurationToggle } from './DurationFields'
import { EntryRow } from './EntryRow'
import { Picker } from './Picker'

/** How many recent jobs to offer alongside the pinned ones. */
const RECENT_LIMIT = 6

/**
 * Jobs in the one-tap "Again" grid. Four, in a 2x2 — enough that the handful of
 * jobs a week actually consists of are all one tap away, few enough that the
 * grid stays thumb-sized and the start form is still on screen under it.
 */
const AGAIN_SLOTS = 4

/**
 * Clients shown in the invoice nudge before it collapses behind a "show more".
 * The list is sorted by amount, so the few that matter are always the visible
 * ones — and a busy month can't turn the timer screen into a wall of reminders.
 */
const NUDGE_PREVIEW = 3

/**
 * Don't nag about a job you finished an hour ago — wait until work has had a
 * chance to accumulate. Tuned low enough that a single day's work still
 * surfaces within the week.
 */
const NUDGE_AFTER_DAYS = 3

const PAY_HINT: Record<PaymentState, string> = {
  unbilled: "Not on an invoice yet — this is money you still have to bill",
  settled: 'Closed without an invoice — gifted, traded or written off',
  invoiced: 'On an invoice, waiting to be paid',
  paid: "Paid — you've collected this",
}

export function TimerView({
  state, onStart, onStop, onUpdateEntry, onDeleteEntry, onAddManual, onAddService, onAddClient,
  onGoInvoice, onAttachPhoto, onRemovePhoto, onToggleFavorite, onSetDurationFormat,
  onSettleEntry,
}: {
  state: TractionState
  onGoInvoice: (clientId?: string) => void
  onAttachPhoto: (entryId: string, file: File) => Promise<void>
  onRemovePhoto: (entryId: string) => Promise<void>
  onStart: (serviceId: string, clientId: string | null, rate: number, note: string) => void
  onStop: (id: string) => void
  onUpdateEntry: (e: TimeEntry) => void
  onDeleteEntry: (id: string) => void
  onAddManual: (serviceId: string, clientId: string | null, startedAt: number, seconds: number, rate: number, note: string, flatAmount?: number | null) => void
  onAddService: (name: string, rate: number) => Service
  onAddClient: (name: string) => Client
  onToggleFavorite: (serviceId: string, clientId: string | null) => void
  onSetDurationFormat: (style: DurationStyle) => void
  onSettleEntry: (id: string, how: SettledHow | null, note?: string) => void
}) {
  const services = state.services.filter(s => !s.archived)
  const clients = state.clients.filter(c => !c.archived)
  const running = state.entries.find(e => e.runningSince) ?? null
  const now = useNow(!!running)

  const [serviceId, setServiceId] = useState('')
  const [clientId, setClientId] = useState('')
  const [note, setNote] = useState('')
  const [rate, setRate] = useState('')

  // History controls (absorbed from the old separate Log tab)
  const [filterClient, setFilterClient] = useState('')
  const [filterPayment, setFilterPayment] = useState<PaymentState | ''>('')
  const [adding, setAdding] = useState(false)
  const [allNudges, setAllNudges] = useState(false)
  /** Which nudge rows are opened up to show the work behind the number. */
  const [openNudges, setOpenNudges] = useState<Set<string>>(new Set())
  const toggleNudge = (id: string) => setOpenNudges(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const selectedService = services.find(s => s.id === serviceId)
  const selectedClient = clientId ? (clients.find(c => c.id === clientId) ?? null) : null
  const resolvedRate = resolveRate(selectedService, selectedClient)
  const effectiveRate = rate !== '' ? Number(rate) : resolvedRate

  const clientName = (id: string | null) => id ? clientShortName(state.clients.find(c => c.id === id)) : null
  const durationStyle = state.settings.durationFormat ?? 'hm'

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
      amount: all.reduce((s, e) => s + entryAmount(e, liveSeconds(e, now)), 0),
    }
  }, [byDate, now])

  /**
   * Clients sitting on billable unbilled work that's had time to settle.
   * The whole point is that invoicing stops depending on remembering to check:
   * finished work surfaces itself, with the amount already totalled.
   */
  const readyToInvoice = useMemo(() => {
    const today = todayISO()
    const byClient = new Map<string, { amount: number; oldest: string; entries: TimeEntry[] }>()
    for (const e of state.entries) {
      // Rate 0 is archived/unrated work — there's nothing to bill for it.
      if (!e.clientId || e.invoiceId || e.runningSince || e.settled) continue
      // Rate 0 is archived/unrated work — nothing to bill, unless a flat price
      // was agreed, which is exactly the case that has no rate.
      if (e.rate === 0 && !isFlat(e)) continue
      const cur = byClient.get(e.clientId) ?? { amount: 0, oldest: e.date, entries: [] }
      cur.amount += entryAmount(e)
      cur.entries.push(e)
      if (e.date < cur.oldest) cur.oldest = e.date
      byClient.set(e.clientId, cur)
    }
    return [...byClient.entries()]
      .map(([id, v]) => ({
        id,
        amount: v.amount,
        oldest: v.oldest,
        count: v.entries.length,
        // Newest first, matching the time log below it.
        entries: [...v.entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
        name: clientFullName(state.clients.find(c => c.id === id)),
        age: daysBetween(v.oldest, today),
      }))
      .filter(c => c.age >= NUDGE_AFTER_DAYS)
      .sort((a, b) => b.amount - a.amount)
  }, [state.entries, state.clients])

  /**
   * The one-tap start list: the four jobs you did most recently in a grid, then
   * pins and older recents as chips beneath.
   *
   * The grid used to be a single "Again" button for the very last job, which
   * only ever helped on the day you did that one thing — a Tuesday of four
   * different yards left three of them two dropdowns away. Four unique jobs
   * covers a realistic day at the same one-tap cost.
   *
   * Recency alone is still only enough while the client list is short: once a
   * week holds a dozen jobs, the thing you do every Tuesday has been pushed off
   * the end by Thursday, which is where pinning earns its keep. Pins lead the
   * chip row and never age out; older recents fill the rest.
   */
  const { againJobs, quickJobs } = useMemo(() => {
    const describe = (sid: string, cid: string | null) => {
      const svc = state.services.find(s => s.id === sid)
      // A job whose service was deleted or archived can't be started any more.
      if (!svc || svc.archived) return null
      const client = cid ? (state.clients.find(c => c.id === cid) ?? null) : null
      return {
        key: jobKey(sid, cid), serviceId: sid, clientId: cid, color: svc.color,
        serviceName: svc.name,
        clientName: client ? clientShortName(client) : null,
        clientColor: clientColor(client),
        label: client ? `${svc.name} · ${clientFullName(client)}` : svc.name,
      }
    }

    const recentFirst = [...state.entries].sort((a, b) => b.createdAt - a.createdAt)

    const seen = new Set<string>()
    const again: NonNullable<ReturnType<typeof describe>>[] = []
    for (const e of recentFirst) {
      if (again.length >= AGAIN_SLOTS) break
      const job = describe(e.serviceId, e.clientId)
      if (!job || seen.has(job.key)) continue
      seen.add(job.key)
      again.push(job)
    }

    const jobs: (NonNullable<ReturnType<typeof describe>> & { pinned: boolean })[] = []
    for (const f of state.settings.favorites ?? []) {
      const job = describe(f.serviceId, f.clientId)
      if (!job || seen.has(job.key)) continue
      seen.add(job.key)
      jobs.push({ ...job, pinned: true })
    }
    let recents = 0
    for (const e of recentFirst) {
      if (recents >= RECENT_LIMIT) break
      const job = describe(e.serviceId, e.clientId)
      if (!job || seen.has(job.key)) continue
      seen.add(job.key)
      jobs.push({ ...job, pinned: false })
      recents++
    }
    return { againJobs: again, quickJobs: jobs }
  }, [state.entries, state.services, state.clients, state.settings.favorites])

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

  const shownNudges = allNudges ? readyToInvoice : readyToInvoice.slice(0, NUDGE_PREVIEW)
  const hiddenNudgeTotal = readyToInvoice
    .slice(NUDGE_PREVIEW)
    .reduce((sum, c) => sum + c.amount, 0)

  /**
   * A service created mid-flow has no default rate yet — there's nowhere to ask
   * for one without turning a two-tap action into a form. The entry snapshots
   * whatever the Rate field says, so the work still bills correctly; the hint
   * below the field points at the gap.
   */
  function createService(name: string): string {
    return onAddService(name, 0).id
  }

  const pinned = !!serviceId && isFavorite(state.settings.favorites, serviceId, clientId || null)

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
          {/* One tap from a cold start, for any of the last four jobs — no
              pickers, no scrolling, all four targets the same size. */}
          {againJobs.length > 0 && (
            <div className="again-grid">
              {againJobs.map(j => (
                <button key={j.key} className="btn again-btn" onClick={() => resume(j)}
                  title={`Start ${j.label} again`}>
                  <span className="again-svc">
                    <span className="chip-dot" style={{ background: j.color }} />
                    {j.serviceName}
                  </span>
                  <ClientLabel name={j.clientName} color={j.clientColor} />
                </button>
              ))}
            </div>
          )}
          {quickJobs.length > 0 && (
            <div className="resume-chips">
              {quickJobs.map(j => (
                <span key={j.key} className={`chip-pair ${j.pinned ? 'pinned' : ''}`}>
                  <button className="chip" onClick={() => resume(j)} title="Start this again">
                    <span className="chip-dot" style={{ background: j.color }} />
                    {j.label}
                  </button>
                  <button
                    className={`chip-pin ${j.pinned ? 'on' : ''}`}
                    onClick={() => onToggleFavorite(j.serviceId, j.clientId)}
                    title={j.pinned ? 'Unpin this job' : 'Pin this job so it stays here'}
                    aria-pressed={j.pinned}
                  >
                    {j.pinned ? '★' : '☆'}
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="field-row">
            <Picker
              label="Service"
              value={serviceId || null}
              placeholder="Search services…"
              createLabel="New service"
              options={services.map(s => ({
                id: s.id, label: s.name, color: s.color,
                hint: `${formatMoney(s.defaultRate, state.settings.currency)}/hr`,
              }))}
              onChange={id => { setServiceId(id ?? ''); setRate('') }}
              onCreate={createService}
            />
            <Picker
              label="Client"
              value={clientId || null}
              placeholder="Search clients…"
              createLabel="New client"
              noneLabel="General (no client)"
              options={clients.map(c => ({ id: c.id, label: clientFullName(c), hint: c.phone || undefined }))}
              onChange={id => setClientId(id ?? '')}
              onCreate={name => onAddClient(name).id}
            />
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

          <div className="start-row">
            <button className="btn primary big" disabled={!serviceId} onClick={handleStart}>
              ▶ Start timer
            </button>
            {serviceId && (
              <button
                className={`btn pin-btn ${pinned ? 'on' : ''}`}
                onClick={() => onToggleFavorite(serviceId, clientId || null)}
                title={pinned ? 'Unpin this job' : 'Pin this job for one-tap starts'}
                aria-pressed={pinned}
              >
                {pinned ? '★ Pinned' : '☆ Pin'}
              </button>
            )}
          </div>

          {serviceId && effectiveRate === 0 && (
            <p className="hint tiny">
              This job has no rate — it'll log time but bill $0. Type a rate above, or set a
              default for the service under <strong>Services</strong>.
            </p>
          )}
          {services.length === 0 && (
            <p className="hint tiny">
              No services yet — open <strong>Service</strong> above, type a name, and pick
              <strong> + New service</strong>.
            </p>
          )}
        </div>
      )}

      {/* Below the timer, deliberately. This is the most valuable panel in the
          app but it isn't why you opened it — on a phone it used to push the
          start button off-screen, so the thing you came to do stayed hidden
          behind the thing you should do later. */}
      {readyToInvoice.length > 0 && (
        <div className="panel nudge-panel">
          <div className="panel-head">
            <h3>Ready to invoice</h3>
            <span className="dim tiny">unbilled for {NUDGE_AFTER_DAYS}+ days</span>
          </div>
          <ul className="nudge-list">
            {shownNudges.map(c => {
              const open = openNudges.has(c.id)
              return (
                <li key={c.id} className={`nudge-item ${open ? 'open' : ''}`}>
                  <div className="nudge-row">
                    {/* Opening the row is the point: before committing to an
                        invoice you want to see the hours it is made of, without
                        leaving the screen for the builder. */}
                    <button
                      className="nudge-who"
                      onClick={() => toggleNudge(c.id)}
                      aria-expanded={open}
                      title={open ? 'Hide these hours' : 'Show the hours behind this'}
                    >
                      <strong>
                        <span className="nudge-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
                        {c.name}
                      </strong>
                      {/* Year dropped on purpose — it always reads as the current
                          one here, and the full date wrapped to two lines on a phone. */}
                      <span className="dim tiny">
                        {c.count} entr{c.count === 1 ? 'y' : 'ies'} · oldest {formatDate(c.oldest).replace(/,.*$/, '')} · {c.age}d
                      </span>
                    </button>
                    <span className="nudge-amt">{formatMoney(c.amount, state.settings.currency)}</span>
                    <button className="btn nudge-go" onClick={() => onGoInvoice(c.id)}>Invoice →</button>
                  </div>
                  {open && (
                    <ul className="nudge-entries">
                      {c.entries.map(e => (
                        <NudgeEntry
                          key={e.id}
                          entry={e}
                          state={state}
                          durationStyle={durationStyle}
                          onSettle={onSettleEntry}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
          {readyToInvoice.length > NUDGE_PREVIEW && (
            <button className="btn ghost nudge-more" onClick={() => setAllNudges(v => !v)}>
              {allNudges
                ? 'Show fewer'
                : `Show ${readyToInvoice.length - NUDGE_PREVIEW} more · ${formatMoney(hiddenNudgeTotal, state.settings.currency)}`}
            </button>
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
          {/* "All" is the empty selection here, so General has to be a real
              option rather than the picker's none-row. */}
          <Picker
            label="Filter by client"
            value={filterClient || null}
            noneLabel="All clients"
            placeholder="Search clients…"
            options={[
              { id: 'general', label: 'General (no client)' },
              ...state.clients.map(c => ({ id: c.id, label: clientFullName(c) })),
            ]}
            onChange={id => setFilterClient(id ?? '')}
          />
          <label className="field">
            <span>Payment</span>
            <select value={filterPayment} onChange={e => setFilterPayment(e.target.value as PaymentState | '')}>
              <option value="">Any</option>
              <option value="unbilled">● Unbilled — still to bill</option>
              <option value="settled">● Settled — gifted, traded, written off</option>
              <option value="invoiced">● Invoiced — awaiting payment</option>
              <option value="paid">● Paid — collected</option>
            </select>
          </label>
        </div>
        {shown.count > 0 && (filterClient !== '' || filterPayment !== '') && (
          <p className="filter-summary">
            {shown.count} entr{shown.count === 1 ? 'y' : 'ies'} · {formatDuration(shown.seconds, durationStyle)}
            <span className={`filter-total ${filterPayment || 'unbilled'}`}>
              {formatMoney(shown.amount, state.settings.currency)}
            </span>
          </p>
        )}
        {adding && (
          <ManualEntryForm
            state={state}
            durationStyle={durationStyle}
            onSetDurationFormat={onSetDurationFormat}
            onAdd={(...args) => { onAddManual(...args); setAdding(false) }}
          />
        )}
      </div>

      {byDate.length === 0 ? (
        <p className="hint">No time logged yet. Start a timer above, or add a manual entry.</p>
      ) : (
        byDate.map(([date, entries]) => {
          const daySecs = entries.reduce((s, e) => s + liveSeconds(e, now), 0)
          const dayAmt = entries.reduce((s, e) => s + entryAmount(e, liveSeconds(e, now)), 0)
          // Least-settled state wins, so a day with anything still to bill can't
          // read as collected. Mixed days say so rather than hiding it.
          const dayState = rollupPaymentState(entries, state.invoices)
          const mixed = isMixedPayment(entries, state.invoices)
          return (
            <div key={date} className="panel">
              <div className="panel-head">
                <h3>{date === todayISO() ? 'Today' : formatDate(date)} · {formatDuration(daySecs, durationStyle)}</h3>
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
                    onAttachPhoto={onAttachPhoto}
                    onRemovePhoto={onRemovePhoto}
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

/** A fresh manual entry defaults to the hour you just finished, not to 9am. */
const MANUAL_DEFAULT_SECONDS = 3600

/** Round an epoch down to a 5-minute mark — nobody hand-logs to the minute. */
function roundTo5(ms: number): number {
  return Math.floor(ms / 300_000) * 300_000
}

/**
 * One line of work inside an opened "Ready to invoice" row.
 *
 * Carries its own settle control, because the moment you are looking at the
 * hours behind a number is exactly the moment you notice the one you meant to
 * give away. Sending someone to another screen to deal with it is how it ends
 * up on the invoice by accident.
 */
function NudgeEntry({
  entry, state, durationStyle, onSettle,
}: {
  entry: TimeEntry
  state: TractionState
  durationStyle: DurationStyle
  onSettle: (id: string, how: SettledHow | null, note?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [how, setHow] = useState<SettledHow>('gift')
  const [note, setNote] = useState('')
  const service = state.services.find(s => s.id === entry.serviceId)

  return (
    <li className={open ? 'settling' : ''}>
      <span className="ne-date">{formatDate(entry.date).replace(/,.*$/, '')}</span>
      <span className="chip-dot" style={{ background: service?.color ?? '#64748b' }} />
      <span className="ne-svc">
        {service?.name ?? 'Unknown'}
        {entry.note && <span className="dim"> · {entry.note}</span>}
      </span>
      <span className="ne-dur">
        {isFlat(entry) ? 'flat' : formatDuration(entry.seconds, durationStyle)}
      </span>
      <span className="ne-amt">{formatMoney(entryAmount(entry), state.settings.currency)}</span>
      <button
        className="icon-btn ne-settle"
        title="Close this out without invoicing"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >✓</button>

      {open && (
        <div className="row-drawer ne-drawer">
          <span className="drawer-label">Close this out without invoicing</span>
          <div className="settle-opts">
            {SETTLED_TIME_OPTIONS.map(o => (
              <button key={o} type="button" className={`chip ${how === o ? 'sel' : ''}`}
                onClick={() => setHow(o)}>{SETTLED_TIME_LABELS[o]}</button>
            ))}
          </div>
          <input
            placeholder="Why? (optional — e.g. quick freebie while I was there)"
            value={note} onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSettle(entry.id, how, note.trim()) }}
          />
          <div className="drawer-actions">
            <button className="btn primary tiny" onClick={() => onSettle(entry.id, how, note.trim())}>
              Close it out
            </button>
            <button className="btn ghost tiny" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          <p className="hint tiny">
            The hours stay in your log and still count as hours worked. They stop being
            money owed, and are left out of earnings — a freebie is not income.
          </p>
        </div>
      )}
    </li>
  )
}

function ManualEntryForm({
  state, durationStyle, onSetDurationFormat, onAdd,
}: {
  state: TractionState
  durationStyle: DurationStyle
  onSetDurationFormat: (style: DurationStyle) => void
  onAdd: (serviceId: string, clientId: string | null, startedAt: number, seconds: number, rate: number, note: string, flatAmount?: number | null) => void
}) {
  const services = state.services.filter(s => !s.archived)
  const [serviceId, setServiceId] = useState('')
  const [clientId, setClientId] = useState('')
  const [rate, setRate] = useState('')
  const [note, setNote] = useState('')
  /** A price agreed for the job, replacing hours x rate. */
  const [flat, setFlat] = useState('')
  const flatOn = flat.trim() !== ''

  /**
   * Day, start clock and end clock are three separate controls, and the day is
   * deliberately not folded into two datetime-locals: re-dating an entry to
   * last Tuesday would then drag both times around with it, and a phone's
   * date+time wheel is two spins where a time wheel is one.
   *
   * Seeded to the hour you just finished rather than a fixed 9am. The old form
   * only asked for a duration and stamped every manual entry as starting at
   * 09:00, which then printed on the invoice as a time you demonstrably were
   * not there.
   */
  const [seed] = useState(() => roundTo5(Date.now()))
  const [date, setDate] = useState(() => dateFromEpoch(seed))
  const [start, setStart] = useState(() => toTimeInput(seed - MANUAL_DEFAULT_SECONDS * 1000))
  const [end, setEnd] = useState(() => toTimeInput(seed))

  const now = useNow(true, 30_000)
  const startedAt = epochFromDateTime(date, start)
  const endedAt = epochFromDateTime(date, end)
  const secs = startedAt != null && endedAt != null
    ? Math.max(0, Math.round((endedAt - startedAt) / 1000))
    : 0
  const problem = startedAt != null && endedAt != null
    ? validateRange(startedAt, endedAt, now)
    : { field: 'start' as const, message: 'Pick a day and a start and end time.' }

  /** Typing a duration moves the END, exactly as it does when editing an entry. */
  function setDuration(seconds: number) {
    if (startedAt == null) return
    setEnd(toTimeInput(startedAt + Math.max(0, seconds) * 1000))
  }

  const selected = services.find(s => s.id === serviceId)
  const selectedClient = clientId ? (state.clients.find(c => c.id === clientId) ?? null) : null
  const effectiveRate = rate !== '' ? Number(rate) : resolveRate(selected, selectedClient)

  function submit() {
    // A flat job may legitimately have no hours at all — the price is the point.
    if (!serviceId || problem || startedAt == null) return
    if (!flatOn && secs <= 0) return
    onAdd(serviceId, clientId || null, startedAt, secs, effectiveRate, note.trim(),
      flatOn ? Number(flat) || 0 : null)
  }

  return (
    <div className="manual-form">
      <div className="field-row">
        <Picker
          label="Service"
          value={serviceId || null}
          placeholder="Search services…"
          options={services.map(s => ({ id: s.id, label: s.name, color: s.color }))}
          onChange={id => { setServiceId(id ?? ''); setRate('') }}
        />
        <Picker
          label="Client"
          value={clientId || null}
          noneLabel="General (no client)"
          placeholder="Search clients…"
          options={state.clients.map(c => ({ id: c.id, label: clientFullName(c) }))}
          onChange={id => setClientId(id ?? '')}
        />
        <label className="field"><span>Date</span>
          <input type="date" value={date} max={todayISO()}
            onChange={e => setDate(e.target.value)} /></label>
      </div>
      <div className="field-row time-range">
        <label className="field"><span>Start</span>
          <input type="time" value={start} onChange={e => setStart(e.target.value)} /></label>
        <span className="range-arrow" aria-hidden="true">→</span>
        <label className="field"><span>End</span>
          <input type="time" value={end} onChange={e => setEnd(e.target.value)} /></label>
      </div>
      <div className="field-row">
        <DurationFields seconds={secs} style={durationStyle} onChange={setDuration} />
        <label className="field narrow-field"><span>Rate /hr</span>
          <input type="number" min="0" placeholder={String(resolveRate(selected, selectedClient))}
            value={rate} onChange={e => setRate(e.target.value)} disabled={flatOn} /></label>
        {/* "I have $200, is that enough?" — the money was agreed as a number,
            so the hours stop deciding it. Leave blank to bill by the hour. */}
        <label className="field narrow-field"><span>Flat price</span>
          <input type="number" min="0" step="0.01" placeholder="hourly"
            value={flat} onChange={e => setFlat(e.target.value)} /></label>
        <div className="field format-field">
          <span>Show hours as</span>
          <DurationToggle value={durationStyle} onChange={onSetDurationFormat} />
        </div>
      </div>
      <div className="field-row">
        <label className="field"><span>Note</span>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="optional" /></label>
      </div>
      {problem && <p className="hint tiny err">{problem.message}</p>}
      {flatOn && (
        <p className="hint tiny">
          Flat price — this bills {formatMoney(Number(flat) || 0, state.settings.currency)} whatever
          the hours say. The time is still logged and still counts in Reports.
        </p>
      )}
      <button className="btn primary"
        disabled={!serviceId || !!problem || (!flatOn && secs <= 0)} onClick={submit}>
        Add entry
      </button>
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
