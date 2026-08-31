import { useMemo, useState } from 'react'
import type { Invoice, InvoiceStatus, TractionState } from '../types'
import {
  buildBreakdown, formatDate, formatDuration, formatMoney, invoiceTotal, liveSeconds, todayISO,
  agingOf, AGING_LABELS, nextInvoiceNumber, clientFullName, entryAmount, isFlat,
  type AgingBucket,
} from '../store'
import { InvoiceDetail } from './InvoiceDetail'
import { Picker } from './Picker'

export function InvoicesView({
  state, initialClientId, onCreate, onSetStatus, onUpdate, onDelete,
  onAddCharge, onUpdateCharge, onRemoveCharge,
}: {
  state: TractionState
  /** Client to open the builder on, set when arriving from a "bill this" button. */
  initialClientId?: string | null
  onCreate: (
    clientId: string, entryIds: string[], expenseIds: string[],
    periodStart: string, periodEnd: string, opts?: { alreadyPaid?: boolean },
  ) => Invoice
  onSetStatus: (id: string, status: InvoiceStatus) => void
  onUpdate: (i: Invoice) => void
  onDelete: (id: string) => void
  onAddCharge: (invoiceId: string) => void
  onUpdateCharge: (invoiceId: string, expenseId: string, patch: { label?: string; amount?: number }) => void
  onRemoveCharge: (invoiceId: string, expenseId: string) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  const open = openId ? state.invoices.find(i => i.id === openId) : null
  if (open) {
    return (
      <InvoiceDetail
        invoice={open}
        state={state}
        onBack={() => setOpenId(null)}
        onSetStatus={onSetStatus}
        onUpdate={onUpdate}
        onDelete={id => { onDelete(id); setOpenId(null) }}
        onAddCharge={onAddCharge}
        onUpdateCharge={onUpdateCharge}
        onRemoveCharge={onRemoveCharge}
      />
    )
  }

  return (
    <div className="view no-print">
      <InvoiceBuilder
        state={state}
        initialClientId={initialClientId}
        onCreate={(...a) => { const inv = onCreate(...a); setOpenId(inv.id) }}
      />
      <InvoiceList state={state} onOpen={setOpenId} />
    </div>
  )
}

function InvoiceBuilder({
  state, initialClientId, onCreate,
}: {
  state: TractionState
  initialClientId?: string | null
  onCreate: (
    clientId: string, entryIds: string[], expenseIds: string[],
    periodStart: string, periodEnd: string, opts?: { alreadyPaid?: boolean },
  ) => void
}) {
  const clients = state.clients.filter(c => !c.archived)
  const cur = state.settings.currency
  const durationStyle = state.settings.durationFormat ?? 'hm'
  // Arriving from a "bill this client" button opens the builder ready to go;
  // it's only a starting value, so the dropdown still switches freely after.
  const [clientId, setClientId] = useState(initialClientId ?? '')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState(todayISO())
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [excludedExp, setExcludedExp] = useState<Set<string>>(new Set())

  const inRange = (date: string) => (start === '' || date >= start) && (end === '' || date <= end)

  // Unbilled, finalized time entries for this client (optionally within range).
  const candidates = useMemo(() => {
    if (!clientId) return []
    // A settled entry was gifted, traded or written off — offering it again is
    // how a freebie ends up on an invoice.
    return state.entries.filter(e =>
      e.clientId === clientId && !e.invoiceId && !e.runningSince && !e.settled && inRange(e.date))
  }, [state.entries, clientId, start, end])

  // Unbilled billable expenses for this client (optionally within range).
  const expCandidates = useMemo(() => {
    if (!clientId) return []
    // A settled expense is closed — it was paid in cash, traded or written off,
    // and offering it here again is how it ends up billed twice.
    return state.expenses.filter(x =>
      x.clientId === clientId && x.billable && !x.invoiceId && !x.settled && inRange(x.date))
  }, [state.expenses, clientId, start, end])

  const included = candidates.filter(e => !excluded.has(e.id))
  const includedExp = expCandidates.filter(x => !excludedExp.has(x.id))
  const breakdown = useMemo(() => buildBreakdown(included, state.services), [included, state.services])
  const expSum = includedExp.reduce((s, x) => s + x.amount, 0)
  const grand = Math.round((breakdown.total + expSum) * 100) / 100

  const toggle = (id: string) => setExcluded(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const toggleExp = (id: string) => setExcludedExp(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const resetClient = (id: string) => { setClientId(id); setExcluded(new Set()); setExcludedExp(new Set()) }

  function create(opts: { alreadyPaid?: boolean } = {}) {
    if (!clientId || (included.length === 0 && includedExp.length === 0)) return
    const dates = [...included.map(e => e.date), ...includedExp.map(x => x.date)].sort()
    const periodStart = start || dates[0]
    // An already-paid backfill is dated by the work itself, so ignore the "To"
    // box (which defaults to today) and use the last day actually worked.
    const lastWorked = dates[dates.length - 1]
    const periodEnd = opts.alreadyPaid ? lastWorked : (end || lastWorked)
    onCreate(clientId, included.map(e => e.id), includedExp.map(x => x.id), periodStart, periodEnd, opts)
    setExcluded(new Set()); setExcludedExp(new Set())
  }

  const nothing = candidates.length === 0 && expCandidates.length === 0
  const nothingPicked = included.length === 0 && includedExp.length === 0

  // The number this invoice would get if created right now. Shown before the
  // fact so a wrong client code is caught here, not after it's been issued.
  const previewNumber = clientId
    ? nextInvoiceNumber(state.invoices, clients.find(c => c.id === clientId), todayISO())
    : ''

  return (
    <div className="panel">
      <h2>New invoice</h2>
      <div className="field-row">
        <Picker
          label="Client"
          value={clientId || null}
          placeholder="Search clients…"
          options={clients.map(c => ({ id: c.id, label: clientFullName(c), hint: c.phone || undefined }))}
          onChange={id => resetClient(id ?? '')}
        />
        <label className="field"><span>From (optional)</span>
          <input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label className="field"><span>To</span>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
      </div>

      {clientId && (
        nothing ? (
          <p className="hint">No unbilled time or expenses for this client in that range.</p>
        ) : (
          <>
            {candidates.length > 0 && (
              <>
                <p className="hint tiny">Time — untick anything you don't want on this invoice.</p>
                <ul className="candidate-list">
                  {candidates.map(e => {
                    const svc = state.services.find(s => s.id === e.serviceId)
                    const secs = liveSeconds(e)
                    const inc = !excluded.has(e.id)
                    return (
                      <li key={e.id} className={`candidate ${inc ? '' : 'off'}`}>
                        <label>
                          <input type="checkbox" checked={inc} onChange={() => toggle(e.id)} />
                          <span className="cand-date">{formatDate(e.date)}</span>
                          <span className="cand-svc">{svc?.name ?? '—'}{e.note ? ` · ${e.note}` : ''}</span>
                          <span className="cand-dur">
                            {isFlat(e) ? 'flat' : formatDuration(secs, durationStyle)}
                          </span>
                          <span className="cand-amt">{formatMoney(entryAmount(e, secs), cur)}</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}

            {expCandidates.length > 0 && (
              <>
                <p className="hint tiny">Expenses (materials) — billable costs for this client.</p>
                <ul className="candidate-list">
                  {expCandidates.map(x => {
                    const inc = !excludedExp.has(x.id)
                    return (
                      <li key={x.id} className={`candidate ${inc ? '' : 'off'}`}>
                        <label>
                          <input type="checkbox" checked={inc} onChange={() => toggleExp(x.id)} />
                          <span className="cand-date">{formatDate(x.date)}</span>
                          <span className="cand-svc"><span className="expense-badge billable tiny">{x.category}</span> {x.label}</span>
                          <span className="cand-dur" />
                          <span className="cand-amt">{formatMoney(x.amount, cur)}</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}

            <div className="builder-foot">
              <div className="grand">
                <span className="dim">
                  {included.length} entr{included.length === 1 ? 'y' : 'ies'} · {formatDuration(breakdown.totalSeconds, durationStyle)}
                  {includedExp.length > 0 && ` + ${includedExp.length} expense${includedExp.length === 1 ? '' : 's'}`}
                  {previewNumber && <> · <span className="inv-num">{previewNumber}</span></>}
                </span>
                <span className="big-money">{formatMoney(grand, cur)}</span>
              </div>
              <div className="builder-buttons">
                {/* Records work settled outside traction — cash on the day, an
                    old paper invoice — as a closed invoice rather than a flag on
                    each entry, so paid-ness has exactly one source of truth. */}
                <button
                  className="btn" disabled={nothingPicked}
                  title="Record this as already settled — creates a closed, paid invoice"
                  onClick={() => {
                    if (confirm(`Record ${formatMoney(grand, cur)} as ALREADY PAID?\n\nThis closes these `
                      + `${included.length} entr${included.length === 1 ? 'y' : 'ies'} out as a paid invoice, `
                      + `so they'll stop showing as unbilled. Use this for work you were paid for outside traction.`)) {
                      create({ alreadyPaid: true })
                    }
                  }}
                >
                  ✓ Already paid
                </button>
                <button className="btn primary big" disabled={nothingPicked} onClick={() => create()}>
                  Create invoice
                </button>
              </div>
            </div>
          </>
        )
      )}
    </div>
  )
}

function InvoiceList({ state, onOpen }: { state: TractionState; onOpen: (id: string) => void }) {
  const invoices = [...state.invoices].sort((a, b) => b.createdAt - a.createdAt)
  const cur = state.settings.currency

  const today = todayISO()

  // Accounts receivable: sent-but-unpaid = money owed; draft = not yet billed out.
  // Outstanding money is also split by how far past its due date it is.
  const ar = useMemo(() => {
    let outstanding = 0, drafted = 0, paid = 0
    const aging: Record<AgingBucket, number> = { current: 0, '1-30': 0, '31-60': 0, '60+': 0 }
    for (const inv of state.invoices) {
      const t = invoiceTotal(inv, state.entries)
      if (inv.status === 'sent') {
        outstanding += t
        aging[agingOf(inv, today).bucket] += t
      } else if (inv.status === 'draft') drafted += t
      else if (inv.status === 'paid') paid += t
    }
    return { outstanding, drafted, paid, aging }
  }, [state.invoices, state.entries, today])

  const overdueTotal = ar.aging['1-30'] + ar.aging['31-60'] + ar.aging['60+']

  if (invoices.length === 0) {
    return <p className="hint">No invoices yet.</p>
  }
  return (
    <div className="panel">
      <div className="ar-summary">
        <div className="ar-tile owed">
          <span className="ar-label">Owed to you</span>
          <span className="ar-value">{formatMoney(ar.outstanding, cur)}</span>
          <span className="ar-sub">
            {overdueTotal > 0 ? `${formatMoney(overdueTotal, cur)} of it overdue` : 'sent, unpaid'}
          </span>
        </div>
        <div className="ar-tile">
          <span className="ar-label">Draft</span>
          <span className="ar-value">{formatMoney(ar.drafted, cur)}</span>
          <span className="ar-sub">not sent yet</span>
        </div>
        <div className="ar-tile">
          <span className="ar-label">Collected</span>
          <span className="ar-value">{formatMoney(ar.paid, cur)}</span>
          <span className="ar-sub">paid</span>
        </div>
      </div>
      {overdueTotal > 0 && (
        <div className="aging-strip">
          <span className="aging-title">Overdue</span>
          {(['1-30', '31-60', '60+'] as AgingBucket[]).map(b => (
            ar.aging[b] > 0 && (
              <span key={b} className={`aging-chip b${b.replace('+', 'plus')}`}>
                {AGING_LABELS[b]}<strong>{formatMoney(ar.aging[b], cur)}</strong>
              </span>
            )
          ))}
        </div>
      )}
      <h3>Invoices</h3>
      <ul className="invoice-list">
        {invoices.map(inv => {
          const client = state.clients.find(c => c.id === inv.clientId)
          const total = invoiceTotal(inv, state.entries)
          // Only a sent, unpaid invoice can be late.
          const age = inv.status === 'sent' ? agingOf(inv, today) : null
          return (
            <li key={inv.id} className="invoice-row" onClick={() => onOpen(inv.id)}>
              <span className="inv-num">{inv.number}</span>
              <span className="inv-client">{clientFullName(client)}</span>
              <span className="dim inv-date">{formatDate(inv.issuedDate)}</span>
              {age && age.daysOverdue > 0
                ? <span className="status-pill overdue" title={`Due ${formatDate(inv.dueDate!)}`}>
                    {age.daysOverdue}d late
                  </span>
                : <span className={`status-pill ${inv.status}`}>{inv.status}</span>}
              <span className="inv-total">{formatMoney(total, cur)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
