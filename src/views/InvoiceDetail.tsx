import { Fragment, useMemo, useRef, useState } from 'react'
import type { Invoice, InvoiceStatus, TractionState } from '../types'
import {
  buildBreakdown, expensesTotal, formatDate, formatDuration, formatMoney,
  clientAttn, clientFullName,
} from '../store'
import { ReceiptLink } from './ReceiptLink'
import { JobPhotos } from './JobPhotos'
import { LogoImage } from './LogoImage'
import { InvoiceBackground } from './InvoiceBackground'
import { ServiceIcon } from './ServiceIcon'
import { canShareFiles, shareInvoice } from '../share'

const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid']

export function InvoiceDetail({
  invoice, state, onBack, onSetStatus, onUpdate, onDelete, onAddCharge, onUpdateCharge, onRemoveCharge,
}: {
  invoice: Invoice
  state: TractionState
  onBack: () => void
  onSetStatus: (id: string, status: InvoiceStatus) => void
  onUpdate: (i: Invoice) => void
  onDelete: (id: string) => void
  onAddCharge: (invoiceId: string) => void
  onUpdateCharge: (invoiceId: string, expenseId: string, patch: { label?: string; amount?: number }) => void
  onRemoveCharge: (invoiceId: string, expenseId: string) => void
}) {
  const [confirmDel, setConfirmDel] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const [sharing, setSharing] = useState(false)
  const [shareMsg, setShareMsg] = useState<string | null>(null)

  /**
   * Rasterise this invoice at letter width and hand it to the OS share sheet.
   * Always letter width, never the phone's — see share.ts.
   */
  async function share() {
    if (!sheetRef.current) return
    setSharing(true)
    setShareMsg(null)
    try {
      const how = await shareInvoice(sheetRef.current, invoice.number, `Invoice ${invoice.number}`)
      if (how === 'downloaded') setShareMsg('Saved as an image — attach it from your files.')
    } catch {
      setShareMsg('Could not build the image. Print / Save PDF still works.')
    } finally {
      setSharing(false)
    }
  }
  const client = state.clients.find(c => c.id === invoice.clientId)
  const settings = state.settings
  const durationStyle = settings.durationFormat ?? 'hm'
  const attn = clientAttn(client)
  const locked = invoice.status === 'paid'

  // Prefer the FROZEN snapshot; legacy invoices (pre-snapshot) re-derive live.
  const breakdown = useMemo(() => {
    if (invoice.snapshot) return invoice.snapshot
    const entries = state.entries.filter(e => invoice.entryIds.includes(e.id))
    return buildBreakdown(entries, state.services)
  }, [invoice.snapshot, invoice.entryIds, state.entries, state.services])

  const expTotal = expensesTotal(invoice)
  const grand = Math.round((breakdown.total + expTotal) * 100) / 100

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
        <button className="btn" disabled={sharing} onClick={() => void share()}>
          {sharing ? 'Preparing…' : canShareFiles() ? '↗ Share' : '↓ Save image'}
        </button>
        {confirmDel
          ? <button className="btn danger" onClick={() => onDelete(invoice.id)}>Really delete?</button>
          : <button className="btn danger ghost" onClick={() => setConfirmDel(true)}>Delete</button>}
      </div>

      {!invoice.snapshot && (
        <p className="hint tiny no-print">Legacy invoice — totals still reflect live entries.</p>
      )}

      {shareMsg && <p className="hint tiny no-print share-msg">{shareMsg}</p>}

      <div className="invoice-sheet" ref={sheetRef}>
        <InvoiceBackground path={settings.invoiceBgPath} />
        <div className="invoice-body">
        <div className="invoice-top">
          <div className="invoice-from">
            {settings.logoPath && <LogoImage path={settings.logoPath} className="invoice-logo" />}
            <div className="from-name">{settings.businessName || 'Your business name'}</div>
            <div className="dim">{settings.businessAddress}</div>
            <div className="dim">{[settings.businessPhone, settings.businessEmail].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="invoice-meta">
            <h1>Invoice</h1>
            <div className="inv-numline">{invoice.number}</div>
            <dl className="meta-grid">
              <dt>Issued</dt><dd>{formatDate(invoice.issuedDate)}</dd>
              {invoice.dueDate && <><dt>Due</dt><dd className="due-line">{formatDate(invoice.dueDate)}</dd></>}
              <dt>Period</dt>
              <dd>{formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}</dd>
              {invoice.paidDate && <><dt>Paid</dt><dd>{formatDate(invoice.paidDate)}</dd></>}
            </dl>
            <div className={`status-pill ${invoice.status} big-status`}>{invoice.status}</div>
          </div>
        </div>

        <div className="invoice-billto">
          <span className="label">Bill to</span>
          <div className="billto-name">{clientFullName(client)}</div>
          {/* A business is the billed party; the person on it is who opens the
              envelope, so they get their own line rather than the name line. */}
          {attn && <div className="dim">Attn: {attn}</div>}
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
                      <span className="svc-cell">
                        <ServiceIcon name={line.serviceName} className="svc-glyph" />
                        <span>
                          {line.serviceName}
                          {line.notes.length > 0 && <span className="line-note"> — {line.notes.join(', ')}</span>}
                        </span>
                      </span>
                    </td>
                    <td className="num">
                      {line.seconds > 0 ? formatDuration(line.seconds, durationStyle) : '—'}
                    </td>
                    {/* An agreed price has no rate to show, and inventing one
                        from hours would misstate what was agreed. */}
                    <td className="num">
                      {line.flat ? 'Flat rate' : formatMoney(line.rate, settings.currency)}
                    </td>
                    <td className="num">{formatMoney(line.amount, settings.currency)}</td>
                  </tr>
                ))}
                {/* A subtotal only means something when there's more than one
                    line to sum. On a single-line day it restated the row
                    verbatim, doubling the invoice's length for no information —
                    which is what pushed it onto a second page. */}
                {day.lines.length > 1 && (
                  <tr className="day-subtotal">
                    <td />
                    <td className="dim">{formatDate(day.date)} subtotal</td>
                    <td className="num dim">{formatDuration(day.daySeconds, durationStyle)}</td>
                    <td />
                    <td className="num">{formatMoney(day.dayTotal, settings.currency)}</td>
                  </tr>
                )}
              </Fragment>
            ))}

            {invoice.expensesSnapshot.length > 0 && (
              <>
                <tr className="section-row"><td colSpan={5}>Materials &amp; charges</td></tr>
                {invoice.expensesSnapshot.map(x => (
                  <tr key={x.id}>
                    <td />
                    <td className="charge-label">
                      {x.label || 'Charge'}
                      {/* A partial charge explains itself on the page, so a
                          client asking "why only half?" has the answer in hand. */}
                      {x.note && <span className="line-note"> — {x.note}</span>}
                    </td>
                    <td className="num" /><td className="num" />
                    <td className="num">{formatMoney(x.amount || 0, settings.currency)}</td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
          <tfoot>
            {expTotal > 0 && (
              <>
                <tr className="foot-sub">
                  <td colSpan={4} className="dim">Labor</td>
                  <td className="num">{formatMoney(breakdown.total, settings.currency)}</td>
                </tr>
                <tr className="foot-sub">
                  <td colSpan={4} className="dim">Materials &amp; charges</td>
                  <td className="num">{formatMoney(expTotal, settings.currency)}</td>
                </tr>
              </>
            )}
            <tr className="grand-total">
              <td colSpan={2}>Total</td>
              <td className="num">{formatDuration(breakdown.totalSeconds, durationStyle)}</td>
              <td />
              <td className="num">{formatMoney(grand, settings.currency)}</td>
            </tr>
          </tfoot>
        </table>

        {!locked && (
          <ChargesEditor
            invoice={invoice} currency={settings.currency}
            onAdd={onAddCharge} onUpdate={onUpdateCharge} onRemove={onRemoveCharge}
          />
        )}

        <InvoiceJobPhotos invoice={invoice} state={state} />

        <InvoiceReceipts invoice={invoice} state={state} />

        <InvoiceNotes invoice={invoice} onUpdate={onUpdate} />
        </div>
      </div>
    </div>
  )
}

/**
 * Photos of the work this invoice covers.
 *
 * Unlike receipts, these DO print. A receipt is evidence you spent something;
 * a job photo is the thing the client is actually paying for, and showing the
 * finished hedge next to the hours makes the number self-justifying.
 *
 * Read from the live entries rather than the frozen snapshot on purpose — a
 * photo added after invoicing is new evidence of the same work, and it changes
 * no money, so there's nothing for the immutable record to protect here.
 */
function InvoiceJobPhotos({ invoice, state }: { invoice: Invoice; state: TractionState }) {
  const paths = state.entries
    .filter(e => invoice.entryIds.includes(e.id))
    .flatMap(e => e.photoPaths ?? [])
  if (paths.length === 0) return null
  return (
    <div className="invoice-job-photos">
      <span className="label">The work</span>
      <JobPhotos paths={paths} />
    </div>
  )
}

/**
 * Receipt photos backing this invoice's charges. Stays visible after the
 * invoice is locked/paid — that's precisely when a client asks for proof.
 * Never printed: it's a lookup tool, not part of the invoice itself.
 */
function InvoiceReceipts({ invoice, state }: { invoice: Invoice; state: TractionState }) {
  const withReceipts = state.expenses.filter(
    x => x.invoiceId === invoice.id && x.receiptPath,
  )
  if (withReceipts.length === 0) return null
  return (
    <div className="invoice-receipts no-print">
      <span className="label">Receipts on file</span>
      <div className="receipt-row">
        {withReceipts.map(x => (
          <ReceiptLink key={x.id} path={x.receiptPath!} label={x.label || 'Receipt'} />
        ))}
      </div>
    </div>
  )
}

function ChargesEditor({
  invoice, currency, onAdd, onUpdate, onRemove,
}: {
  invoice: Invoice
  currency: string
  onAdd: (invoiceId: string) => void
  onUpdate: (invoiceId: string, expenseId: string, patch: { label?: string; amount?: number }) => void
  onRemove: (invoiceId: string, expenseId: string) => void
}) {
  return (
    <div className="invoice-expenses no-print">
      <span className="label">Materials &amp; charges ({currency}) — one-off charges on this invoice</span>
      {invoice.expensesSnapshot.map(x => (
        <div key={x.id} className="expense-row">
          <input placeholder="e.g. Mulch, dump fee" value={x.label}
            onChange={e => onUpdate(invoice.id, x.id, { label: e.target.value })} />
          <input className="narrow" type="number" min="0" step="0.01" placeholder="0.00"
            value={x.amount || ''} onChange={e => onUpdate(invoice.id, x.id, { amount: Number(e.target.value) || 0 })} />
          <button className="icon-btn danger" title="Remove" onClick={() => onRemove(invoice.id, x.id)}>✕</button>
        </div>
      ))}
      <button className="btn" onClick={() => onAdd(invoice.id)}>+ Add charge</button>
      <p className="hint tiny">Or log expenses ahead of time in the <strong>Expenses</strong> tab and pick them when building the invoice.</p>
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
