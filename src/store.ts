import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Breakdown,
  BreakdownDay,
  BreakdownLine,
  Client,
  DurationStyle,
  Expense,
  Favorite,
  Invoice,
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

/** Sum of an invoice's frozen expense lines. */
export function expensesTotal(invoice: Pick<Invoice, 'expensesSnapshot'>): number {
  return Math.round((invoice.expensesSnapshot ?? []).reduce((s, x) => s + (x.amount || 0), 0) * 100) / 100
}

/**
 * An invoice's grand total = frozen labor + expenses. Uses the snapshot when
 * present (immutable record); falls back to live entries for legacy invoices.
 */
export function invoiceTotal(
  invoice: Pick<Invoice, 'snapshot' | 'expensesSnapshot' | 'entryIds'>,
  entries: TimeEntry[],
): number {
  const labor = invoice.snapshot
    ? invoice.snapshot.total
    : entries.filter(e => invoice.entryIds.includes(e.id))
        .reduce((s, e) => s + lineAmount(e.seconds, e.rate), 0)
  return Math.round((labor + expensesTotal(invoice)) * 100) / 100
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
      const key = `${e.serviceId}::${e.rate}`
      const existing = byLine.get(key)
      if (existing) {
        existing.seconds += secs
        if (e.note.trim() && !existing.notes.includes(e.note.trim())) {
          existing.notes.push(e.note.trim())
        }
      } else {
        byLine.set(key, {
          serviceId: e.serviceId,
          serviceName: serviceName(e.serviceId),
          notes: e.note.trim() ? [e.note.trim()] : [],
          seconds: secs,
          rate: e.rate,
          amount: 0,
        })
      }
    }

    const lines = [...byLine.values()].sort((a, b) => a.serviceName.localeCompare(b.serviceName))
    let daySeconds = 0
    let dayTotal = 0
    for (const line of lines) {
      line.amount = lineAmount(line.seconds, line.rate)
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

/** True when an expense is still waiting on a decision from you. */
export function isOpenExpense(x: Expense): boolean {
  const state = expenseState(x)
  return state === 'billable' || state === 'shelf'
}

export const SETTLED_LABELS: Record<SettledHow, string> = {
  cash: 'Paid cash',
  trade: 'Traded',
  personal: 'Used it myself',
  writeoff: 'Written off',
}

/** The order they're offered in — commonest first. */
export const SETTLED_OPTIONS: SettledHow[] = ['cash', 'trade', 'personal', 'writeoff']

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
  return [
    {
      ...x,
      amount: Math.round(billed * 100) / 100,
      // Written onto the expense so it survives onto the invoice snapshot and
      // answers "why was I only charged half?" without anyone having to
      // remember the conversation.
      note: [x.note, `${money(billed)} of ${money(x.amount)} total — remainder unused`]
        .filter(Boolean).join(' · '),
    },
    {
      ...x,
      id: genId(),
      amount: left,
      clientId: null,
      invoiceId: null,
      settled: null,
      // A receipt belongs with the original line, not duplicated onto the offcut.
      receiptPath: null,
      note: [x.note, `Unused remainder of ${money(x.amount)} ${x.label || 'expense'}`]
        .filter(Boolean).join(' · '),
      createdAt: Date.now(),
    },
  ]
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
export type PaymentState = 'unbilled' | 'invoiced' | 'paid'

export const PAYMENT_LABELS: Record<PaymentState, string> = {
  unbilled: 'unbilled', invoiced: 'invoiced', paid: 'paid',
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
  entry: Pick<TimeEntry, 'invoiceId'>,
  invoices: Pick<Invoice, 'id' | 'status'>[],
): PaymentState {
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
  entries: Pick<TimeEntry, 'invoiceId'>[],
  invoices: Pick<Invoice, 'id' | 'status'>[],
): PaymentState {
  const states = new Set(entries.map(e => paymentStateOf(e, invoices)))
  if (states.has('unbilled')) return 'unbilled'
  if (states.has('invoiced')) return 'invoiced'
  return 'paid'
}

/** True when a group spans more than one payment state — worth flagging in UI. */
export function isMixedPayment(
  entries: Pick<TimeEntry, 'invoiceId'>[],
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
    // Entries predating job photos have no array at all.
    photoPaths: Array.isArray(e.photoPaths) ? e.photoPaths : [],
  }))
  const expenses = (Array.isArray(r.expenses) ? r.expenses : []).map((x): Expense => ({
    ...x,
    receiptPath: typeof x.receiptPath === 'string' ? x.receiptPath : null,
    // Absent on everything logged before settling existed.
    settled: x.settled && typeof x.settled === 'object' ? x.settled : null,
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
      decimalHours(e.seconds), e.rate, lineAmount(e.seconds, e.rate), invNum(e.invoiceId),
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
