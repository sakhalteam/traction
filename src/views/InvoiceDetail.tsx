import { Fragment, useMemo, useState } from 'react'
import type { Invoice, InvoiceStatus, TractionState } from '../types'
import { buildBreakdown, formatDate, formatDuration, formatMoney } from '../store'

const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid']

export function InvoiceDetail({
  invoice, state, onBack, onSetStatus, onUpdate, onDelete,
}: {
  invoice: Invoice
  state: TractionState
  onBack: () => void
  onSetStatus: (id: string, status: InvoiceStatus) => void
  onUpdate: (i: Invoice) => void
  onDelete: (id: string) => void
}) {
  const [confirmDel, setConfirmDel] = useState(false)
  const client = state.clients.find(c => c.id === invoice.clientId)
  const settings = state.settings

  const entries = useMemo(
    () => state.entries.filter(e => invoice.entryIds.includes(e.id)),
    [state.entries, invoice.entryIds],
  )
  const breakdown = useMemo(() => buildBreakdown(entries, state.services), [entries, state.services])

  return (
    <div className="view invoice-detail">
      <div className="detail-toolbar no-print">
        <button className="btn ghost" onClick={onBack}>← Back</button>
        <div className="status-switch">
          {STATUSES.map(s => (
            <button key={s} className={`status-pill ${s} ${invoice.status === s ? 'active' : ''}`}
              onClick={() => onSetStatus(invoice.id, s)}>{s}</button>
          ))}
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => window.print()}>Print / Save PDF</button>
        {confirmDel
          ? <button className="btn danger" onClick={() => onDelete(invoice.id)}>Really delete?</button>
          : <button className="btn danger ghost" onClick={() => setConfirmDel(true)}>Delete</button>}
      </div>

      <div className="invoice-sheet">
        <div className="invoice-top">
          <div className="invoice-from">
            <div className="from-name">{settings.businessName || 'Your business name'}</div>
            <div className="dim">{settings.businessAddress}</div>
            <div className="dim">{[settings.businessPhone, settings.businessEmail].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="invoice-meta">
            <h1>INVOICE</h1>
            <div className="inv-numline">{invoice.number}</div>
            <div className="dim">Issued {formatDate(invoice.issuedDate)}</div>
            <div className="dim">Period {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}</div>
            <div className={`status-pill ${invoice.status} big-status`}>{invoice.status}</div>
          </div>
        </div>

        <div className="invoice-billto">
          <span className="label">Bill to</span>
          <div className="billto-name">{client?.name ?? 'Unknown client'}</div>
          {client?.address && <div className="dim">{client.address}</div>}
          {(client?.phone || client?.email) && (
            <div className="dim">{[client?.phone, client?.email].filter(Boolean).join(' · ')}</div>
          )}
        </div>

        <table className="invoice-table">
          <thead>
            <tr>
              <th>Date</th><th>Service</th><th className="num">Hours</th>
              <th className="num">Rate</th><th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.days.map(day => (
              <Fragment key={day.date}>
                {day.lines.map((line, i) => (
                  <tr key={`${day.date}-${line.serviceId}-${line.rate}`}>
                    <td>{i === 0 ? formatDate(day.date) : ''}</td>
                    <td>
                      {line.serviceName}
                      {line.notes.length > 0 && <span className="line-note"> — {line.notes.join(', ')}</span>}
                    </td>
                    <td className="num">{formatDuration(line.seconds)}</td>
                    <td className="num">{formatMoney(line.rate, settings.currency)}</td>
                    <td className="num">{formatMoney(line.amount, settings.currency)}</td>
                  </tr>
                ))}
                <tr className="day-subtotal">
                  <td />
                  <td className="dim">{formatDate(day.date)} subtotal</td>
                  <td className="num dim">{formatDuration(day.daySeconds)}</td>
                  <td />
                  <td className="num">{formatMoney(day.dayTotal, settings.currency)}</td>
                </tr>
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="grand-total">
              <td colSpan={2}>Total</td>
              <td className="num">{formatDuration(breakdown.totalSeconds)}</td>
              <td />
              <td className="num">{formatMoney(breakdown.total, settings.currency)}</td>
            </tr>
          </tfoot>
        </table>

        <InvoiceNotes invoice={invoice} onUpdate={onUpdate} />
      </div>
    </div>
  )
}

function InvoiceNotes({ invoice, onUpdate }: { invoice: Invoice; onUpdate: (i: Invoice) => void }) {
  const [notes, setNotes] = useState(invoice.notes)
  return (
    <div className="invoice-notes">
      <span className="label no-print">Notes (payment terms, thanks, etc.)</span>
      <textarea
        className="no-print" rows={2} value={notes}
        placeholder="e.g. Payment due within 14 days. Venmo @friendly-pressure. Thank you!"
        onChange={e => setNotes(e.target.value)}
        onBlur={() => { if (notes !== invoice.notes) onUpdate({ ...invoice, notes }) }}
      />
      {invoice.notes && <p className="printed-notes">{invoice.notes}</p>}
    </div>
  )
}
