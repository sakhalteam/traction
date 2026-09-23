import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AdjustmentKind,
  Breakdown,
  BreakdownDay,
  BreakdownLine,
  Client,
  DurationStyle,
  Expense,
  ExpenseLine,
  Favorite,
  Invoice,
  Measure,
  Person,
  Service,
  Settings,
  SettledHow,
  TimeEntry,
  TractionState,
} from './types'

export const EXPENSE_CATEGORIES = ['Materials', 'Fuel', 'Equipment', 'Fees', 'Supplies', 'Other']

const STORAGE_KEY = 'traction-state'
const UPDATED_AT_KEY = 'traction-updated-at'
const REMOTE_SEEN_KEY = 'traction-remote-seen'
const DIRTY_KEY = 'traction-dirty'

export const PALETTE = [
  '#22c55e', '#10b981', '#14b8a6', '#0ea5e9',
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#84cc16', '#64748b',
]

export function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function randomColor(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)]
}

export function defaultSettings(): Settings {
  return {
    businessName: '',
    businessEmail: '',
    businessPhone: '',
    businessAddress: '',
    favorites: [],
    invoiceCounter: 1,
    currency: '$',
    durationFormat: 'hm',
    netDays: 30,
    logoPath: null,
  }
}

// ---- Favourites ----------------------------------------------------------

/** Stable key for a service+client pairing, for set membership and React keys. */
export function jobKey(serviceId: string, clientId: string | null): string {
  return `${serviceId}::${clientId ?? ''}`
}

export function isFavorite(favorites: Favorite[] | undefined, serviceId: string, clientId: string | null): boolean {
  const key = jobKey(serviceId, clientId)
  return (favorites ?? []).some(f => jobKey(f.serviceId, f.clientId) === key)
}

/** Add or remove a pinned job, returning a new list. */
export function toggleFavorite(
  favorites: Favorite[] | undefined,
  serviceId: string,
  clientId: string | null,
): Favorite[] {
  const list = favorites ?? []
  const key = jobKey(serviceId, clientId)
  const without = list.filter(f => jobKey(f.serviceId, f.clientId) !== key)
  return without.length === list.length ? [...list, { serviceId, clientId }] : without
}

export function emptyState(): TractionState {
  return { clients: [], services: [], entries: [], expenses: [], invoices: [], settings: defaultSettings() }
}

/** No real data yet — a device that's been opened but never actually used. */
export function isEmptyState(s: TractionState): boolean {
  return s.clients.length === 0 && s.services.length === 0 && s.entries.length === 0
    && s.expenses.length === 0 && s.invoices.length === 0
}

// ---- Factories -----------------------------------------------------------

export function makeClient(name: string): Client {
  return {
    id: genId(), name, email: '', phone: '', address: '', notes: '',
    rates: {}, archived: false, createdAt: Date.now(),
  }
}

/** Rate to bill a service at for a given client: per-client override → service default. */
export function resolveRate(
  service: Service | undefined,
  client: Client | null | undefined,
): number {
  if (service && client && client.rates?.[service.id] != null) return client.rates[service.id]
  return service?.defaultRate ?? 0
}

export function makeService(name: string, defaultRate: number): Service {
  return {
    id: genId(), name, defaultRate, color: randomColor(),
    archived: false, createdAt: Date.now(),
  }
}

export function makeEntry(
  serviceId: string, rate: number, clientId: string | null, date: string,
  startedAt: number | null = null,
): TimeEntry {
  return {
    id: genId(), clientId, serviceId, note: '', date, startedAt,
    seconds: 0, runningSince: null, rate, invoiceId: null,
    photoPaths: [], createdAt: Date.now(),
  }
}

export function makeExpense(date: string): Expense {
  return {
    id: genId(), clientId: null, label: '', amount: 0, category: 'Materials',
    date, billable: true, invoiceId: null, note: '', receiptPath: null, createdAt: Date.now(),
  }
}

// ---- Date / time helpers -------------------------------------------------

/** Local 'YYYY-MM-DD' for a given Date (defaults to now). */
export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Live duration of an entry including any running span, in seconds. */
export function liveSeconds(e: TimeEntry, now: number = Date.now()): number {
  const running = e.runningSince ? Math.floor((now - e.runningSince) / 1000) : 0
  return e.seconds + Math.max(0, running)
}

/** "3h 47m", or "3.78h" in decimal style. */
export function formatDuration(totalSeconds: number, style: DurationStyle = 'hm'): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  if (style === 'decimal') {
    // Number() drops the trailing zeros toFixed adds: 4.50 → "4.5h", 4.00 → "4h".
    return `${Number(decimalHours(s).toFixed(2))}h`
  }
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h === 0 && m === 0) return `${s % 60}s`
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

/** Seconds for a typed decimal-hours value ("4.5" → 16200). NaN-safe. */
export function secondsFromDecimalHours(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * 3600)
}

/** "0:03:47" — clock style for a live-running timer. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** Decimal hours, rounded to 2dp (for display, not money). */
export function decimalHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100
}

export function formatMoney(amount: number, currency = '$'): string {
  return `${currency}${amount.toFixed(2)}`
}

/** Pretty date "Jul 7, 2026" from a 'YYYY-MM-DD' string (parsed as local). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ---- Money helpers -------------------------------------------------------

/** Amount owed for a duration at a rate, rounded to cents. */
export function lineAmount(seconds: number, rate: number): number {
  return Math.round((seconds / 3600) * rate * 100) / 100
}

/**
 * What one entry is worth. A flat price wins over hours x rate outright —
 * that's the whole point of agreeing a number instead of a duration.
 */
export function entryAmount(
  e: Pick<TimeEntry, 'seconds' | 'rate' | 'flatAmount'>,
  seconds = e.seconds,
): number {
  if (e.flatAmount != null) return Math.round(e.flatAmount * 100) / 100
  return lineAmount(seconds, e.rate)
}

/** True when this entry is priced as a job, not as time. */
export function isFlat(e: Pick<TimeEntry, 'flatAmount'>): boolean {
  return e.flatAmount != null
}

/** What has been taken off this invoice: comps, discounts, trades. */
export function adjustmentsTotal(invoice: Pick<Invoice, 'adjustments'>): number {
  return Math.round((invoice.adjustments ?? []).reduce((s, a) => s + (a.amount || 0), 0) * 100) / 100
}

export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  comp: 'Comp / discount',
  trade: 'Trade',
}

/** Commonest first; a goodwill knock-off happens more often than a swap. */
export const ADJUSTMENT_OPTIONS: AdjustmentKind[] = ['comp', 'trade']

/** Sum of an invoice's frozen expense lines. */
export function expensesTotal(invoice: Pick<Invoice, 'expensesSnapshot'>): number {
  return Math.round((invoice.expensesSnapshot ?? []).reduce((s, x) => s + (x.amount || 0), 0) * 100) / 100
}

/**
 * An invoice's grand total = frozen labor + expenses. Uses the snapshot when
 * present (immutable record); falls back to live entries for legacy invoices.
 */
export function invoiceTotal(
  invoice: Pick<Invoice, 'snapshot' | 'expensesSnapshot' | 'entryIds' | 'adjustments'>,
  entries: TimeEntry[],
): number {
  const labor = invoice.snapshot
    ? invoice.snapshot.total
    : entries.filter(e => invoice.entryIds.includes(e.id))
        .reduce((s, e) => s + entryAmount(e), 0)
  // Comps come off last, and the total is floored at zero: an invoice asking a
  // client for minus forty dollars is not a bill, it is a question. Over-comping
  // is a credit to carry to the next one.
  const gross = labor + expensesTotal(invoice)
  return Math.max(0, Math.round((gross - adjustmentsTotal(invoice)) * 100) / 100)
}

// ---- Invoice breakdown ---------------------------------------------------

/**
 * Group a set of entries into the day → service breakdown the invoice renders.
 * Within a day, entries are grouped by (serviceId + rate) so a service billed at
 * two different rates stays on separate lines. Notes are de-duped per line.
 */
export function buildBreakdown(entries: TimeEntry[], services: Service[]): Breakdown {
  const serviceName = (id: string) => services.find(s => s.id === id)?.name ?? 'Unknown service'

  const byDate = new Map<string, TimeEntry[]>()
  for (const e of entries) {
    const arr = byDate.get(e.date) ?? []
    arr.push(e)
    byDate.set(e.date, arr)
  }

  const days: BreakdownDay[] = []
  let total = 0
  let totalSeconds = 0

  for (const date of [...byDate.keys()].sort()) {
    const dayEntries = byDate.get(date)!
    const byLine = new Map<string, BreakdownLine>()

    for (const e of dayEntries) {
      const secs = liveSeconds(e)
      const flat = isFlat(e)
      // Flat work never merges with hourly work, and two flat jobs never merge
      // with each other: their prices were agreed separately and summing them
      // into one "rate" line would invent an hourly rate nobody agreed to.
      const key = flat ? `flat::${e.id}` : `${e.serviceId}::${e.rate}`
      const existing = byLine.get(key)
      if (existing) {
        existing.seconds += secs
        existing.amount += flat ? entryAmount(e) : 0
        if (e.note.trim() && !existing.notes.includes(e.note.trim())) {
          existing.notes.push(e.note.trim())
        }
      } else {
        byLine.set(key, {
          serviceId: e.serviceId,
          serviceName: serviceName(e.serviceId),
          notes: e.note.trim() ? [e.note.trim()] : [],
          seconds: secs,
          rate: flat ? 0 : e.rate,
          amount: flat ? entryAmount(e) : 0,
          ...(flat ? { flat: true } : {}),
        })
      }
    }

    const lines = [...byLine.values()].sort((a, b) => a.serviceName.localeCompare(b.serviceName))
    let daySeconds = 0
    let dayTotal = 0
    for (const line of lines) {
      // A flat line already carries its agreed price; only hourly lines are
      // computed from seconds.
      if (!line.flat) line.amount = lineAmount(line.seconds, line.rate)
      daySeconds += line.seconds
      dayTotal += line.amount
    }
    dayTotal = Math.round(dayTotal * 100) / 100

    days.push({ date, lines, daySeconds, dayTotal })
    total += dayTotal
    totalSeconds += daySeconds
  }

  return { days, totalSeconds, total: Math.round(total * 100) / 100 }
}

// ---- Expense state -------------------------------------------------------

/**
 * Where an expense sits.
 *
 *  overhead  — your own cost, never a client's
 *  shelf     — billable, bought, not yet attributed to anyone. Material you own.
 *  billable  — billable to a named client and still owed
 *  invoiced  — frozen onto an invoice
 *  settled   — closed out without an invoice (cash, trade, personal, write-off)
 *
 * `shelf` needs no stored flag: a billable expense with no client CANNOT be put
 * on anyone's invoice, so that combination already means "material on hand".
 * Giving it a client is what turns it into money to recover.
 */
export type ExpenseState = 'overhead' | 'shelf' | 'billable' | 'invoiced' | 'settled'

export function expenseState(x: Expense): ExpenseState {
  if (!x.billable) return 'overhead'
  if (x.invoiceId) return 'invoiced'
  if (x.settled) return 'settled'
  return x.clientId ? 'billable' : 'shelf'
}

/**
 * True once this piece has been merged back into a sibling.
 *
 * An absorbed row is history, not an expense: its money now lives on the
 * survivor. Every list, total and picker filters these out — go through
 * `liveExpenses` rather than reading `state.expenses` directly.
 */
export function isAbsorbed(x: Expense): boolean {
  return !!x.absorbedInto
}

/** Every expense that still represents real money. The default list to read. */
export function liveExpenses(expenses: Expense[]): Expense[] {
  return expenses.filter(x => !isAbsorbed(x))
}

/** True when an expense is still waiting on a decision from you. */
export function isOpenExpense(x: Expense): boolean {
  if (isAbsorbed(x)) return false
  const state = expenseState(x)
  return state === 'billable' || state === 'shelf'
}

export const SETTLED_LABELS: Record<SettledHow, string> = {
  cash: 'Paid cash',
  trade: 'Traded',
  gift: 'Gifted',
  personal: 'Used it myself',
  writeoff: 'Written off',
}

/** The order they're offered in — commonest first. */
export const SETTLED_OPTIONS: SettledHow[] = ['cash', 'trade', 'gift', 'personal', 'writeoff']

/** Hours are given away, not "used yourself" — same list, honest wording. */
export const SETTLED_TIME_LABELS: Record<SettledHow, string> = {
  ...SETTLED_LABELS,
  personal: 'Own place',
}
export const SETTLED_TIME_OPTIONS: SettledHow[] = ['gift', 'trade', 'cash', 'writeoff', 'personal']

/**
 * Split an expense in two: the part you're charging for, and the remainder.
 *
 * The billed part keeps the id, the client and any receipt, so an invoice built
 * from it is unsurprising. The remainder goes to the SHELF — billable, but with
 * no client — because half a bundle of lumber you didn't use is material you
 * still own, not money the last client owes you. Attach it to whoever ends up
 * using it.
 */
export function splitExpense(
  x: Expense, billedAmount: number, currency = '$',
): [Expense, Expense] {
  const billed = Math.max(0, Math.min(billedAmount, x.amount))
  const left = Math.round((x.amount - billed) * 100) / 100
  // The note is printed on a client's invoice, so it carries the symbol.
  const money = (n: number) => formatMoney(n, currency)
  // Inherited, never regenerated: a piece cut off a piece is still part of the
  // original roll, so re-splitting must not strand it in a lineage of its own.
  const lineageId = x.lineageId ?? genId()
  return [
    {
      ...x,
      lineageId,
      amount: Math.round(billed * 100) / 100,
      // Written onto the expense so it survives onto the invoice snapshot and
      // answers "why was I only charged half?" without anyone having to
      // remember the conversation.
      note: [stripSplitNote(x.note), `${money(billed)} of ${money(x.amount)} total — remainder unused`]
        .filter(Boolean).join(' · '),
    },
    {
      ...x,
      id: genId(),
      lineageId,
      amount: left,
      clientId: null,
      invoiceId: null,
      settled: null,
      absorbedInto: null,
      // Both halves point at the SAME stored photo. One purchase produced one
      // receipt, and the offcut needs it just as much as the billed piece —
      // the photo is only deleted once the last piece referencing it is gone.
      receiptPath: x.receiptPath,
      note: [stripSplitNote(x.note), `Unused remainder of ${money(x.amount)} ${x.label || 'expense'}`]
        .filter(Boolean).join(' · '),
      createdAt: Date.now(),
    },
  ]
}

/**
 * Cut an expense into `n` equal pieces.
 *
 * Material is bought in units you think about as fractions — a bucket of zinc
 * that treats five roofs, 300yd of fabric across three jobs — and getting
 * there by halving twice both misstates the pieces and is a chore. The first
 * piece keeps the id, client and receipt; the rest go to the shelf, so
 * splitting something already on the shelf leaves every piece on the shelf.
 *
 * Rounding is dealt to the FIRST piece rather than spread, so the pieces
 * always sum to exactly the original and none of them is a fraction of a cent.
 */
export function splitExpenseEqually(x: Expense, n: number, currency = '$'): Expense[] {
  const parts = Math.max(2, Math.min(Math.floor(n), 24))
  const cents = Math.round(x.amount * 100)
  const base = Math.floor(cents / parts)
  const remainder = cents - base * parts
  const lineageId = x.lineageId ?? genId()
  const money = (n2: number) => formatMoney(n2, currency)
  const baseNote = stripSplitNote(x.note)
  const now = Date.now()

  return Array.from({ length: parts }, (_, i) => {
    const amount = (base + (i === 0 ? remainder : 0)) / 100
    const note = [baseNote, `1/${parts} of ${money(x.amount)} ${x.label || 'expense'}`]
      .filter(Boolean).join(' · ')
    if (i === 0) return { ...x, lineageId, amount, note }
    return {
      ...x,
      id: genId(),
      lineageId,
      amount,
      clientId: null,
      invoiceId: null,
      settled: null,
      absorbedInto: null,
      receiptPath: x.receiptPath,
      note,
      createdAt: now + i,
    }
  })
}

/**
 * Put sibling pieces back together.
 *
 * `survivor` keeps the id, the client and the receipt and takes on the whole
 * amount. The others are ABSORBED rather than deleted — see `Expense.absorbedInto`
 * for why a delete here would be unsafe under the merge — with their amount
 * zeroed so no total can count the same money twice.
 *
 * Callers must have established that every piece shares a lineage; this
 * refuses the merge outright rather than trusting them, because two different
 * brands of the same material becoming one row is a mistake you only discover
 * standing in somebody's yard.
 */
export function recombineExpenses(
  survivor: Expense, absorbed: Expense[], currency = '$',
): Expense[] | null {
  if (absorbed.length === 0) return null
  if (!survivor.lineageId) return null
  if (absorbed.some(x => x.lineageId !== survivor.lineageId)) return null
  if (absorbed.some(x => x.id === survivor.id)) return null
  // Anything frozen onto an invoice has to be detached first — that is a
  // decision about a document a client has seen, never a side effect of a drag.
  if (survivor.invoiceId || absorbed.some(x => x.invoiceId)) return null
  if (isAbsorbed(survivor) || absorbed.some(isAbsorbed)) return null

  const total = [survivor, ...absorbed].reduce((s, x) => s + Math.round(x.amount * 100), 0) / 100
  const money = (n: number) => formatMoney(n, currency)
  const pieces = absorbed.length + 1

  // Measured material pours back in by the unit. Units only add up when they
  // are the same unit, which a shared lineage already implies — checked anyway,
  // because a quart counted in fl oz and one counted in "treatments" summed
  // would be a number that means nothing.
  if (survivor.measure || absorbed.some(x => x.measure)) {
    const m = survivor.measure
    if (!m || absorbed.some(x => !x.measure || x.measure.unit !== m.unit)) return null
    const qty = m.qty + absorbed.reduce((s, x) => s + (x.measure?.qty ?? 0), 0)
    return [
      { ...survivor, amount: total, measure: { ...m, qty } },
      ...absorbed.map(x => ({
        ...x,
        absorbedInto: survivor.id,
        absorbedAmount: x.amount,
        amount: 0,
        measure: x.measure ? { ...x.measure, qty: 0 } : x.measure,
      })),
    ]
  }

  return [
    {
      ...survivor,
      amount: total,
      // The old note said "remainder unused", which stops being true the moment
      // the remainder is back. Leaving it would print a lie on an invoice.
      note: [stripSplitNote(survivor.note), `Recombined ${money(total)} from ${pieces} pieces`]
        .filter(Boolean).join(' · '),
    },
    ...absorbed.map(x => ({
      ...x,
      absorbedInto: survivor.id,
      absorbedAmount: x.amount,
      amount: 0,
      note: [stripSplitNote(x.note), `Merged back into ${survivor.label || 'its sibling'}`]
        .filter(Boolean).join(' · '),
    })),
  ]
}

// ---- Measured material ---------------------------------------------------

/** What a new measured container's markup box starts at. Always editable. */
export const DEFAULT_MARKUP_PCT = 20

/**
 * What a client is charged for `cost` worth of material.
 *
 * Markup is a percentage of what you paid; the fee is flat and lands once per
 * job. Both are suggestions the moment they reach a screen — see `Measure`.
 */
export function priceUnits(cost: number, markupPct: number, serviceFee: number): number {
  const marked = cost * (1 + (markupPct || 0) / 100)
  return Math.round((marked + (serviceFee || 0)) * 100) / 100
}

/**
 * What `qty` units drawn from this container would cost YOU.
 *
 * Matches `drawMeasured`'s split exactly, so the figure quoted in the assign
 * drawer is the figure the piece is created with.
 */
export function drawCost(x: Pick<Expense, 'amount' | 'measure'>, qty: number): number {
  const have = x.measure?.qty ?? 0
  if (have <= 0) return 0
  return Math.round(toCents(x.amount) * Math.min(qty, have) / have) / 100
}

const toCents = (n: number) => Math.round(n * 100)

/** What one unit in this row cost you. */
export function costPerUnit(x: Pick<Expense, 'amount' | 'measure'>): number {
  const qty = x.measure?.qty ?? 0
  return qty > 0 ? x.amount / qty : 0
}

/**
 * What a client is charged for this row.
 *
 * For ordinary material that is the amount — billed at cost, as it always has
 * been. For measured material it is units x the frozen per-unit price, which
 * is NOT the amount: the amount is what you paid, and Reports needs that
 * number to stay true.
 */
export function billedAmount(x: Pick<Expense, 'amount' | 'markupPct' | 'serviceFee'>): number {
  return priceUnits(x.amount, x.markupPct ?? 0, x.serviceFee ?? 0)
}

/** True when this is billed at more than it cost — marked up, fee'd, or both. */
export function isPriced(x: Pick<Expense, 'markupPct' | 'serviceFee'>): boolean {
  return !!x.markupPct || !!x.serviceFee
}

/**
 * The frozen invoice line for an expense.
 *
 * Measured material prints under its client-facing name with units and
 * per-unit price, and deliberately WITHOUT the note: the note is where your
 * own shorthand lives ("Crossbow from HD"), and a client has no business
 * reading what you paid for the jug.
 */
export function expenseLine(x: Expense): ExpenseLine {
  const amount = billedAmount(x)
  const line: ExpenseLine = {
    id: x.id,
    label: (x.clientLabel ?? '').trim() || x.label || 'Charge',
    amount,
  }
  if (x.measure) {
    line.measured = true
    // A fee is bundled into the total, so there is no honest per-unit price to
    // print — dividing it back out would quote a rate you never set. Straight
    // pass-through material (two sawzall blades) still shows its count and
    // price, which is the whole point of billing it that way.
    if (!x.serviceFee && x.measure.qty > 0) {
      line.qty = x.measure.qty
      line.unitPrice = Math.round((amount / x.measure.qty) * 100) / 100
    }
    return line
  }
  // Split notes quote what you PAID ("$38.52 of $77.04 total"). Printing one
  // beside a marked-up figure both contradicts it and hands over your cost, so
  // a priced line travels under its name alone.
  if (!isPriced(x) && x.note) line.note = x.note
  return line
}

/** What a client is charged for one assignment, chosen as it is made. */
export interface MeasurePricing {
  clientLabel: string
  markupPct: number
  serviceFee: number
}

/** Tidy a typed-in set of terms into what gets stored. */
export function cleanPricing(p: MeasurePricing): MeasurePricing {
  return {
    clientLabel: p.clientLabel.trim(),
    markupPct: Math.max(0, Math.round((p.markupPct || 0) * 10) / 10),
    serviceFee: Math.max(0, Math.round((p.serviceFee || 0) * 100) / 100),
  }
}

/**
 * True for an invoice line that came off a measured container.
 *
 * A fee-bundled line carries no `qty`, so the presence of one cannot be the
 * test — this asks the invoice's own record instead of guessing from shape.
 */
export function isMeasuredLine(line: ExpenseLine): boolean {
  return line.qty != null || line.measured === true
}

/**
 * Draw `qty` units off a measured container for a client.
 *
 * Asking for all of what's left simply hands the whole row over — nothing is
 * left to stay on the shelf, so the container leaves it too. Otherwise the
 * drawn piece is a NEW row carrying its share of the cost, and the container
 * keeps the rest; the cents always sum to exactly what was paid.
 *
 * Both rows share a lineage, so a piece taken back off a client can be dropped
 * onto the container to pour the unused units back in.
 */
export function drawMeasured(
  x: Expense, qty: number, clientId: string, pricing: MeasurePricing,
): Expense[] | null {
  if (!x.measure || x.invoiceId || x.settled || isAbsorbed(x)) return null
  const have = x.measure.qty
  const take = Math.floor(qty)
  if (!(take >= 1) || take > have) return null

  // What this client is charged, frozen now. The container keeps its own values
  // as the defaults for next time.
  const priced = cleanPricing(pricing)

  // The whole container went out: there is no remainder to leave behind, so the
  // row itself becomes the piece rather than leaving an empty jug on the shelf.
  if (take === have) return [{ ...x, ...priced, clientId }]

  const pieceCents = Math.round(toCents(x.amount) * take / have)
  const lineageId = x.lineageId ?? genId()
  return [
    {
      ...x,
      lineageId,
      amount: (toCents(x.amount) - pieceCents) / 100,
      measure: { ...x.measure, qty: have - take },
    },
    {
      ...x,
      ...priced,
      id: genId(),
      lineageId,
      clientId,
      amount: pieceCents / 100,
      measure: { ...x.measure, qty: take },
      invoiceId: null,
      settled: null,
      absorbedInto: null,
      // Same stored photo as the container: one purchase, one receipt.
      receiptPath: x.receiptPath,
      createdAt: Date.now(),
    },
  ]
}

/**
 * Drop the fragments this module writes onto notes when it cuts something up.
 *
 * Split notes describe a relationship ("remainder unused") that a later split
 * or a recombine makes false. Anything the user typed is left alone.
 */
export function stripSplitNote(note: string): string {
  return (note ?? '')
    .split(' · ')
    .filter(part => !/^(\S.*? of \S+ total — remainder unused|Unused remainder of |1\/\d+ of |Recombined \S+ from \d+ pieces|Merged back into )/.test(part.trim()))
    .filter(part => !/ of \S+ total — remainder unused$/.test(part.trim()))
    .join(' · ')
}

/**
 * The visible mark two siblings share.
 *
 * The question actually asked of the shelf is "can these two snap together?",
 * which is a matching question — so colour carries it at a glance and the code
 * settles it when two lineages land on similar hues. Deliberately a different
 * SHAPE from a client pill so it can never be misread as a client.
 */
export function lineageMark(lineageId: string): { code: string; hue: number } {
  let h = 0
  for (let i = 0; i < lineageId.length; i++) h = (h * 31 + lineageId.charCodeAt(i)) >>> 0
  return { code: lineageId.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase(), hue: h % 360 }
}

/** The other live pieces cut from the same original purchase. */
export function siblingsOf(x: Expense, all: Expense[]): Expense[] {
  if (!x.lineageId) return []
  return all.filter(o => o.id !== x.id && o.lineageId === x.lineageId && !isAbsorbed(o))
}

/**
 * How many live expenses still point at a stored photo.
 *
 * Splitting shares one receipt across every piece, so deleting a piece must not
 * delete the image out from under its siblings — only the last one out turns
 * off the light.
 */
export function receiptRefCount(path: string, all: Expense[]): number {
  return all.filter(x => x.receiptPath === path && !isAbsorbed(x)).length
}

// ---- Client names --------------------------------------------------------

/** The fields every name-rendering helper needs. */
export type NamedClient = Pick<Client, 'name' | 'people' | 'business'>

/** Trim, and drop the people who are entirely blank. */
function realPeople(client: Pick<Client, 'people'> | null | undefined): Person[] {
  return (client?.people ?? [])
    .map(p => ({ first: (p.first ?? '').trim(), last: (p.last ?? '').trim() }))
    .filter(p => p.first || p.last)
}

function businessOf(client: Pick<Client, 'business'> | null | undefined): string {
  return (client?.business ?? '').trim()
}

/**
 * Render a list of people as one name.
 *
 * A shared surname collapses ("Sylvia & Craig Gardner") because that is how the
 * household is actually addressed; differing surnames stay spelled out in full
 * ("Dana Vasquez & Kim Oyelaran") because collapsing those would invent a name
 * nobody has.
 */
export function formatPeople(people: Person[]): string {
  if (people.length === 0) return ''
  if (people.length === 1) return [people[0].first, people[0].last].filter(Boolean).join(' ')

  const lasts = people.map(p => p.last).filter(Boolean)
  const sharesOneSurname = lasts.length === people.length && new Set(lasts).size === 1
  if (sharesOneSurname) {
    const firsts = people.map(p => p.first).filter(Boolean).join(' & ')
    return `${firsts} ${lasts[0]}`.trim()
  }
  return people.map(p => [p.first, p.last].filter(Boolean).join(' ')).join(' & ')
}

/**
 * The client's name in full — what belongs on an invoice, a CSV or a card.
 * When a client is a business WITH a named contact, the business is the billed
 * party; the person belongs on the attention line (see `clientAttn`).
 */
export function clientFullName(client: NamedClient | null | undefined): string {
  const business = businessOf(client)
  if (business) return business
  const people = formatPeople(realPeople(client))
  if (people) return people
  return (client?.name ?? '').trim() || 'Unknown client'
}

/** The person to address a business's invoice to, or '' when there isn't one. */
export function clientAttn(
  client: Pick<Client, 'people' | 'business'> | null | undefined,
): string {
  if (!businessOf(client)) return ''
  return formatPeople(realPeople(client))
}

/**
 * The short label a pill, chip or chart legend can hold.
 *
 * Surname-first for people, because that is the household: "the Gardners" is
 * one word where "Sylvia & Craig Gardner" would blow out a pill in the time
 * log. Falls back to first names when there is no surname to use.
 */
export function clientShortName(client: NamedClient | null | undefined): string {
  const business = businessOf(client)
  if (business) return business

  const people = realPeople(client)
  if (people.length === 0) return (client?.name ?? '').trim() || 'Unknown client'

  const lasts = people.map(p => p.last).filter(Boolean)
  if (lasts.length > 0 && new Set(lasts).size === 1) return lasts[0]
  if (people.length === 1) return people[0].last || people[0].first
  // Two households under one client: first names carry it more clearly than a
  // pair of surnames would.
  return people.map(p => p.first || p.last).join(' & ')
}

/** What the Clients list alphabetises on: business, else surname, else first. */
export function clientSortKey(client: NamedClient): string {
  const business = businessOf(client)
  if (business) return business.toLocaleLowerCase()
  const people = realPeople(client)
  if (people.length === 0) return (client.name ?? '').trim().toLocaleLowerCase()
  return (people[0].last || people[0].first).toLocaleLowerCase()
}

/** True once a client has been given structured names, i.e. left the legacy field. */
export function hasStructuredName(
  client: Pick<Client, 'people' | 'business'> | null | undefined,
): boolean {
  return !!businessOf(client) || realPeople(client).length > 0
}

/**
 * Best-effort split of a legacy one-line name, to seed the editor's fields.
 *
 * Only ever a starting point shown in a form the user can correct before
 * saving — deliberately not run over saved data, because a wrong guess applied
 * silently is how "Larry & Linda O'Neil" quietly becomes someone's first name.
 * Splits on "&"/"and" first so couples land as two people, then treats the last
 * token of each chunk as a surname.
 */
export function splitLegacyName(name: string): Person[] {
  const chunks = name.trim().split(/\s+(?:&|\+|and)\s+/i).map(c => c.trim()).filter(Boolean)
  if (chunks.length === 0) return [{ first: '', last: '' }]
  return chunks.map(chunk => {
    const tokens = chunk.split(/\s+/)
    if (tokens.length === 1) return { first: tokens[0], last: '' }
    return { first: tokens.slice(0, -1).join(' '), last: tokens[tokens.length - 1] }
  })
}

// ---- Client colours ------------------------------------------------------

/** One client pill's look: a tinted fill and the text colour that sits on it. */
export interface ClientColor {
  id: string
  /** Spoken name, not decoration — the picker is unusable by hue alone. */
  label: string
  bg: string
  fg: string
}

/**
 * Twenty distinct client pills: ten hues, each in a light and a deep fill.
 *
 * Built as hue x weight rather than twenty separate hues on purpose. Twenty
 * hues are indistinguishable to a lot of eyes (and to anyone glancing at a
 * phone in daylight), whereas fill weight reads even when the hue doesn't —
 * so a same-hue pair still tells itself apart. Every swatch is also named, so
 * the picker never asks you to identify a colour by looking at it.
 */
export const CLIENT_COLORS: ClientColor[] = [
  { id: 'green', label: 'Green', bg: 'rgba(34, 197, 94, 0.18)', fg: '#86efac' },
  { id: 'teal', label: 'Teal', bg: 'rgba(20, 184, 166, 0.18)', fg: '#5eead4' },
  { id: 'cyan', label: 'Cyan', bg: 'rgba(6, 182, 212, 0.18)', fg: '#67e8f9' },
  { id: 'sky', label: 'Sky', bg: 'rgba(14, 165, 233, 0.18)', fg: '#7dd3fc' },
  { id: 'indigo', label: 'Indigo', bg: 'rgba(99, 102, 241, 0.18)', fg: '#a5b4fc' },
  { id: 'violet', label: 'Violet', bg: 'rgba(139, 92, 246, 0.18)', fg: '#c4b5fd' },
  { id: 'pink', label: 'Pink', bg: 'rgba(236, 72, 153, 0.18)', fg: '#f9a8d4' },
  { id: 'rose', label: 'Rose', bg: 'rgba(244, 63, 94, 0.18)', fg: '#fda4af' },
  { id: 'orange', label: 'Orange', bg: 'rgba(249, 115, 22, 0.18)', fg: '#fdba74' },
  { id: 'amber', label: 'Amber', bg: 'rgba(234, 179, 8, 0.18)', fg: '#fcd34d' },
  { id: 'green-deep', label: 'Green deep', bg: 'rgba(34, 197, 94, 0.42)', fg: '#dcfce7' },
  { id: 'teal-deep', label: 'Teal deep', bg: 'rgba(20, 184, 166, 0.42)', fg: '#ccfbf1' },
  { id: 'cyan-deep', label: 'Cyan deep', bg: 'rgba(6, 182, 212, 0.42)', fg: '#cffafe' },
  { id: 'sky-deep', label: 'Sky deep', bg: 'rgba(14, 165, 233, 0.42)', fg: '#e0f2fe' },
  { id: 'indigo-deep', label: 'Indigo deep', bg: 'rgba(99, 102, 241, 0.42)', fg: '#e0e7ff' },
  { id: 'violet-deep', label: 'Violet deep', bg: 'rgba(139, 92, 246, 0.42)', fg: '#ede9fe' },
  { id: 'pink-deep', label: 'Pink deep', bg: 'rgba(236, 72, 153, 0.42)', fg: '#fce7f3' },
  { id: 'rose-deep', label: 'Rose deep', bg: 'rgba(244, 63, 94, 0.42)', fg: '#ffe4e6' },
  { id: 'orange-deep', label: 'Orange deep', bg: 'rgba(249, 115, 22, 0.42)', fg: '#ffedd5' },
  { id: 'amber-deep', label: 'Amber deep', bg: 'rgba(234, 179, 8, 0.42)', fg: '#fef3c7' },
]

/** The palette entry a client is set to, or null for the default pill. */
export function clientColor(
  client: Pick<Client, 'colorId'> | null | undefined,
): ClientColor | null {
  if (!client?.colorId) return null
  return CLIENT_COLORS.find(c => c.id === client.colorId) ?? null
}

// ---- Invoice numbering ---------------------------------------------------

/** Digits the per-day sequence is padded to: 01, 02, … 10. */
export const INVOICE_SEQ_PAD = 2

const SEQ_ONLY = /^[0-9]+$/

/** Strip a label down to the A–Z0–9 an invoice number can safely carry. */
export function normalizeInvoiceCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * The invoice-number prefix for a client: their custom code if they have one,
 * otherwise their name with spaces and punctuation stripped.
 *
 * Deliberately NOT a truncation rule ("first five letters"): Stein, Steinson
 * and Steinmore would all collapse to STEIN and start colliding. Full name by
 * default, and anyone with an unwieldy one gets a hand-picked code instead.
 */
/**
 * The invoice-number prefix for a client.
 *
 * A code you typed yourself is never touched. Everyone else gets one built from
 * their name: every person's first initial, then the surname in full — Larry
 * and Linda Gies are LLGIES, Diana Baskins is DBASKINS, Grayson and Catherine
 * MacArthur are GCMACARTHUR. Initials rather than full first names because the
 * prefix is read next to a date and a sequence, where SYLVIACRAIGGARDNER stops
 * being scannable.
 *
 * Nothing is ever written back to the client: the derived code follows a
 * rename, and the stored field means "Nic chose this" and nothing else.
 */
export function clientInvoiceCode(
  client: (NamedClient & Pick<Client, 'invoiceCode'>) | null | undefined,
): string {
  const raw = typeof client?.invoiceCode === 'string' ? client.invoiceCode : ''
  const custom = normalizeInvoiceCode(raw)
  if (custom) return custom

  // A business is billed under its own name, not somebody's initials.
  const business = businessOf(client)
  if (business) return normalizeInvoiceCode(business) || 'CLIENT'

  // Legacy clients get the same treatment via a best-effort split, so the rule
  // doesn't wait on someone opening every client to restructure them.
  const people = realPeople(client).length
    ? realPeople(client)
    : splitLegacyName(client?.name ?? '')

  const initials = people.map(p => p.first.trim().charAt(0)).filter(Boolean).join('')
  const lasts = people.map(p => p.last.trim()).filter(Boolean)
  // A couple sharing a surname is the common case; when they don't share one
  // the first person's carries the code rather than gluing both on.
  const surname = lasts.length > 0 ? lasts[0] : ''

  const code = surname
    ? `${initials}${surname}`
    // Nobody has a surname ("Cathy") — initials alone would be one letter.
    : people.map(p => p.first.trim()).filter(Boolean).join('')
  return normalizeInvoiceCode(code) || 'CLIENT'
}

/** 'YYYY-MM-DD' → 'YYYYMMDD', the date form invoice numbers use. */
export function compactDate(iso: string): string {
  return iso.replace(/-/g, '')
}

/**
 * The next invoice number for a client on a given day: `CODE-YYYYMMDD-NN`.
 *
 * The sequence is derived by reading the numbers already issued under that
 * exact prefix rather than from a stored counter. That keeps it self-healing:
 * deleting today's only invoice frees 01 again, and renaming a client's code
 * starts a fresh sequence under the new prefix without ever colliding with the
 * old one. `issuedDate` is the invoice's own date, so a backfilled already-paid
 * invoice is numbered for the day the work ended, not the day you typed it in.
 */
export function nextInvoiceNumber(
  invoices: Pick<Invoice, 'number'>[],
  client: (NamedClient & Pick<Client, 'invoiceCode'>) | null | undefined,
  issuedDate: string,
): string {
  const prefix = `${clientInvoiceCode(client)}-${compactDate(issuedDate)}-`
  let highest = 0
  for (const inv of invoices) {
    const num = inv.number ?? ''
    if (!num.startsWith(prefix)) continue
    const seq = num.slice(prefix.length)
    // Ignore anything hand-edited into a non-numeric tail rather than letting
    // NaN swallow the real highest sequence.
    if (!SEQ_ONLY.test(seq)) continue
    highest = Math.max(highest, Number(seq))
  }
  return `${prefix}${String(highest + 1).padStart(INVOICE_SEQ_PAD, '0')}`
}

// ---- Payment state --------------------------------------------------------

/** Where an entry sits in the money pipeline: logged → invoiced → collected. */
export type PaymentState = 'unbilled' | 'settled' | 'invoiced' | 'paid'

export const PAYMENT_LABELS: Record<PaymentState, string> = {
  unbilled: 'unbilled', settled: 'settled', invoiced: 'invoiced', paid: 'paid',
}

/**
 * Whether an entry has been paid for — DERIVED from the invoice it sits on,
 * never stored on the entry itself.
 *
 * Deliberately not a `paid` flag on TimeEntry: that would be a second source of
 * truth able to disagree with the invoice ("entry says paid, invoice says
 * draft"), and money data that can contradict itself is worse than none. An
 * invoice's status is the single authority; this just reads it.
 */
export function paymentStateOf(
  entry: Pick<TimeEntry, 'invoiceId' | 'settled'>,
  invoices: Pick<Invoice, 'id' | 'status'>[],
): PaymentState {
  // Settled beats unbilled: a gifted hour is dealt with, not money to chase.
  // It loses to an invoice, since being ON one is the stronger fact.
  if (!entry.invoiceId && entry.settled) return 'settled'
  if (!entry.invoiceId) return 'unbilled'
  const invoice = invoices.find(i => i.id === entry.invoiceId)
  // A dangling invoiceId means the invoice went missing, not that the work is
  // free to bill again — stay conservative rather than inviting a double-bill.
  if (!invoice) return 'invoiced'
  return invoice.status === 'paid' ? 'paid' : 'invoiced'
}

/**
 * One payment state for a group of entries (a day's worth, a client's worth).
 *
 * Precedence is deliberately "least settled wins": a day holding both collected
 * and unbilled work reads as unbilled, because the useful question at a glance
 * is "is there money here I still have to chase?", not "have I been paid at
 * all?". Optimistic rounding on a money summary is how work quietly goes
 * unbilled.
 */
export function rollupPaymentState(
  entries: Pick<TimeEntry, 'invoiceId' | 'settled'>[],
  invoices: Pick<Invoice, 'id' | 'status'>[],
): PaymentState {
  const states = new Set(entries.map(e => paymentStateOf(e, invoices)))
  if (states.has('unbilled')) return 'unbilled'
  if (states.has('invoiced')) return 'invoiced'
  // Settled outranks paid here only so a day of pure freebies reads as settled
  // rather than as money collected.
  if (states.has('settled')) return 'settled'
  return 'paid'
}

/** True when a group spans more than one payment state — worth flagging in UI. */
export function isMixedPayment(
  entries: Pick<TimeEntry, 'invoiceId' | 'settled'>[],
  invoices: Pick<Invoice, 'id' | 'status'>[],
): boolean {
  return new Set(entries.map(e => paymentStateOf(e, invoices))).size > 1
}

// ---- Wall-clock start/end ------------------------------------------------

/** 'YYYY-MM-DD' for the LOCAL calendar day an epoch ms falls on. */
export function dateFromEpoch(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** epoch ms → the 'YYYY-MM-DDTHH:mm' string an <input type="datetime-local"> wants. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** "2:24 PM" — local clock time for an epoch ms. */
export function formatTimeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** epoch ms → the 'HH:mm' an <input type="time"> wants, in local time. */
export function toTimeInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * A 'YYYY-MM-DD' day plus an 'HH:mm' clock time → epoch ms, in local time.
 *
 * Manual entry deliberately keeps the day and the two clock times as separate
 * controls rather than two datetime-locals: re-dating an entry to last Tuesday
 * then has no way to drag the times with it, and picking a time is one wheel
 * instead of two on a phone.
 */
export function epochFromDateTime(date: string, time: string): number | null {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  if (!y || !mo || !d || !Number.isFinite(h) || !Number.isFinite(mi)) return null
  const ms = new Date(y, mo - 1, d, h, mi, 0, 0).getTime()
  return Number.isNaN(ms) ? null : ms
}

/** Inverse of toLocalInput. Returns null for an empty/unparseable value. */
export function fromLocalInput(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * The wall-clock span an entry represents. Derived from `startedAt` + `seconds`
 * (the billing truth), so it can never disagree with what gets invoiced.
 * Null for legacy entries that never recorded a start time.
 */
export function entrySpan(e: TimeEntry): { start: number; end: number } | null {
  if (e.startedAt == null) return null
  return { start: e.startedAt, end: e.startedAt + e.seconds * 1000 }
}

export interface RangeProblem { field: 'start' | 'end'; message: string }

/**
 * Common-sense guardrails for a hand-edited time range: nothing in the future,
 * and the end can't precede the start. Returns null when the range is fine.
 */
export function validateRange(start: number, end: number, now: number = Date.now()): RangeProblem | null {
  // A minute of slack absorbs clock skew and the seconds the user can't see.
  const future = now + 60_000
  if (start > future) return { field: 'start', message: "Start time can't be in the future." }
  if (end > future) return { field: 'end', message: "End time can't be in the future." }
  if (end < start) return { field: 'end', message: "End time can't be before the start time." }
  return null
}

// ---- Accounts receivable aging -------------------------------------------

/** issuedDate + netDays, as 'YYYY-MM-DD'. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return dateFromEpoch(dt.getTime())
}

/** Whole days between two 'YYYY-MM-DD' dates (b − a), calendar-day accurate. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)
  return Math.round(ms / 86_400_000)
}

export type AgingBucket = 'current' | '1-30' | '31-60' | '60+'

export const AGING_LABELS: Record<AgingBucket, string> = {
  current: 'Current', '1-30': '1–30 days', '31-60': '31–60 days', '60+': '60+ days',
}

/**
 * How overdue a sent invoice is. Legacy invoices with no dueDate are always
 * 'current' — we can't claim something is late without knowing when it was due.
 */
export function agingOf(invoice: Pick<Invoice, 'dueDate'>, today: string): {
  bucket: AgingBucket; daysOverdue: number
} {
  if (!invoice.dueDate) return { bucket: 'current', daysOverdue: 0 }
  const overdue = daysBetween(invoice.dueDate, today)
  if (overdue <= 0) return { bucket: 'current', daysOverdue: 0 }
  if (overdue <= 30) return { bucket: '1-30', daysOverdue: overdue }
  if (overdue <= 60) return { bucket: '31-60', daysOverdue: overdue }
  return { bucket: '60+', daysOverdue: overdue }
}

// ---- Persistence ---------------------------------------------------------

/**
 * A measure is only real when it can be counted: a hand-edited blob with a
 * string where a number belongs would otherwise put NaN on an invoice.
 */
const finite = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

function hydrateMeasure(m: unknown): Measure | null {
  if (!m || typeof m !== 'object') return null
  const r = m as Partial<Measure>
  const qty = Math.max(0, Math.floor(finite(r.qty, 0)))
  return {
    unit: typeof r.unit === 'string' ? r.unit : '',
    holds: Math.max(1, Math.floor(finite(r.holds, qty || 1))),
    qty,
    usual: Math.max(1, Math.floor(finite(r.usual, 1))),
  }
}

/**
 * Lift pricing onto the expense, wherever this blob happens to keep it.
 *
 * Three eras: a flat per-unit price on the container, then a markup and fee on
 * the container, now both on the expense itself so a one-off purchase can be
 * marked up too. A jug priced at $10/fl oz that cost $1.14/fl oz becomes a 777%
 * markup and keeps charging exactly what it always did.
 */
function hydratePricing(x: Partial<Expense>, measure: Measure | null): MeasurePricing {
  const legacy = (x.measure ?? {}) as Partial<Measure>
  const amount = finite(x.amount, 0)
  const qty = measure?.qty ?? 0
  const costPerUnit = qty > 0 ? amount / qty : 0
  const flatPrice = finite(legacy.unitPrice, 0)
  const converted = flatPrice > 0 && costPerUnit > 0
    ? Math.max(0, Math.round(((flatPrice / costPerUnit) - 1) * 1000) / 10)
    : 0
  const label = typeof x.clientLabel === 'string' ? x.clientLabel
    : typeof legacy.clientLabel === 'string' ? legacy.clientLabel
    : ''
  return {
    clientLabel: label,
    markupPct: Math.max(0, finite(x.markupPct, finite(legacy.markupPct, converted))),
    serviceFee: Math.max(0, finite(x.serviceFee, finite(legacy.serviceFee, 0))),
  }
}

/** Memoised per row so hydrate doesn't rebuild the same measure twice. */
function measureOf(x: Partial<Expense>): Measure | null {
  return hydrateMeasure(x.measure)
}

/** Fill any missing fields so older/partial saved blobs hydrate safely. */
export function hydrateState(raw: unknown): TractionState {
  const r = (raw ?? {}) as Partial<TractionState>
  const clients = (Array.isArray(r.clients) ? r.clients : []).map((c): Client => ({
    ...c,
    rates: c.rates && typeof c.rates === 'object' ? c.rates : {},
    // Structured names are opt-in; a non-array here would crash every render
    // that maps over them. Legacy clients simply have none and fall back.
    ...(Array.isArray(c.people)
      ? { people: c.people.filter(x => x && typeof x === 'object').map(x => ({
          first: typeof x.first === 'string' ? x.first : '',
          last: typeof x.last === 'string' ? x.last : '',
        })) }
      : {}),
  }))
  // Legacy entries/expenses predate wall-clock times and receipt attachments.
  // Default them to null rather than inventing a start time we don't know.
  const entries = (Array.isArray(r.entries) ? r.entries : []).map((e): TimeEntry => ({
    ...e,
    startedAt: typeof e.startedAt === 'number' ? e.startedAt : null,
    flatAmount: typeof e.flatAmount === 'number' ? e.flatAmount : null,
    settled: e.settled && typeof e.settled === 'object' ? e.settled : null,
    // Entries predating job photos have no array at all.
    photoPaths: Array.isArray(e.photoPaths) ? e.photoPaths : [],
  }))
  const expenses = (Array.isArray(r.expenses) ? r.expenses : []).map((x): Expense => ({
    ...x,
    receiptPath: typeof x.receiptPath === 'string' ? x.receiptPath : null,
    // Absent on everything logged before settling existed.
    settled: x.settled && typeof x.settled === 'object' ? x.settled : null,
    // Absent on everything logged before the shelf could cut things up. Only a
    // real string counts as a lineage: a stray `true` or `0` from a hand-edited
    // blob would otherwise let unrelated material recombine.
    ...(typeof x.lineageId === 'string' && x.lineageId ? { lineageId: x.lineageId } : {}),
    absorbedInto: typeof x.absorbedInto === 'string' ? x.absorbedInto : null,
    ...(typeof x.absorbedAmount === 'number' ? { absorbedAmount: x.absorbedAmount } : {}),
    // Absent on everything logged before measured material existed.
    measure: measureOf(x),
    ...hydratePricing(x, measureOf(x)),
  }))
  const invoices = (Array.isArray(r.invoices) ? r.invoices : []).map((i): Invoice => {
    // Migrate legacy inline `expenses: {id,label,amount}[]` → frozen snapshot.
    const legacy = (i as unknown as { expenses?: { id: string; label: string; amount: number }[] }).expenses
    return {
      ...i,
      // Older invoices predate frozen snapshots — leave null so they re-derive live.
      snapshot: i.snapshot ?? null,
      expenseIds: Array.isArray(i.expenseIds) ? i.expenseIds : [],
      expensesSnapshot: Array.isArray(i.expensesSnapshot) ? i.expensesSnapshot
        : Array.isArray(legacy) ? legacy.map(x => ({ id: x.id, label: x.label, amount: x.amount }))
        : [],
      adjustments: Array.isArray(i.adjustments) ? i.adjustments : [],
      paidDate: i.paidDate ?? null,
      // Legacy invoices have no due date — never retroactively mark them late.
      dueDate: i.dueDate ?? null,
    }
  })
  const settings = { ...defaultSettings(), ...(r.settings ?? {}) }
  // A hand-edited or pre-favourites blob can carry anything here; a non-array
  // would crash the timer screen on its first render.
  if (!Array.isArray(settings.favorites)) settings.favorites = []
  return {
    clients,
    services: Array.isArray(r.services) ? r.services : [],
    entries,
    expenses,
    invoices,
    settings,
  }
}

/**
 * Mirror state into localStorage. Deliberately does NOT touch the updated-at
 * stamp — mirroring runs on every state change including the first render, and
 * treating "the app was opened here" as "the data changed here" makes a blank
 * device look newer than the cloud and refuse to pull.
 */
export function saveLocal(state: TractionState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

/** Record when this device last *changed* the data — the freshness signal sync compares. */
export function touchLocal(at: string = new Date().toISOString()) {
  localStorage.setItem(UPDATED_AT_KEY, at)
}

export function loadLocal(): TractionState {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return emptyState()
  try {
    return hydrateState(JSON.parse(raw))
  } catch { /* ignore corrupt data */ }
  return emptyState()
}

export function getLocalUpdatedAt(): string | null {
  return localStorage.getItem(UPDATED_AT_KEY)
}

/**
 * Is `a` strictly newer than `b`? Parsed, never string-compared: local stamps
 * are `…123Z` while Postgres hands back `…123+00:00`, and those two sort in the
 * wrong order lexically. A missing `b` counts as older than any real `a`.
 */
export function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false
  const ta = Date.parse(a)
  if (Number.isNaN(ta)) return false
  if (!b) return true
  const tb = Date.parse(b)
  return Number.isNaN(tb) ? true : ta > tb
}

/**
 * `updated_at` of the cloud row this device last read or wrote — the base
 * version for saveRemote's compare-and-swap.
 */
export function getRemoteSeen(): string | null {
  return localStorage.getItem(REMOTE_SEEN_KEY)
}

function setRemoteSeen(updatedAt: string) {
  localStorage.setItem(REMOTE_SEEN_KEY, updatedAt)
}

/**
 * Does this device hold edits the cloud hasn't accepted yet?
 *
 * Kept in localStorage rather than a ref because the case that matters is
 * surviving a reload: log an hour in a backyard with no signal, the save fails,
 * you close the tab. Without a persisted flag nothing would retry until you
 * happened to make another edit, and the cloud would sit stale for days.
 */
export function isDirty(): boolean {
  return localStorage.getItem(DIRTY_KEY) === '1'
}

export function setDirty(dirty: boolean) {
  if (dirty) localStorage.setItem(DIRTY_KEY, '1')
  else localStorage.removeItem(DIRTY_KEY)
}

export type SaveResult = 'saved' | 'stale' | 'error'

// ---- Merge ---------------------------------------------------------------

/** Union two lists of id-bearing records, letting `winner` decide any overlap. */
function unionById<T extends { id: string }>(mine: T[], theirs: T[], winner: 'mine' | 'theirs'): T[] {
  const out = new Map<string, T>()
  const [first, second] = winner === 'theirs' ? [mine, theirs] : [theirs, mine]
  for (const item of first) out.set(item.id, item)
  for (const item of second) out.set(item.id, item)
  return [...out.values()]
}

/**
 * Reconcile this device's state with a cloud copy that moved ahead of it.
 *
 * This runs in exactly one situation: we tried to save, the compare-and-swap
 * said the cloud holds a version we never read, and both copies contain real
 * work. The old behaviour was to take the cloud copy wholesale, which silently
 * destroyed anything logged here since the last sync — the phone tracks three
 * hours in a yard, the laptop edits one invoice, and the phone's afternoon is
 * gone with no error shown.
 *
 * So: union every collection by id. Records only one side knows about are new
 * work and are always kept; where both sides know an id, the cloud wins, since
 * it is by definition the newer document.
 *
 * The deliberate trade-off is deletions. Without tombstones, an entity deleted
 * here but still present in the cloud comes back. That is the right way to be
 * wrong — a resurrected row is visible and takes one tap to delete again, while
 * silently dropped hours are money you never learn you lost.
 */
export function mergeStates(local: TractionState, remote: TractionState): TractionState {
  return {
    clients: unionById(local.clients, remote.clients, 'theirs'),
    services: unionById(local.services, remote.services, 'theirs'),
    entries: unionById(local.entries, remote.entries, 'theirs'),
    expenses: unionById(local.expenses, remote.expenses, 'theirs'),
    invoices: unionById(local.invoices, remote.invoices, 'theirs'),
    settings: {
      ...remote.settings,
      // Never step the counter backwards: both devices may have issued invoices
      // since they diverged, and a reused number is a real-world billing mess.
      invoiceCounter: Math.max(local.settings.invoiceCounter, remote.settings.invoiceCounter),
    },
  }
}

/**
 * Save the whole state document to Supabase (one row per user).
 *
 * Guarded by a compare-and-swap: we refuse to overwrite a cloud row this device
 * has never seen. Without it, a freshly-opened device holding an empty state
 * replaces the entire dataset the moment you touch anything. `force` is for the
 * two cases where overwriting IS the intent — Reset all, and importing a backup.
 */
export async function saveRemote(
  supabase: SupabaseClient,
  state: TractionState,
  opts: { force?: boolean } = {},
): Promise<SaveResult> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'error'

  if (!opts.force) {
    const { data: head, error } = await supabase
      .from('traction_states')
      .select('updated_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) return 'error'
    if (head?.updated_at && head.updated_at !== getRemoteSeen()) return 'stale'
  }

  const { data, error } = await supabase
    .from('traction_states')
    .upsert({
      user_id: user.id,
      state_json: state,
      updated_at: new Date().toISOString(),
    })
    .select('updated_at')
    .single()
  if (error || !data) return 'error'
  // Store the value the row actually holds now, so the next compare-and-swap
  // matches like for like (Postgres echoes `+00:00`, not the `Z` we sent).
  setRemoteSeen(data.updated_at)
  return 'saved'
}

export interface RemoteState {
  state: TractionState
  updatedAt: string
  /** True when this device had never observed the cloud row before this read. */
  firstSight: boolean
}

export async function loadRemote(supabase: SupabaseClient): Promise<RemoteState | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('traction_states')
    .select('state_json, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error || !data) return null
  const firstSight = getRemoteSeen() === null
  // We've now observed this version, so a later local save is allowed to build
  // on it — whether or not the caller decides to adopt it.
  setRemoteSeen(data.updated_at)
  return { state: hydrateState(data.state_json), updatedAt: data.updated_at, firstSight }
}

// ---- Export / import -----------------------------------------------------

/** The whole state as a pretty JSON backup string. */
export function serializeBackup(state: TractionState): string {
  return JSON.stringify({ app: 'traction', version: 1, exportedAt: new Date().toISOString(), state }, null, 2)
}

/** Parse a backup file back into state, or throw if it isn't one. */
export function parseBackup(text: string): TractionState {
  const parsed = JSON.parse(text)
  const state = parsed?.state ?? parsed
  if (!state || typeof state !== 'object' || !Array.isArray(state.entries)) {
    throw new Error('Not a traction backup file.')
  }
  return hydrateState(state)
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** All expenses as a CSV (one row per expense) for taxes / accountant. */
export function expensesToCSV(state: TractionState): string {
  const cli = (id: string | null) => id ? clientFullName(state.clients.find(c => c.id === id)) : ''
  const invNum = (id: string | null) => id ? (state.invoices.find(i => i.id === id)?.number ?? '') : ''
  const header = ['Date', 'Category', 'Label', 'Amount', 'Billable', 'Client', 'Invoice', 'Note']
  const rows = [...state.expenses]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt))
    .map(x => [
      x.date, x.category, x.label, x.amount, x.billable ? 'yes' : 'no',
      cli(x.clientId), invNum(x.invoiceId), x.note,
    ].map(csvCell).join(','))
  return [header.join(','), ...rows].join('\r\n')
}

/** All time entries as a CSV (one row per entry) for taxes / accountant. */
export function entriesToCSV(state: TractionState): string {
  const svc = (id: string) => state.services.find(s => s.id === id)?.name ?? 'Unknown'
  const cli = (id: string | null) => id ? clientFullName(state.clients.find(c => c.id === id)) : 'General'
  const invNum = (id: string | null) => id ? (state.invoices.find(i => i.id === id)?.number ?? '') : ''
  const header = ['Date', 'Client', 'Service', 'Note', 'Hours', 'Rate', 'Amount', 'Invoice']
  const rows = [...state.entries]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt))
    .map(e => [
      e.date, cli(e.clientId), svc(e.serviceId), e.note,
      decimalHours(e.seconds), isFlat(e) ? 'flat' : e.rate, entryAmount(e), invNum(e.invoiceId),
    ].map(csvCell).join(','))
  return [header.join(','), ...rows].join('\r\n')
}

// ---- Reporting date helpers ----------------------------------------------

/** ISO date of the Monday on or before `iso` (weeks start Monday). */
export function weekStartISO(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dow = (date.getDay() + 6) % 7 // 0 = Monday
  date.setDate(date.getDate() - dow)
  return todayISO(date)
}

/** 'YYYY-MM' month bucket for a 'YYYY-MM-DD' date. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

/** Pretty label for a period key given the granularity. */
export function periodLabel(key: string, granularity: 'day' | 'week' | 'month'): string {
  if (granularity === 'month') {
    const [y, m] = key.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
  }
  if (granularity === 'week') return `wk ${formatDate(key).replace(/,.*$/, '')}`
  return formatDate(key).replace(/,.*$/, '')
}
