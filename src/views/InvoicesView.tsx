import { useMemo, useState } from 'react'
import type { Invoice, InvoiceStatus, TractionState } from '../types'
import { buildBreakdown, formatDate, formatDuration, formatMoney, invoiceTotal, liveSeconds, lineAmount, todayISO } from '../store'
import { InvoiceDetail } from './InvoiceDetail'

export function InvoicesView({
  state, onCreate, onSetStatus, onUpdate, onDelete, onAddCharge, onUpdateCharge, onRemoveCharge,
}: {
  state: TractionState
  onCreate: (clientId: string, entryIds: string[], expenseIds: string[], periodStart: string, periodEnd: string) => Invoice
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
      <InvoiceBuilder state={state} onCreate={(...a) => { const inv = onCreate(...a); setOpenId(inv.id) }} />
      <InvoiceList state={state} onOpen={setOpenId} />
    </div>
  )
}

function InvoiceBuilder({
  state, onCreate,
}: {
  state: TractionState
  onCreate: (clientId: string, entryIds: string[], expenseIds: string[], periodStart: string, periodEnd: string) => void
}) {
  const clients = state.clients.filter(c => !c.archived)
  const cur = state.settings.currency
  const [clientId, setClientId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState(todayISO())
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [excludedExp, setExcludedExp] = useState<Set<string>>(new Set())

  const inRange = (date: string) => (start === '' || date >= start) && (end === '' || date <= end)

  // Unbilled, finalized time entries for this client (optionally within range).
  const candidates = useMemo(() => {
    if (!clientId) return []
    return state.entries.filter(e =>
      e.clientId === clientId && !e.invoiceId && !e.runningSince && inRange(e.date))
  }, [state.entries, clientId, start, end])

  // Unbilled billable expenses for this client (optionally within range).
  const expCandidates = useMemo(() => {
    if (!clientId) return []
    return state.expenses.filter(x =>
      x.clientId === clientId && x.billable && !x.invoiceId && inRange(x.date))
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

  function create() {
    if (!clientId || (included.length === 0 && includedExp.length === 0)) return
    const dates = [...included.map(e => e.date), ...includedExp.map(x => x.date)].sort()
    const periodStart = start || dates[0]
    const periodEnd = end || dates[dates.length - 1]
    onCreate(clientId, included.map(e => e.id), includedExp.map(x => x.id), periodStart, periodEnd)
    setExcluded(new Set()); setExcludedExp(new Set())
  }

  const nothing = candidates.length === 0 && expCandidates.length === 0

  return (
    <div className="panel">
      <h2>New invoice</h2>
      <div className="field-row">
        <label className="field"><span>Client</span>
          <select value={clientId} onChange={e => resetClient(e.target.value)}>
            <option value="">Pick a client…</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
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
                          <span className="cand-dur">{formatDuration(secs)}</span>
                          <span className="cand-amt">{formatMoney(lineAmount(secs, e.rate), cur)}</span>
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
                  {included.length} entr{included.length === 1 ? 'y' : 'ies'} · {formatDuration(breakdown.totalSeconds)}
                  {includedExp.length > 0 && ` + ${includedExp.length} expense${includedExp.length === 1 ? '' : 's'}`}
                </span>
                <span className="big-money">{formatMoney(grand, cur)}</span>
              </div>
              <button className="btn primary big" disabled={included.length === 0 && includedExp.length === 0} onClick={create}>
                Create invoice
              </button>
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

  // Accounts receivable: sent-but-unpaid = money owed; draft = not yet billed out.
  const ar = useMemo(() => {
    let outstanding = 0, drafted = 0, paid = 0
    for (const inv of state.invoices) {
      const t = invoiceTotal(inv, state.entries)
      if (inv.status === 'sent') outstanding += t
      else if (inv.status === 'draft') drafted += t
      else if (inv.status === 'paid') paid += t
    }
    return { outstanding, drafted, paid }
  }, [state.invoices, state.entries])

  if (invoices.length === 0) {
    return <p className="hint">No invoices yet.</p>
  }
  return (
    <div className="panel">
      <div className="ar-summary">
        <div className="ar-tile owed">
          <span className="ar-label">Owed to you</span>
          <span className="ar-value">{formatMoney(ar.outstanding, cur)}</span>
          <span className="ar-sub">sent, unpaid</span>
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
      <h3>Invoices</h3>
      <ul className="invoice-list">
        {invoices.map(inv => {
          const client = state.clients.find(c => c.id === inv.clientId)
          const total = invoiceTotal(inv, state.entries)
          return (
            <li key={inv.id} className="invoice-row" onClick={() => onOpen(inv.id)}>
              <span className="inv-num">{inv.number}</span>
              <span className="inv-client">{client?.name ?? 'Unknown'}</span>
              <span className="dim inv-date">{formatDate(inv.issuedDate)}</span>
              <span className={`status-pill ${inv.status}`}>{inv.status}</span>
              <span className="inv-total">{formatMoney(total, cur)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
