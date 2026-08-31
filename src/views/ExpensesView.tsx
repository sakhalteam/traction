import { useMemo, useRef, useState } from 'react'
import type { Expense, SettledHow, TractionState } from '../types'
import {
  EXPENSE_CATEGORIES, clientColor, clientFullName, clientShortName,
  formatDate, formatMoney, makeExpense, todayISO,
  expenseState, isOpenExpense, SETTLED_LABELS, SETTLED_OPTIONS,
} from '../store'
import { ClientLabel } from '../Chrome'
import { supabase } from '../supabaseClient'
import { ReceiptError, deleteReceipt, receiptUrl, uploadReceipt } from '../receipts'
import { Picker } from './Picker'

/** The two lists of expenses still waiting on a decision. */
type OpenGroup = 'billable' | 'shelf'

export function ExpensesView({
  state, onAdd, onUpdate, onDelete, onSettle, onAssign, onSplit, onGoInvoice,
}: {
  state: TractionState
  onAdd: (x: Expense) => void
  onUpdate: (x: Expense) => void
  onDelete: (id: string) => void
  onSettle: (id: string, how: SettledHow | null, note?: string) => void
  onAssign: (id: string, clientId: string | null) => void
  onSplit: (id: string, billedAmount: number) => void
  onGoInvoice: (clientId?: string) => void
}) {
  const cur = state.settings.currency
  const [filter, setFilter] = useState<'all' | 'billable' | 'overhead'>('all')
  /**
   * Which summary tile is opened up to show the expenses behind it.
   *
   * Open by default when there is anything open, because History only holds
   * what has already been dealt with — so on a day when everything is still
   * waiting to be billed, starting collapsed makes the whole tab look like the
   * expenses were deleted. Work you have to act on is not something to hide
   * behind a tap.
   */
  const [open, setOpen] = useState<Set<OpenGroup>>(() => {
    // Both, independently: they are separate lists, and collapsing one to show
    // the other hides real expenses for no reason. Anything with contents
    // starts visible.
    const start = new Set<OpenGroup>()
    const anyOpen = state.expenses.filter(isOpenExpense)
    if (anyOpen.some(x => x.clientId)) start.add('billable')
    if (anyOpen.some(x => !x.clientId)) start.add('shelf')
    return start
  })
  const toggleGroup = (g: OpenGroup) => setOpen(prev => {
    const next = new Set(prev)
    next.has(g) ? next.delete(g) : next.add(g)
    return next
  })

  const byState = useMemo(() => {
    const groups = { billable: [] as Expense[], shelf: [] as Expense[], settled: [] as Expense[] }
    for (const x of state.expenses) {
      const st = expenseState(x)
      if (st === 'billable' || st === 'shelf' || st === 'settled') groups[st].push(x)
    }
    const bydate = (a: Expense, b: Expense) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt
    groups.billable.sort(bydate)
    groups.shelf.sort(bydate)
    return groups
  }, [state.expenses])

  /**
   * History is everything already dealt with. What's still open lives in its
   * own panel above, because an expense you have to decide about is a task,
   * and a task buried in a chronological log is a task you forget.
   */
  const history = useMemo(() => {
    return [...state.expenses]
      .filter(x => !isOpenExpense(x))
      .filter(x => filter === 'all' ? true : filter === 'billable' ? x.billable : !x.billable)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt))
  }, [state.expenses, filter])

  const sum = (list: Expense[]) => list.reduce((s, x) => s + x.amount, 0)
  const overhead = sum(state.expenses.filter(x => !x.billable))
  const openCount = byState.billable.length + byState.shelf.length
  const groups: { id: OpenGroup; label: string; list: Expense[]; empty: string }[] = [
    { id: 'billable', label: 'Ready to bill', list: byState.billable,
      empty: 'Nothing waiting to be billed.' },
    { id: 'shelf', label: 'On the shelf', list: byState.shelf,
      empty: 'Nothing on the shelf. Anything billable with no client lands here.' },
  ]
  const shown = groups.filter(g => open.has(g.id))

  const rowProps = { state, onUpdate, onDelete, onSettle, onAssign, onSplit, onGoInvoice }

  return (
    <div className="view">
      <div className="panel">
        <h2>Expenses</h2>
        <p className="hint">
          Track costs as you incur them. <strong>Billable</strong> ones can go on a client's
          invoice, be settled another way (cash, a trade, a write-off), or sit on the
          shelf until you know whose job they belong to. <strong>Overhead</strong> stays
          off invoices and feeds your profit in Reports.
        </p>
        <div className="ar-summary three">
          <ExpenseTile
            label="Ready to bill" amount={sum(byState.billable)} cur={cur}
            sub={`${byState.billable.length} on a client, not yet invoiced`}
            open={open.has('billable')} onClick={() => toggleGroup('billable')}
            accent
          />
          {/* Material you own but haven't attributed. Deliberately its own
              number: lumping it into "ready to bill" reads as money owed by
              somebody, and nobody owes it. */}
          <ExpenseTile
            label="On the shelf" amount={sum(byState.shelf)} cur={cur}
            sub={`${byState.shelf.length} bought, no client yet`}
            open={open.has('shelf')} onClick={() => toggleGroup('shelf')}
          />
          <div className="ar-tile">
            <span className="ar-label">Overhead logged</span>
            <span className="ar-value">{formatMoney(overhead, cur)}</span>
            <span className="ar-sub">your own costs</span>
          </div>
        </div>

        {shown.map(g => (
          <div key={g.id} className="open-group">
            {/* Labelled only when both are showing, so a single list stays
                attached to the tile it came from without repeating it. */}
            {shown.length > 1 && <span className="drawer-label">{g.label}</span>}
            {g.list.length === 0 ? (
              <p className="hint tiny">{g.empty}</p>
            ) : (
              <ul className="entry-list open-expenses">
                {g.list.map(x => <ExpenseRow key={x.id} expense={x} {...rowProps} />)}
              </ul>
            )}
          </div>
        ))}
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
        <p className="hint tiny">
          Settled and done — invoiced, paid another way, or your own overhead.
          {openCount > 0 && <> Anything still waiting on you is up top, under <strong>
            {openCount} open</strong>.</>}
        </p>
        {history.length === 0 ? (
          <p className="hint">
            Nothing settled yet.
            {openCount > 0 && ` All ${openCount} of your expenses are still open — they're in the tiles above.`}
          </p>
        ) : (
          <ul className="entry-list">
            {history.map(x => <ExpenseRow key={x.id} expense={x} {...rowProps} />)}
          </ul>
        )}
      </div>
    </div>
  )
}

/** A summary tile that opens to reveal the expenses behind its number. */
function ExpenseTile({
  label, amount, cur, sub, open, onClick, accent,
}: {
  label: string; amount: number; cur: string; sub: string
  open: boolean; onClick: () => void; accent?: boolean
}) {
  return (
    <button
      type="button"
      className={`ar-tile tile-btn ${accent ? 'owed' : ''} ${open ? 'open' : ''}`}
      onClick={onClick}
      aria-expanded={open}
    >
      <span className="ar-label">{label} <span className="tile-caret">{open ? '▾' : '▸'}</span></span>
      <span className="ar-value">{formatMoney(amount, cur)}</span>
      <span className="ar-sub">{sub}</span>
    </button>
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
          options={clients.map(c => ({ id: c.id, label: clientFullName(c) }))}
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
  expense, state, onUpdate, onDelete, onSettle, onAssign, onSplit, onGoInvoice,
}: {
  expense: Expense
  state: TractionState
  onUpdate: (x: Expense) => void
  onDelete: (id: string) => void
  onSettle: (id: string, how: SettledHow | null, note?: string) => void
  onAssign: (id: string, clientId: string | null) => void
  onSplit: (id: string, billedAmount: number) => void
  onGoInvoice: (clientId?: string) => void
}) {
  const [editing, setEditing] = useState(false)
  /** Which inline action drawer is open: settle, assign or split. */
  const [drawer, setDrawer] = useState<'settle' | 'assign' | 'split' | null>(null)
  /**
   * Deleting an expense takes two taps.
   *
   * It sits one icon away from Settle, both are single glyphs, and a thumb on a
   * phone is wider than either — an expense is money you spent, and losing the
   * record of it to a mistap is not recoverable from inside the app.
   */
  const [confirmDel, setConfirmDel] = useState(false)
  const cur = state.settings.currency
  const client = expense.clientId ? (state.clients.find(c => c.id === expense.clientId) ?? null) : null
  const clientName = expense.clientId ? clientShortName(client) : null
  const st = expenseState(expense)
  const invoiced = st === 'invoiced'
  const invNum = invoiced ? state.invoices.find(i => i.id === expense.invoiceId)?.number : null

  if (editing) {
    return (
      <li className="entry-row editing">
        <ExpenseEditor expense={expense} state={state}
          onSave={x => { onUpdate(x); setEditing(false) }} onCancel={() => setEditing(false)} />
      </li>
    )
  }

  const toggle = (d: 'settle' | 'assign' | 'split') => setDrawer(v => v === d ? null : d)
  // The row grows a second line whenever anything renders below it, including
  // the quiet "put on an invoice" shortcut.
  const hasDrawer = !!drawer || st === 'billable'

  return (
    <li className={`entry-row ${hasDrawer ? 'has-drawer' : ''} ${drawer ? 'drawer-open' : ''}`}>
      <span className={`expense-badge ${expense.billable ? 'billable' : 'overhead'}`}>{expense.category}</span>
      <div className="entry-main">
        <div className="entry-title">{expense.label || 'Expense'}
          {expense.note && <span className="entry-note"> · {expense.note}</span>}
        </div>
        <div className="entry-sub">
          <span>{formatDate(expense.date)}</span>
          {!expense.billable
            ? <span className="client-tag general">Overhead</span>
            : st === 'shelf'
              ? <span className="client-tag general" title="Bought, not attributed to a job yet">On the shelf</span>
              : <ClientLabel name={clientName} color={clientColor(client)} />}
          {invoiced && <span className="invoiced-tag" title="On an invoice">{invNum ?? 'invoiced'}</span>}
          {expense.settled && (
            <span className="settled-tag" title={expense.settled.note || 'Closed without an invoice'}>
              {SETTLED_LABELS[expense.settled.how]}
            </span>
          )}
        </div>
      </div>
      <div className="entry-figures">
        <span className="entry-dur">{formatMoney(expense.amount, cur)}</span>
      </div>
      <div className="entry-actions">
        {/* Receipts stay available even once invoiced — that is exactly when a
            client is most likely to ask for proof of a charge. */}
        <ReceiptControl expense={expense} onUpdate={onUpdate} />
        {isOpenExpense(expense) && (
          <>
            {st === 'shelf' && (
              <button className="icon-btn" title="Assign to a client" onClick={() => toggle('assign')}>◎</button>
            )}
            {st === 'billable' && (
              <button className="icon-btn" title="Charge only part of this" onClick={() => toggle('split')}>½</button>
            )}
            {/* The escape hatch: closed out without ever being invoiced. */}
            <button className="icon-btn" title="Settle without invoicing" onClick={() => toggle('settle')}>✓</button>
          </>
        )}
        {expense.settled && (
          <button className="icon-btn" title="Reopen — put it back in the list"
            onClick={() => onSettle(expense.id, null)}>↺</button>
        )}
        {!invoiced && <button className="icon-btn" title="Edit" onClick={() => setEditing(true)}>✎</button>}
        {!invoiced && (
          confirmDel
            ? (
              <button className="btn danger tiny confirm-del" onClick={() => onDelete(expense.id)}
                onBlur={() => setConfirmDel(false)}>Really delete?</button>
            ) : (
              <button className="icon-btn danger" title="Delete"
                onClick={() => setConfirmDel(true)}>✕</button>
            )
        )}
      </div>

      {drawer === 'settle' && (
        <SettleDrawer
          expense={expense}
          onDone={(how, note) => { onSettle(expense.id, how, note); setDrawer(null) }}
          onCancel={() => setDrawer(null)}
        />
      )}
      {drawer === 'assign' && (
        <AssignDrawer
          state={state}
          onPick={id => { onAssign(expense.id, id); setDrawer(null) }}
          onCancel={() => setDrawer(null)}
        />
      )}
      {drawer === 'split' && (
        <SplitDrawer
          expense={expense} cur={cur}
          onSplit={amount => { onSplit(expense.id, amount); setDrawer(null) }}
          onCancel={() => setDrawer(null)}
        />
      )}
      {st === 'billable' && !drawer && (
        <div className="row-drawer quiet">
          <button className="btn ghost tiny" onClick={() => onGoInvoice(expense.clientId ?? undefined)}>
            Put on an invoice →
          </button>
        </div>
      )}
    </li>
  )
}

/**
 * Close an expense out without an invoice.
 *
 * The reasons are named rather than free text alone, because "traded" and
 * "written off" mean different things six months later and a note by itself
 * neither sorts nor badges.
 */
function SettleDrawer({
  expense, onDone, onCancel,
}: {
  expense: Expense
  onDone: (how: SettledHow, note: string) => void
  onCancel: () => void
}) {
  const [how, setHow] = useState<SettledHow>('cash')
  const [note, setNote] = useState(expense.settled?.note ?? '')
  return (
    <div className="row-drawer">
      <span className="drawer-label">Settle without invoicing</span>
      <div className="settle-opts">
        {SETTLED_OPTIONS.map(o => (
          <button key={o} type="button" className={`chip ${how === o ? 'sel' : ''}`}
            onClick={() => setHow(o)}>{SETTLED_LABELS[o]}</button>
        ))}
      </div>
      <input
        placeholder="What happened? (optional — e.g. traded for birthday tickets)"
        value={note} onChange={e => setNote(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onDone(how, note.trim()) }}
      />
      <div className="drawer-actions">
        <button className="btn primary tiny" onClick={() => onDone(how, note.trim())}>Settle</button>
        <button className="btn ghost tiny" onClick={onCancel}>Cancel</button>
      </div>
      <p className="hint tiny">
        Stays in history with the amount intact — it just stops waiting to be billed.
      </p>
    </div>
  )
}

/** Attach a shelf expense to whoever ended up using it. */
function AssignDrawer({
  state, onPick, onCancel,
}: {
  state: TractionState
  onPick: (clientId: string) => void
  onCancel: () => void
}) {
  const clients = state.clients.filter(c => !c.archived)
  return (
    <div className="row-drawer">
      <span className="drawer-label">Whose job did this go to?</span>
      <div className="settle-opts">
        {clients.map(c => (
          <button key={c.id} type="button" className="chip" onClick={() => onPick(c.id)}>
            {clientShortName(c)}
          </button>
        ))}
      </div>
      <div className="drawer-actions">
        <button className="btn ghost tiny" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

/**
 * Charge part of an expense now and shelve the rest.
 *
 * The remainder becomes an unattributed expense rather than staying on this
 * client: half a bundle of lumber you did not use is material you own, not
 * money they still owe.
 */
function SplitDrawer({
  expense, cur, onSplit, onCancel,
}: {
  expense: Expense
  cur: string
  onSplit: (billedAmount: number) => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState(() => (expense.amount / 2).toFixed(2))
  const billed = Math.max(0, Math.min(Number(amount) || 0, expense.amount))
  const left = Math.round((expense.amount - billed) * 100) / 100
  const bad = billed <= 0 || left <= 0
  return (
    <div className="row-drawer">
      <span className="drawer-label">Charge only part of {formatMoney(expense.amount, cur)}</span>
      <div className="split-row">
        <label className="field narrow-field">
          <span>Charge them</span>
          <input type="number" min="0" step="0.01" max={expense.amount}
            value={amount} onChange={e => setAmount(e.target.value)} />
        </label>
        <button type="button" className="btn ghost tiny"
          onClick={() => setAmount((expense.amount / 2).toFixed(2))}>Half</button>
        <span className="split-left">{formatMoney(left, cur)} → shelf</span>
      </div>
      <div className="drawer-actions">
        <button className="btn primary tiny" disabled={bad} onClick={() => onSplit(billed)}>Split</button>
        <button className="btn ghost tiny" onClick={onCancel}>Cancel</button>
      </div>
      <p className="hint tiny">
        Their invoice shows the charge with a note explaining the rest was unused. The
        remainder goes to the shelf with no client, ready for whoever uses it.
      </p>
    </div>
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
          options={state.clients.map(c => ({ id: c.id, label: clientFullName(c) }))}
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
