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
  }
}

export function emptyState(): TractionState {
  return { clients: [], services: [], entries: [], expenses: [], invoices: [], settings: defaultSettings() }
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
): TimeEntry {
  return {
    id: genId(), clientId, serviceId, note: '', date,
    seconds: 0, runningSince: null, rate, invoiceId: null, createdAt: Date.now(),
  }
}

export function makeExpense(date: string): Expense {
  return {
    id: genId(), clientId: null, label: '', amount: 0, category: 'Materials',
    date, billable: true, invoiceId: null, note: '', createdAt: Date.now(),
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

// ---- Persistence ---------------------------------------------------------

/** Fill any missing fields so older/partial saved blobs hydrate safely. */
export function hydrateState(raw: unknown): TractionState {
  const r = (raw ?? {}) as Partial<TractionState>
  const clients = (Array.isArray(r.clients) ? r.clients : []).map((c): Client => ({
    ...c,
    rates: c.rates && typeof c.rates === 'object' ? c.rates : {},
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
    }
  })
  return {
    clients,
    services: Array.isArray(r.services) ? r.services : [],
    entries: Array.isArray(r.entries) ? r.entries : [],
    expenses: Array.isArray(r.expenses) ? r.expenses : [],
    invoices,
    settings: { ...defaultSettings(), ...(r.settings ?? {}) },
  }
}

export function saveLocal(state: TractionState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  localStorage.setItem(UPDATED_AT_KEY, new Date().toISOString())
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

/** Save the whole state document to Supabase (one row per user). */
export async function saveRemote(supabase: SupabaseClient, state: TractionState): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { error } = await supabase
    .from('traction_states')
    .upsert({
      user_id: user.id,
      state_json: state,
      updated_at: new Date().toISOString(),
    })
  return !error
}

export async function loadRemote(
  supabase: SupabaseClient,
): Promise<{ state: TractionState; updatedAt: string } | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('traction_states')
    .select('state_json, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error || !data) return null
  return { state: hydrateState(data.state_json), updatedAt: data.updated_at }
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
