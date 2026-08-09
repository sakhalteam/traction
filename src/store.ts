import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Breakdown,
  BreakdownDay,
  BreakdownLine,
  Client,
  Expense,
  Invoice,
  Service,
  Settings,
  TimeEntry,
  TractionState,
} from './types'

export const EXPENSE_CATEGORIES = ['Materials', 'Fuel', 'Equipment', 'Fees', 'Supplies', 'Other']

const STORAGE_KEY = 'traction-state'
const UPDATED_AT_KEY = 'traction-updated-at'
const REMOTE_SEEN_KEY = 'traction-remote-seen'

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
    invoiceCounter: 1,
    currency: '$',
    netDays: 30,
    logoPath: null,
  }
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

/** "3h 47m" — compact human duration. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h === 0 && m === 0) return `${s % 60}s`
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
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
  return {
    clients,
    services: Array.isArray(r.services) ? r.services : [],
    entries,
    expenses,
    invoices,
    settings: { ...defaultSettings(), ...(r.settings ?? {}) },
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

export type SaveResult = 'saved' | 'stale' | 'error'

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
  const cli = (id: string | null) => id ? (state.clients.find(c => c.id === id)?.name ?? 'Unknown') : ''
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
  const cli = (id: string | null) => id ? (state.clients.find(c => c.id === id)?.name ?? 'Unknown') : 'General'
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
