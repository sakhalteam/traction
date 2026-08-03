import { useMemo, useState } from 'react'
import type { Expense, TractionState } from '../types'
import { EXPENSE_CATEGORIES, formatDate, formatMoney, makeExpense, todayISO } from '../store'

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
        <label className="field"><span>{billable ? 'Client (bill to)' : 'Client (optional)'}</span>
          <select value={clientId} onChange={e => setClientId(e.target.value)}>
            <option value="">{billable ? 'General (no client)' : 'None'}</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
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
  const clientName = expense.clientId ? (state.clients.find(c => c.id === expense.clientId)?.name ?? 'Unknown') : null
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
            ? <span className={`client-tag ${clientName ? '' : 'general'}`}>{clientName ?? 'General'}</span>
            : <span className="client-tag general">Overhead</span>}
          {invoiced && <span className="invoiced-tag" title="On an invoice">{invNum ?? 'invoiced'}</span>}
        </div>
      </div>
      <div className="entry-figures">
        <span className="entry-dur">{formatMoney(expense.amount, cur)}</span>
      </div>
      <div className="entry-actions">
        {!invoiced && <button className="icon-btn" title="Edit" onClick={() => setEditing(true)}>✎</button>}
        {!invoiced && <button className="icon-btn danger" title="Delete" onClick={() => onDelete(expense.id)}>✕</button>}
      </div>
    </li>
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
        <label className="field"><span>Client</span>
          <select value={x.clientId ?? ''} onChange={e => set({ clientId: e.target.value || null })}>
            <option value="">{x.billable ? 'General (no client)' : 'None'}</option>
            {state.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
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
