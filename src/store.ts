import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Breakdown,
  BreakdownDay,
  BreakdownLine,
  Client,
  Service,
  Settings,
  TimeEntry,
  TractionState,
} from './types'

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
  return { clients: [], services: [], entries: [], invoices: [], settings: defaultSettings() }
}

// ---- Factories -----------------------------------------------------------

export function makeClient(name: string): Client {
  return {
    id: genId(), name, email: '', phone: '', address: '', notes: '',
    archived: false, createdAt: Date.now(),
  }
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
  return {
    clients: Array.isArray(r.clients) ? r.clients : [],
    services: Array.isArray(r.services) ? r.services : [],
    entries: Array.isArray(r.entries) ? r.entries : [],
    invoices: Array.isArray(r.invoices) ? r.invoices : [],
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
