import { useMemo, useState } from 'react'
import type { Invoice, InvoiceStatus, TractionState } from '../types'
import { buildBreakdown, formatDate, formatDuration, formatMoney, liveSeconds, lineAmount, todayISO } from '../store'
import { InvoiceDetail } from './InvoiceDetail'

export function InvoicesView({
  state, onCreate, onSetStatus, onUpdate, onDelete,
}: {
  state: TractionState
  onCreate: (clientId: string, entryIds: string[], periodStart: string, periodEnd: string) => Invoice
  onSetStatus: (id: string, status: InvoiceStatus) => void
  onUpdate: (i: Invoice) => void
  onDelete: (id: string) => void
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
  onCreate: (clientId: string, entryIds: string[], periodStart: string, periodEnd: string) => void
}) {
  const clients = state.clients.filter(c => !c.archived)
  const [clientId, setClientId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState(todayISO())
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  // Unbilled, finalized entries for this client (optionally within range).
  const candidates = useMemo(() => {
    if (!clientId) return []
    return state.entries.filter(e =>
      e.clientId === clientId &&
      !e.invoiceId &&
      !e.runningSince &&
      (start === '' || e.date >= start) &&
      (end === '' || e.date <= end),
    )
  }, [state.entries, clientId, start, end])

  const included = candidates.filter(e => !excluded.has(e.id))
  const breakdown = useMemo(() => buildBreakdown(included, state.services), [included, state.services])

  function toggle(id: string) {
    setExcluded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function create() {
    if (!clientId || included.length === 0) return
    const dates = included.map(e => e.date).sort()
    const periodStart = start || dates[0]
    const periodEnd = end || dates[dates.length - 1]
    onCreate(clientId, included.map(e => e.id), periodStart, periodEnd)
    setExcluded(new Set())
  }

  return (
    <div className="panel">
      <h2>New invoice</h2>
      <div className="field-row">
        <label className="field"><span>Client</span>
          <select value={clientId} onChange={e => { setClientId(e.target.value); setExcluded(new Set()) }}>
            <option value="">Pick a client…</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label className="field"><span>From (optional)</span>
          <input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label className="field"><span>To</span>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
      </div>

      {clientId && (
        candidates.length === 0 ? (
          <p className="hint">No unbilled entries for this client in that range.</p>
        ) : (
          <>
            <p className="hint tiny">Untick anything you don't want on this invoice.</p>
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
                      <span className="cand-amt">{formatMoney(lineAmount(secs, e.rate), state.settings.currency)}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <div className="builder-foot">
              <div className="grand">
                <span className="dim">{included.length} entr{included.length === 1 ? 'y' : 'ies'} · {formatDuration(breakdown.totalSeconds)}</span>
                <span className="big-money">{formatMoney(breakdown.total, state.settings.currency)}</span>
              </div>
              <button className="btn primary big" disabled={included.length === 0} onClick={create}>
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
  if (invoices.length === 0) {
    return <p className="hint">No invoices yet.</p>
  }
  return (
    <div className="panel">
      <h3>Invoices</h3>
      <ul className="invoice-list">
        {invoices.map(inv => {
          const client = state.clients.find(c => c.id === inv.clientId)
          const entries = state.entries.filter(e => inv.entryIds.includes(e.id))
          const total = entries.reduce((s, e) => s + lineAmount(e.seconds, e.rate), 0)
          return (
            <li key={inv.id} className="invoice-row" onClick={() => onOpen(inv.id)}>
              <span className="inv-num">{inv.number}</span>
              <span className="inv-client">{client?.name ?? 'Unknown'}</span>
              <span className="dim inv-date">{formatDate(inv.issuedDate)}</span>
              <span className={`status-pill ${inv.status}`}>{inv.status}</span>
              <span className="inv-total">{formatMoney(total, state.settings.currency)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
