import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import type { Expense, Measure, SettledHow, TractionState } from '../types'
import {
  EXPENSE_CATEGORIES, clientColor, clientFullName, clientShortName,
  formatDate, formatMoney, makeExpense, todayISO,
  expenseState, isOpenExpense, isAbsorbed, lineageMark, siblingsOf, receiptRefCount,
  SETTLED_LABELS, SETTLED_OPTIONS, DEFAULT_MARKUP_PCT, billedAmount, costPerUnit, suggestUnitPrice,
} from '../store'
import { ClientLabel } from '../Chrome'
import { supabase } from '../supabaseClient'
import { ReceiptError, deleteReceipt, receiptUrl, uploadReceipt } from '../receipts'
import { useShelfDrag, type DropTarget } from '../useShelfDrag'
import { Picker } from './Picker'

/** The two lists of expenses still waiting on a decision. */
type OpenGroup = 'billable' | 'shelf'

/**
 * A drop that cannot be carried out silently, held until the user answers.
 *
 *  assign    — dragged off the shelf: whose job did it go to?
 *  merge     — dropped onto a sibling: confirm the two are physically one again
 *  detach    — dragged back to the shelf off an invoice a client may have seen
 *  blocked   — the drop is refused, with the reason why
 */
type PendingDrop =
  | { kind: 'assign'; id: string }
  | { kind: 'merge'; survivorId: string; absorbedId: string }
  | { kind: 'detach'; id: string; invoiceId: string }
  | { kind: 'blocked'; reason: string }

export function ExpensesView({
  state, onAdd, onUpdate, onDelete, onSettle, onAssign, onSplit,
  onSplitEqually, onDrawMeasured, onRecombine, onDetachFromInvoice, onDeleteInvoice, onGoInvoice,
}: {
  state: TractionState
  onAdd: (x: Expense) => void
  onUpdate: (x: Expense) => void
  onDelete: (id: string) => void
  onSettle: (id: string, how: SettledHow | null, note?: string) => void
  onAssign: (id: string, clientId: string | null) => void
  onSplit: (id: string, billedAmount: number) => void
  onSplitEqually: (id: string, parts: number) => void
  onDrawMeasured: (id: string, clientId: string, qty: number) => void
  onRecombine: (survivorId: string, absorbedIds: string[]) => void
  onDetachFromInvoice: (id: string) => void
  onDeleteInvoice: (id: string) => void
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

  /** A drop that needs an answer before anything moves. */
  const [pending, setPending] = useState<PendingDrop | null>(null)

  const byState = useMemo(() => {
    const groups = { billable: [] as Expense[], shelf: [] as Expense[], settled: [] as Expense[] }
    for (const x of state.expenses) {
      // A piece that has been merged back into a sibling is history, not money.
      if (isAbsorbed(x)) continue
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
   * What a released drag means.
   *
   * Every outcome that changes what a client is told — attributing material to
   * somebody, merging two pieces, pulling something off an invoice — stops here
   * for an answer. Only taking a client back off an un-invoiced expense goes
   * through immediately, because that costs nothing and is one drag to undo.
   */
  const handleDrop = (id: string, target: DropTarget) => {
    const exp = state.expenses.find(x => x.id === id)
    if (!exp) return
    const st = expenseState(exp)
    // Something dropped into a collapsed card would otherwise vanish on arrival.
    if (target.kind === 'shelf' || target.kind === 'billable') {
      setOpen(prev => new Set(prev).add(target.kind as OpenGroup))
    }

    if (target.kind === 'merge') {
      const onto = state.expenses.find(x => x.id === target.id)
      if (!onto) return
      if (!exp.lineageId || exp.lineageId !== onto.lineageId) {
        setPending({ kind: 'blocked', reason:
          'Those two were never one thing. Only pieces cut from the same original purchase can be put back together — a 50yd piece of one brand and 50yd of another are not a 100yd roll.' })
        return
      }
      if (exp.invoiceId || onto.invoiceId) {
        setPending({ kind: 'blocked', reason:
          'One of those is on an invoice. Drag it back to the shelf first — that way you get asked about the invoice before anything merges.' })
        return
      }
      setPending({ kind: 'merge', survivorId: onto.id, absorbedId: exp.id })
      return
    }

    if (target.kind === 'billable') {
      if (st === 'shelf') setPending({ kind: 'assign', id })
      return
    }

    // Dropped on the shelf: the client, if any, comes off.
    if (st === 'invoiced' && exp.invoiceId) {
      const inv = state.invoices.find(i => i.id === exp.invoiceId)
      if (inv?.status === 'paid') {
        setPending({ kind: 'blocked', reason:
          "That invoice has been paid. Un-billing money that has already landed would make your records disagree with what the client actually paid — if you owe them for it, put it on the next invoice as a credit instead." })
        return
      }
      setPending({ kind: 'detach', id, invoiceId: exp.invoiceId })
      return
    }
    if (st === 'billable') onAssign(id, null)
  }

  const { drag, dragHandle } = useShelfDrag(handleDrop)
  const dragged = drag.id ? state.expenses.find(x => x.id === drag.id) ?? null : null

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
  /** Money owed is what clients will be charged — for measured material that
   *  is units x price, not what the jug cost you. */
  const billedSum = (list: Expense[]) => list.reduce((s, x) => s + billedAmount(x), 0)
  const overhead = sum(state.expenses.filter(x => !x.billable && !isAbsorbed(x)))
  const openCount = byState.billable.length + byState.shelf.length
  /**
   * Shelf first, always.
   *
   * It used to render underneath "ready to bill", where a long list of billable
   * expenses pushed it off the bottom of a phone and material you owned became
   * the easiest thing in the app to forget you had.
   */
  const groups: { id: OpenGroup; label: string; list: Expense[]; empty: string }[] = [
    { id: 'shelf', label: 'On the shelf', list: byState.shelf,
      empty: 'Nothing on the shelf. Anything billable with no client lands here.' },
    { id: 'billable', label: 'Ready to bill', list: byState.billable,
      empty: 'Nothing waiting to be billed.' },
  ]

  const rowProps = {
    state, onUpdate, onDelete, onSettle, onAssign, onSplit, onSplitEqually, onDrawMeasured, onGoInvoice,
    dragHandle, draggingId: drag.id,
    mergeTargetId: drag.target?.kind === 'merge' ? drag.target.id : null,
  }

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
            label="Ready to bill" amount={billedSum(byState.billable)} cur={cur}
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
            tone="shelf"
          />
          <div className="ar-tile">
            <span className="ar-label">Overhead logged</span>
            <span className="ar-value">{formatMoney(overhead, cur)}</span>
            <span className="ar-sub">your own costs</span>
          </div>
        </div>

        {/* Two real subcards rather than one anonymous drawer. The tile above and
            the header here drive the SAME open state — one truth, two handles —
            because two controls that disagree about one thing is the actual
            complexity trap. */}
        {groups.map(g => (
          <ExpenseGroupCard
            key={g.id}
            group={g}
            cur={cur}
            open={open.has(g.id)}
            onToggle={() => toggleGroup(g.id)}
            dropActive={drag.id !== null && drag.target?.kind === g.id}
            dragging={drag.id !== null}
          >
            {g.list.map(x => <ExpenseRow key={x.id} expense={x} {...rowProps} />)}
          </ExpenseGroupCard>
        ))}
      </div>

      {dragged && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          <span className="drag-ghost-label">{dragged.label || 'Expense'}</span>
          <span className="drag-ghost-amount">{formatMoney(dragged.amount, cur)}</span>
        </div>
      )}

      {pending && (
        <DropDialog
          pending={pending}
          state={state}
          onClose={() => setPending(null)}
          onAssign={onAssign}
          onDrawMeasured={onDrawMeasured}
          onRecombine={onRecombine}
          onDetach={onDetachFromInvoice}
          onDeleteInvoice={onDeleteInvoice}
        />
      )}

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
  label, amount, cur, sub, open, onClick, accent, tone,
}: {
  label: string; amount: number; cur: string; sub: string
  open: boolean; onClick: () => void; accent?: boolean; tone?: 'shelf'
}) {
  return (
    <button
      type="button"
      className={`ar-tile tile-btn ${accent ? 'owed' : ''} ${tone ? `tone-${tone}` : ''} ${open ? 'open' : ''}`}
      onClick={onClick}
      aria-expanded={open}
    >
      <span className="ar-label">{label} <span className="tile-caret">{open ? '▾' : '▸'}</span></span>
      <span className="ar-value">{formatMoney(amount, cur)}</span>
      <span className="ar-sub">{sub}</span>
    </button>
  )
}

/**
 * One of the two open lists, as a card you can drop material into.
 *
 * The whole card is the drop zone rather than the rows inside it, so landing a
 * piece "in the shelf" does not require hitting a 40px row — and an empty shelf
 * is still a target, which it has to be or the very first item could never be
 * put back.
 */
function ExpenseGroupCard({
  group, cur, open, onToggle, dropActive, dragging, children,
}: {
  group: { id: OpenGroup; label: string; list: Expense[]; empty: string }
  cur: string
  open: boolean
  onToggle: () => void
  dropActive: boolean
  dragging: boolean
  children: ReactNode
}) {
  // Same numbers as the tiles above: money owed is what clients will be
  // charged, material on the shelf is what you paid.
  const total = group.list.reduce((s, x) => s + (group.id === 'billable' ? billedAmount(x) : x.amount), 0)
  return (
    <section
      className={`group-card group-${group.id} ${open ? 'open' : 'closed'} ${dropActive ? 'drop-active' : ''} ${dragging ? 'drop-armed' : ''}`}
      data-drop={group.id}
    >
      <button type="button" className="group-head" onClick={onToggle} aria-expanded={open}>
        <span className="group-caret">{open ? '▾' : '▸'}</span>
        <span className="group-title">{group.label}</span>
        <span className="group-count">{group.list.length}</span>
        <span className="group-total">{formatMoney(total, cur)}</span>
      </button>
      {open && (
        group.list.length === 0
          ? <p className="hint tiny group-empty">{group.empty}</p>
          : <ul className="entry-list open-expenses">{children}</ul>
      )}
      {/* Collapsing must never hide a live drop target: a card shut with
          something in the air still accepts it and opens to show where it went. */}
      {!open && dragging && <p className="hint tiny group-empty">Drop here to move it to {group.label.toLowerCase()}</p>}
    </section>
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
  const [measure, setMeasure] = useState<Measure | null>(null)
  // Measured material starts on the shelf and is drawn off it by the unit, so
  // it only makes sense billable and with no client yet.
  const measured = billable && !clientId && measure
  const measureBad = !!measured && !measureValid(measured)

  function submit() {
    const amt = Number(amount) || 0
    if (!label.trim() || amt <= 0 || measureBad) return
    onAdd({
      ...makeExpense(date),
      label: label.trim(), amount: amt, category,
      clientId: clientId || null, billable, note: note.trim(),
      measure: measured ? cleanMeasure(measured) : null,
    })
    setLabel(''); setAmount(''); setNote(''); setMeasure(null)
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
        <>
          <MeasureFields amount={Number(amount) || 0} cur={state.settings.currency} value={measure} onChange={setMeasure} />
          {!measure && (
            <p className="hint tiny">Heads up: a billable expense needs a client to be added to an invoice.</p>
          )}
        </>
      )}
      <button className="btn primary" disabled={!label.trim() || (Number(amount) || 0) <= 0 || measureBad} onClick={submit}>
        Log expense
      </button>
    </div>
  )
}

function ExpenseRow({
  expense, state, onUpdate, onDelete, onSettle, onAssign, onSplit, onSplitEqually, onDrawMeasured,
  onGoInvoice, dragHandle, draggingId, mergeTargetId,
}: {
  expense: Expense
  state: TractionState
  onUpdate: (x: Expense) => void
  onDelete: (id: string) => void
  onSettle: (id: string, how: SettledHow | null, note?: string) => void
  onAssign: (id: string, clientId: string | null) => void
  onSplit: (id: string, billedAmount: number) => void
  onSplitEqually: (id: string, parts: number) => void
  onDrawMeasured: (id: string, clientId: string, qty: number) => void
  onGoInvoice: (clientId?: string) => void
  dragHandle: (id: string) => { onPointerDown: (e: ReactPointerEvent) => void }
  draggingId: string | null
  mergeTargetId: string | null
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

  const absorbed = isAbsorbed(expense)
  const draggable = isOpenExpense(expense) || st === 'invoiced'
  const siblings = siblingsOf(expense, state.expenses)
  const mark = expense.lineageId && siblings.length > 0 ? lineageMark(expense.lineageId) : null
  // A receipt shared with siblings is a receipt for MORE than this row. Said
  // here rather than burned into the photo: the image is evidence, one photo
  // often covers several expenses, and stamped pixels cannot be taken back.
  const partialReceipt = !!expense.receiptPath && siblings.some(s => s.receiptPath === expense.receiptPath)
  const m = expense.measure ?? null

  return (
    <li
      className={[
        'entry-row',
        hasDrawer ? 'has-drawer' : '', drawer ? 'drawer-open' : '',
        st === 'shelf' ? 'on-shelf' : '',
        absorbed ? 'absorbed' : '',
        draggingId === expense.id ? 'is-dragging' : '',
        mergeTargetId === expense.id ? 'merge-target' : '',
        draggable ? 'draggable' : '',
      ].filter(Boolean).join(' ')}
      // Only a piece with living siblings can be merged into, so only those
      // announce themselves as a target — dropping onto anything else is a miss.
      {...(mark && !expense.invoiceId ? { 'data-drop': 'merge', 'data-drop-id': expense.id } : {})}
      {...(draggable ? dragHandle(expense.id) : {})}
    >
      <span className={`expense-badge ${expense.billable ? 'billable' : 'overhead'}`}>{expense.category}</span>
      <div className="entry-main">
        <div className="entry-title">{expense.label || 'Expense'}
          {expense.note && <span className="entry-note"> · {expense.note}</span>}
        </div>
        <div className="entry-sub">
          <span>{formatDate(expense.date)}</span>
          {absorbed
            ? <span className="client-tag general" title="Merged back into a sibling piece">Merged</span>
            : !expense.billable
              ? <span className="client-tag general">Overhead</span>
              : st === 'shelf'
                ? <span className="client-tag shelf-tag" title="Bought, not attributed to a job yet">On the shelf</span>
                : <ClientLabel name={clientName} color={clientColor(client)} />}
          {/* The shared mark: colour answers "can these two snap together?" at a
              glance, the code settles it when two lineages land on close hues. */}
          {mark && (
            <span
              className="lineage-tag"
              style={{ '--lineage-hue': mark.hue } as CSSProperties}
              title={`Cut from one purchase — ${siblings.length} other piece${siblings.length === 1 ? '' : 's'} still around. Drag one onto another to put them back together.`}
            >◆ {mark.code}</span>
          )}
          {partialReceipt && (
            <span className="partial-tag" title="This receipt covers more than this row — it is shared with the other pieces cut from the same purchase.">
              part of a shared receipt
            </span>
          )}
          {invoiced && <span className="invoiced-tag" title="On an invoice">{invNum ?? 'invoiced'}</span>}
          {expense.settled && (
            <span className="settled-tag" title={expense.settled.note || 'Closed without an invoice'}>
              {SETTLED_LABELS[expense.settled.how]}
            </span>
          )}
          {m && (st === 'shelf'
            ? <span className="measure-tag" title={`${formatMoney(costPerUnit(expense), cur)} cost per ${m.unit || 'unit'}; clients pay ${formatMoney(m.unitPrice, cur)}`}>
                {m.qty} of {m.holds} {m.unit} left
              </span>
            : <span className="measure-tag" title={`${m.qty} ${m.unit} of ${expense.label || 'this'}`}>
                {m.clientLabel || expense.label} × {m.qty}
              </span>)}
        </div>
      </div>
      <div className="entry-figures">
        {/* On a client, a measured piece shows what they'll be charged — that is
            the number the "ready to bill" tile adds up. On the shelf it is still
            what you paid: nobody owes it yet. */}
        {m && expense.clientId
          ? <span className="entry-dur" title={`Cost you ${formatMoney(expense.amount, cur)}`}>{formatMoney(billedAmount(expense), cur)}</span>
          : <span className="entry-dur">{formatMoney(expense.amount, cur)}</span>}
      </div>
      <div className="entry-actions">
        {/* Receipts stay available even once invoiced — that is exactly when a
            client is most likely to ask for proof of a charge. */}
        <ReceiptControl expense={expense} all={state.expenses} onUpdate={onUpdate} />
        {isOpenExpense(expense) && (
          <>
            {st === 'shelf' && (
              <button className="icon-btn" title="Assign to a client" onClick={() => toggle('assign')}>◎</button>
            )}
            {/* Splitting is no longer reserved for expenses that already have a
                client. Material gets cut up BEFORE you know whose job it is far
                more often than after. Measured material is drawn off by the
                unit instead, through assign. */}
            {!m && (
              <button className="icon-btn"
                title={st === 'shelf' ? 'Cut this into pieces' : 'Charge only part of this'}
                onClick={() => toggle('split')}>½</button>
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
          measure={m}
          onPick={(id, qty) => {
            if (m) onDrawMeasured(expense.id, id, qty); else onAssign(expense.id, id)
            setDrawer(null)
          }}
          onCancel={() => setDrawer(null)}
        />
      )}
      {drawer === 'split' && (
        <SplitDrawer
          expense={expense} cur={cur} shelf={st === 'shelf'}
          onSplit={amount => { onSplit(expense.id, amount); setDrawer(null) }}
          onSplitEqually={parts => { onSplitEqually(expense.id, parts); setDrawer(null) }}
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
  state, measure, onPick, onCancel,
}: {
  state: TractionState
  /** Set for measured material: how much went on the job is asked first. */
  measure: Measure | null
  onPick: (clientId: string, qty: number) => void
  onCancel: () => void
}) {
  const clients = state.clients.filter(c => !c.archived)
  const [qty, setQty] = useState(() => measure ? Math.min(measure.usual, measure.qty) : 0)
  const bad = !!measure && !(qty >= 1 && qty <= measure.qty)
  return (
    <div className="row-drawer">
      <span className="drawer-label">Whose job did this go to?</span>
      {measure && <QtyField measure={measure} value={qty} onChange={setQty} />}
      <div className="settle-opts">
        {clients.map(c => (
          <button key={c.id} type="button" className="chip" disabled={bad} onClick={() => onPick(c.id, qty)}>
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
  expense, cur, shelf, onSplit, onSplitEqually, onCancel,
}: {
  expense: Expense
  cur: string
  /** True when this piece is on the shelf, where no client is in the picture. */
  shelf: boolean
  onSplit: (billedAmount: number) => void
  onSplitEqually: (parts: number) => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState(() => (expense.amount / 2).toFixed(2))
  const billed = Math.max(0, Math.min(Number(amount) || 0, expense.amount))
  const left = Math.round((expense.amount - billed) * 100) / 100
  const bad = billed <= 0 || left <= 0

  /**
   * Equal pieces, for material bought in units you think of as fractions — a
   * bucket that treats five roofs, 300yd of fabric across three jobs. Getting
   * there by halving twice both misstates the pieces and is a chore.
   */
  const equalParts = [2, 3, 4, 5]

  return (
    <div className="row-drawer">
      <span className="drawer-label">
        {shelf ? `Cut up ${formatMoney(expense.amount, cur)}` : `Charge only part of ${formatMoney(expense.amount, cur)}`}
      </span>
      <div className="split-row">
        <label className="field narrow-field">
          <span>{shelf ? 'Take off' : 'Charge them'}</span>
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
      <div className="split-equal">
        <span className="dim tiny">or cut into equal pieces</span>
        <div className="settle-opts">
          {equalParts.map(n => (
            <button key={n} type="button" className="chip" onClick={() => onSplitEqually(n)}>
              {n} × {formatMoney(Math.floor((expense.amount * 100) / n) / 100, cur)}
            </button>
          ))}
        </div>
      </div>
      <p className="hint tiny">
        {shelf
          ? 'Every piece stays on the shelf, carrying a shared mark so you can tell they came off the same purchase — and put them back together later.'
          : 'Their invoice shows the charge with a note explaining the rest was unused. The remainder goes to the shelf with no client, ready for whoever uses it.'}
      </p>
    </div>
  )
}

/**
 * The question a released drag asks before anything actually moves.
 *
 * Every one of these changes what a client is told they owe, which is not
 * something a gesture should be able to do on its own — a thumb slipping in a
 * yard is not consent to re-bill somebody.
 */
function DropDialog({
  pending, state, onClose, onAssign, onDrawMeasured, onRecombine, onDetach, onDeleteInvoice,
}: {
  pending: PendingDrop
  state: TractionState
  onClose: () => void
  onAssign: (id: string, clientId: string | null) => void
  onDrawMeasured: (id: string, clientId: string, qty: number) => void
  onRecombine: (survivorId: string, absorbedIds: string[]) => void
  onDetach: (id: string) => void
  onDeleteInvoice: (id: string) => void
}) {
  const cur = state.settings.currency
  const clients = state.clients.filter(c => !c.archived)
  const find = (id: string) => state.expenses.find(x => x.id === id) ?? null
  const assignMeasure = pending.kind === 'assign' ? find(pending.id)?.measure ?? null : null
  const [qty, setQty] = useState(() => assignMeasure ? Math.min(assignMeasure.usual, assignMeasure.qty) : 0)

  let body: ReactNode = null
  let title = ''

  if (pending.kind === 'assign') {
    const exp = find(pending.id)
    title = 'Whose job did this go to?'
    body = (
      <>
        <p className="hint tiny">
          {assignMeasure
            ? <>How much went on the job? That much comes out of {exp?.label || 'the container'} and
                waits to be billed; the rest stays on the shelf.</>
            : <>{exp?.label || 'This'} comes off the shelf and waits to be billed. It is not on
                an invoice yet — that is still a separate step.</>}
        </p>
        {assignMeasure && <QtyField measure={assignMeasure} value={qty} onChange={setQty} />}
        <div className="settle-opts">
          {clients.map(c => (
            <button key={c.id} type="button" className="chip"
              disabled={!!assignMeasure && !(qty >= 1 && qty <= assignMeasure.qty)}
              onClick={() => {
                if (assignMeasure) onDrawMeasured(pending.id, c.id, qty); else onAssign(pending.id, c.id)
                onClose()
              }}>
              {clientShortName(c)}
            </button>
          ))}
        </div>
      </>
    )
  } else if (pending.kind === 'merge') {
    const survivor = find(pending.survivorId)
    const absorbed = find(pending.absorbedId)
    const total = (survivor?.amount ?? 0) + (absorbed?.amount ?? 0)
    const sm = survivor?.measure
    const am = absorbed?.measure
    title = sm ? 'Pour it back in?' : 'Put these back together?'
    body = (
      <>
        <p className="hint tiny">
          {sm && am
            ? <>{am.qty} {am.unit} goes back into {survivor?.label || 'the container'}, leaving{' '}
                <strong>{sm.qty + am.qty} {sm.unit}</strong>. Only do this if it really went unused.</>
            : <>{formatMoney(absorbed?.amount ?? 0, cur)} merges into {formatMoney(survivor?.amount ?? 0, cur)},
                leaving one piece worth <strong>{formatMoney(total, cur)}</strong>. Only do this if
                they really are one thing again in the shed.</>}
        </p>
        <div className="drawer-actions">
          <button className="btn primary tiny"
            onClick={() => { onRecombine(pending.survivorId, [pending.absorbedId]); onClose() }}>
            Merge them
          </button>
          <button className="btn ghost tiny" onClick={onClose}>Cancel</button>
        </div>
      </>
    )
  } else if (pending.kind === 'detach') {
    const inv = state.invoices.find(i => i.id === pending.invoiceId)
    const sent = inv?.status === 'sent'
    title = sent ? 'That invoice has already been sent' : 'Take it off the draft invoice?'
    body = (
      <>
        <p className="hint tiny">
          {sent
            ? <>Invoice <strong>{inv?.number}</strong> is out with the client. Detaching leaves
                what you have on file disagreeing with the number in their inbox — so either
                void the whole thing and rebuild it, or detach and accept the mismatch
                (a note goes on the invoice either way).</>
            : <>Nobody has seen invoice <strong>{inv?.number}</strong> yet, so this is free —
                the line simply comes off and the material goes back on the shelf.</>}
        </p>
        <div className="drawer-actions">
          <button className="btn primary tiny"
            onClick={() => { onDetach(pending.id); onClose() }}>
            {sent ? 'Detach anyway' : 'Take it off'}
          </button>
          {sent && (
            <button className="btn danger tiny"
              onClick={() => { onDeleteInvoice(pending.invoiceId); onClose() }}>
              Void the whole invoice
            </button>
          )}
          <button className="btn ghost tiny" onClick={onClose}>Cancel</button>
        </div>
      </>
    )
  } else {
    title = "Can't do that"
    body = (
      <>
        <p className="hint tiny">{pending.reason}</p>
        <div className="drawer-actions">
          <button className="btn ghost tiny" onClick={onClose}>OK</button>
        </div>
      </>
    )
  }

  return (
    <div className="drop-dialog-backdrop" onClick={onClose}>
      <div className="drop-dialog" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <h4>{title}</h4>
        {body}
      </div>
    </div>
  )
}

/**
 * Attach / view / remove the receipt photo for one expense. Only the object
 * path is written back onto the expense — the image itself lives in Storage.
 *
 * Takes the whole expense list because split pieces SHARE one stored photo:
 * detaching it here must leave the siblings' copy alone, and only delete the
 * object once nothing points at it any more.
 */
function ReceiptControl({
  expense, all, onUpdate,
}: {
  expense: Expense
  all: Expense[]
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
      // Shared with a sibling piece? Then it is still somebody's evidence.
      if (previous && receiptRefCount(previous, all.filter(x => x.id !== expense.id)) === 0) {
        await deleteReceipt(supabase, previous)
      }
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
    // Only the last piece still pointing at the photo may delete it.
    if (receiptRefCount(path, all.filter(x => x.id !== expense.id)) === 0) {
      await deleteReceipt(supabase, path)
    }
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
  // Quantity tracking is offered on anything billable that isn't a piece
  // already drawn off a container — i.e. on the shelf, or already measured.
  const canMeasure = x.billable && (!x.clientId || !!expense.measure)
  const measure = canMeasure ? x.measure ?? null : null
  const bad = !!measure && !measureValid(measure)

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
      {canMeasure && (
        <MeasureFields amount={x.amount} cur={state.settings.currency} value={measure} existing={!!expense.measure}
          onChange={mm => set({ measure: mm })} />
      )}
      <div className="editor-actions">
        <button className="btn primary" disabled={bad}
          onClick={() => onSave({ ...x, measure: measure ? cleanMeasure(measure) : null })}>Save</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

/** True once a measure can actually be drawn from and billed. */
function measureValid(m: Measure): boolean {
  return !!m.unit.trim() && m.holds >= 1 && m.qty >= 0 && m.qty <= m.holds
    && m.unitPrice >= 0 && m.usual >= 1
}

function cleanMeasure(m: Measure): Measure {
  return {
    ...m,
    unit: m.unit.trim(),
    clientLabel: m.clientLabel.trim(),
    holds: Math.floor(m.holds),
    qty: Math.floor(m.qty),
    usual: Math.floor(m.usual),
    unitPrice: Math.round(m.unitPrice * 100) / 100,
  }
}

/**
 * "Track by quantity" and the fields behind it.
 *
 * The price box starts at cost per unit plus the default markup and follows
 * the amount until you type in it yourself — after that it is yours. Most
 * treatments are worth more than the chemical in them, and the box should be
 * a starting point, not a verdict.
 */
function MeasureFields({
  amount, cur, value, existing = false, onChange,
}: {
  /** What was paid, for the cost-per-unit hint and the price suggestion. */
  amount: number
  cur: string
  value: Measure | null
  /** Editing a container already in use — show what's left, keep the price. */
  existing?: boolean
  onChange: (m: Measure | null) => void
}) {
  const [priceTouched, setPriceTouched] = useState(existing)
  const m = value
  const set = (patch: Partial<Measure>) => {
    if (!m) return
    const next = { ...m, ...patch }
    // A fresh container is full: "holds" and "left" are the same number.
    if (!existing && patch.holds !== undefined) next.qty = patch.holds
    onChange(next)
  }
  const num = (v: string) => v === '' ? 0 : Math.max(0, Math.floor(Number(v) || 0))

  // Until you type a price yourself, it follows the cost: change the amount or
  // what the container holds and the suggestion moves with it.
  const suggested = m ? suggestUnitPrice(amount, m.qty || m.holds) : 0
  const follow = !!m && !priceTouched && m.unitPrice !== suggested
  useEffect(() => {
    if (follow && m) onChange({ ...m, unitPrice: suggested })
  }, [follow, suggested]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="measure-fields">
      <label className="check-field">
        <input type="checkbox" checked={!!m}
          onChange={e => {
            setPriceTouched(existing)
            onChange(e.target.checked
              ? { unit: '', holds: 0, qty: 0, clientLabel: '', unitPrice: 0, usual: 1 }
              : null)
          }} />
        <span>Track by quantity</span>
        <span className="hint tiny">— use a bit at a time, bill each job for what it used</span>
      </label>
      {m && (
        <>
          <div className="field-row">
            <label className="field narrow-field"><span>Unit</span>
              <input placeholder="fl oz" value={m.unit} onChange={e => set({ unit: e.target.value })} /></label>
            <label className="field narrow-field"><span>Holds</span>
              <input type="number" min="1" step="1" placeholder="32" value={m.holds || ''}
                onChange={e => set({ holds: num(e.target.value) })} /></label>
            {existing && (
              <label className="field narrow-field"><span>Left</span>
                <input type="number" min="0" step="1" value={m.qty}
                  onChange={e => set({ qty: num(e.target.value) })} /></label>
            )}
            <label className="field narrow-field"><span>Usual per job</span>
              <input type="number" min="1" step="1" value={m.usual || ''}
                onChange={e => set({ usual: num(e.target.value) })} /></label>
          </div>
          <div className="field-row">
            <label className="field"><span>Name on invoice</span>
              <input placeholder="e.g. Herbicide treatment" value={m.clientLabel}
                onChange={e => set({ clientLabel: e.target.value })} /></label>
            <label className="field narrow-field"><span>Price per {m.unit.trim() || 'unit'}</span>
              <input type="number" min="0" step="0.01" value={m.unitPrice || ''}
                onChange={e => { setPriceTouched(true); set({ unitPrice: Number(e.target.value) || 0 }) }} /></label>
          </div>
          <p className="hint tiny">
            {(m.qty || m.holds) > 0 && amount > 0
              ? <>Costs you {formatMoney(amount / (m.qty || m.holds), cur)} per {m.unit.trim() || 'unit'}
                  {!priceTouched && <> — price starts at cost + {DEFAULT_MARKUP_PCT}%</>}.
                  {' '}Clients see the name on invoice, the count and the price — never what you paid.</>
              : <>Enter what it holds to see your cost per unit.</>}
          </p>
        </>
      )}
    </div>
  )
}

/** How many units went on this job — starts at the usual, capped at what's left. */
function QtyField({ measure, value, onChange }: {
  measure: Measure
  value: number
  onChange: (n: number) => void
}) {
  return (
    <label className="field qty-field"><span>How many {measure.unit || 'units'}? ({measure.qty} left)</span>
      <input type="number" min="1" max={measure.qty} step="1" value={value || ''}
        onChange={e => onChange(Math.floor(Number(e.target.value) || 0))} />
    </label>
  )
}
