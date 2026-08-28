import { useMemo, useRef, useState } from 'react'
import type { Expense, TractionState } from '../types'
import { EXPENSE_CATEGORIES, clientColor, formatDate, formatMoney, makeExpense, todayISO } from '../store'
import { ClientLabel } from '../Chrome'
import { supabase } from '../supabaseClient'
import { ReceiptError, deleteReceipt, receiptUrl, uploadReceipt } from '../receipts'
import { Picker } from './Picker'

export function ExpensesView({
  state, onAdd, onUpdate, onDelete,
}: {
  state: TractionState
  onAdd: (x: Expense) => void
  onUpdate: (x: Expense) => void
  onDelete: (id: string) => void
}) {
  const cur = state.settings.currency
  const [filter, setFilter] = useState<'all' | 'billable' | 'overhead'>('all')

  const expenses = useMemo(() => {
    return [...state.expenses]
      .filter(x => filter === 'all' ? true : filter === 'billable' ? x.billable : !x.billable)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt))
  }, [state.expenses, filter])

  const unbilled = state.expenses.filter(x => x.billable && !x.invoiceId).reduce((s, x) => s + x.amount, 0)
  const overhead = state.expenses.filter(x => !x.billable).reduce((s, x) => s + x.amount, 0)

  return (
    <div className="view">
      <div className="panel">
        <h2>Expenses</h2>
        <p className="hint">
          Track costs as you incur them. <strong>Billable</strong> ones (materials you pass
          through) can be added to a client's invoice; <strong>overhead</strong> (gas, gear)
          stays off invoices and feeds your profit in Reports.
        </p>
        <div className="ar-summary two">
          <div className="ar-tile">
            <span className="ar-label">Unbilled billable</span>
            <span className="ar-value">{formatMoney(unbilled, cur)}</span>
            <span className="ar-sub">ready to put on invoices</span>
          </div>
          <div className="ar-tile">
            <span className="ar-label">Overhead logged</span>
            <span className="ar-value">{formatMoney(overhead, cur)}</span>
            <span className="ar-sub">your own costs</span>
          </div>
        </div>
      </div>

      <AddExpenseForm state={state} onAdd={onAdd} />

      <div className="panel">
        <div className="panel-head">
          <h3>History</h3>
          <div className="metric-toggle small">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
            <button className={filter === 'billable' ? 'active' : ''} onClick={() => setFilter('billable')}>Billable</button>
            <button className={filter === 'overhead' ? 'active' : ''} onClick={() => setFilter('overhead')}>Overhead</button>
          </div>
        </div>
        {expenses.length === 0 ? (
          <p className="hint">No expenses logged yet.</p>
        ) : (
          <ul className="entry-list">
            {expenses.map(x => (
              <ExpenseRow key={x.id} expense={x} state={state} onUpdate={onUpdate} onDelete={onDelete} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function AddExpenseForm({ state, onAdd }: { state: TractionState; onAdd: (x: Expense) => void }) {
  const clients = state.clients.filter(c => !c.archived)
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0])
  const [date, setDate] = useState(todayISO())
  const [clientId, setClientId] = useState('')
  const [billable, setBillable] = useState(true)
  const [note, setNote] = useState('')

  function submit() {
    const amt = Number(amount) || 0
    if (!label.trim() || amt <= 0) return
    onAdd({
      ...makeExpense(date),
      label: label.trim(), amount: amt, category,
      clientId: clientId || null, billable, note: note.trim(),
    })
    setLabel(''); setAmount(''); setNote('')
  }

  return (
    <div className="panel">
      <h3>Log an expense</h3>
      <div className="field-row">
        <label className="field"><span>What</span>
          <input placeholder="e.g. Mulch, gas, dump fee" value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }} /></label>
        <label className="field narrow-field"><span>Amount</span>
          <input type="number" min="0" step="0.01" placeholder="0.00" value={amount}
            onChange={e => setAmount(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }} /></label>
        <label className="field narrow-field"><span>Category</span>
          <select value={category} onChange={e => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <label className="field narrow-field"><span>Date</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      </div>
      <div className="field-row">
        <label className="field billable-field">
          <span>Type</span>
          <div className="billable-toggle metric-toggle">
            <button type="button" className={billable ? 'active' : ''} onClick={() => setBillable(true)}>Billable</button>
            <button type="button" className={!billable ? 'active' : ''} onClick={() => setBillable(false)}>Overhead</button>
          </div>
        </label>
        <Picker
          label={billable ? 'Client (bill to)' : 'Client (optional)'}
          value={clientId || null}
          noneLabel={billable ? 'General (no client)' : 'None'}
          placeholder="Search clients…"
          options={clients.map(c => ({ id: c.id, label: c.name }))}
          onChange={id => setClientId(id ?? '')}
        />
        <label className="field"><span>Note</span>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="optional" /></label>
      </div>
      {billable && !clientId && (
        <p className="hint tiny">Heads up: a billable expense needs a client to be added to an invoice.</p>
      )}
      <button className="btn primary" disabled={!label.trim() || (Number(amount) || 0) <= 0} onClick={submit}>
        Log expense
      </button>
    </div>
  )
}

function ExpenseRow({
  expense, state, onUpdate, onDelete,
}: {
  expense: Expense
  state: TractionState
  onUpdate: (x: Expense) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const cur = state.settings.currency
  const client = expense.clientId ? (state.clients.find(c => c.id === expense.clientId) ?? null) : null
  const clientName = expense.clientId ? (client?.name ?? 'Unknown') : null
  const invoiced = !!expense.invoiceId
  const invNum = invoiced ? state.invoices.find(i => i.id === expense.invoiceId)?.number : null

  if (editing) {
    return (
      <li className="entry-row editing">
        <ExpenseEditor expense={expense} state={state}
          onSave={x => { onUpdate(x); setEditing(false) }} onCancel={() => setEditing(false)} />
      </li>
    )
  }

  return (
    <li className="entry-row">
      <span className={`expense-badge ${expense.billable ? 'billable' : 'overhead'}`}>{expense.category}</span>
      <div className="entry-main">
        <div className="entry-title">{expense.label || 'Expense'}
          {expense.note && <span className="entry-note"> · {expense.note}</span>}
        </div>
        <div className="entry-sub">
          <span>{formatDate(expense.date)}</span>
          {expense.billable
            ? <ClientLabel name={clientName} color={clientColor(client)} />
            : <span className="client-tag general">Overhead</span>}
          {invoiced && <span className="invoiced-tag" title="On an invoice">{invNum ?? 'invoiced'}</span>}
        </div>
      </div>
      <div className="entry-figures">
        <span className="entry-dur">{formatMoney(expense.amount, cur)}</span>
      </div>
      <div className="entry-actions">
        {/* Receipts stay available even once invoiced — that's exactly when a
            client is most likely to ask for proof of a charge. */}
        <ReceiptControl expense={expense} onUpdate={onUpdate} />
        {!invoiced && <button className="icon-btn" title="Edit" onClick={() => setEditing(true)}>✎</button>}
        {!invoiced && <button className="icon-btn danger" title="Delete" onClick={() => onDelete(expense.id)}>✕</button>}
      </div>
    </li>
  )
}

/**
 * Attach / view / remove the receipt photo for one expense. Only the object
 * path is written back onto the expense — the image itself lives in Storage.
 */
function ReceiptControl({
  expense, onUpdate,
}: {
  expense: Expense
  onUpdate: (x: Expense) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const attached = !!expense.receiptPath

  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      // Replacing? Drop the old object so we don't leave it orphaned.
      const previous = expense.receiptPath
      const path = await uploadReceipt(supabase, expense.id, file)
      onUpdate({ ...expense, receiptPath: path })
      if (previous) await deleteReceipt(supabase, previous)
    } catch (err) {
      setError(err instanceof ReceiptError ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function view() {
    if (!expense.receiptPath) return
    setBusy(true)
    setError(null)
    try {
      // Opened rather than embedded so it prints straight from the browser.
      window.open(await receiptUrl(supabase, expense.receiptPath), '_blank', 'noopener')
    } catch (err) {
      setError(err instanceof ReceiptError ? err.message : 'Could not open that receipt.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!expense.receiptPath) return
    setBusy(true)
    setError(null)
    const path = expense.receiptPath
    onUpdate({ ...expense, receiptPath: null })
    await deleteReceipt(supabase, path)
    setBusy(false)
  }

  return (
    <span className="receipt-control">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={e => pick(e.target.files?.[0])}
      />
      {attached ? (
        <>
          <button className="icon-btn has-receipt" title="View receipt" disabled={busy} onClick={view}>
            {busy ? '…' : '🧾'}
          </button>
          <button className="icon-btn danger subtle" title="Remove receipt" disabled={busy} onClick={remove}>
            ⊘
          </button>
        </>
      ) : (
        <button
          className="icon-btn"
          title="Attach receipt photo"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? '…' : '📎'}
        </button>
      )}
      {error && <span className="receipt-error" title={error}>!</span>}
    </span>
  )
}

function ExpenseEditor({
  expense, state, onSave, onCancel,
}: {
  expense: Expense
  state: TractionState
  onSave: (x: Expense) => void
  onCancel: () => void
}) {
  const [x, setX] = useState(expense)
  const set = (patch: Partial<Expense>) => setX(prev => ({ ...prev, ...patch }))

  return (
    <div className="entry-editor">
      <div className="field-row">
        <label className="field"><span>What</span>
          <input value={x.label} onChange={e => set({ label: e.target.value })} /></label>
        <label className="field narrow-field"><span>Amount</span>
          <input type="number" min="0" step="0.01" value={x.amount}
            onChange={e => set({ amount: Number(e.target.value) || 0 })} /></label>
        <label className="field narrow-field"><span>Category</span>
          <select value={x.category} onChange={e => set({ category: e.target.value })}>
            {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <label className="field narrow-field"><span>Date</span>
          <input type="date" value={x.date} onChange={e => set({ date: e.target.value })} /></label>
      </div>
      <div className="field-row">
        <label className="field billable-field"><span>Type</span>
          <div className="billable-toggle metric-toggle">
            <button type="button" className={x.billable ? 'active' : ''} onClick={() => set({ billable: true })}>Billable</button>
            <button type="button" className={!x.billable ? 'active' : ''} onClick={() => set({ billable: false })}>Overhead</button>
          </div>
        </label>
        <Picker
          label="Client"
          value={x.clientId}
          noneLabel={x.billable ? 'General (no client)' : 'None'}
          placeholder="Search clients…"
          options={state.clients.map(c => ({ id: c.id, label: c.name }))}
          onChange={id => set({ clientId: id })}
        />
        <label className="field"><span>Note</span>
          <input value={x.note} onChange={e => set({ note: e.target.value })} /></label>
      </div>
      <div className="editor-actions">
        <button className="btn primary" onClick={() => onSave(x)}>Save</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
