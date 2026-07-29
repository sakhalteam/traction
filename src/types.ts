// ---- Core entities -------------------------------------------------------

/** A person/household you do work for. */
export interface Client {
  id: string
  name: string
  email: string
  phone: string
  address: string
  notes: string
  /** Optional per-service rate overrides, keyed by serviceId. Falls back to the
   *  service's default rate when a service isn't listed here. */
  rates: Record<string, number>
  archived: boolean
  createdAt: number
}

/**
 * A reusable *type* of work ("Deck cleanup", "Replanting", "Pressure washing").
 * Services are global — never owned by a client. Client-specificity lives on the
 * time entry (its client + free-text note), not here.
 */
export interface Service {
  id: string
  name: string
  /** Default $/hr. Copied onto each entry at log time and editable per entry. */
  defaultRate: number
  color: string
  archived: boolean
  createdAt: number
}

/**
 * One chunk of tracked work. The atom of both the timer and the invoice.
 * `clientId === null` means non-client / general work.
 */
export interface TimeEntry {
  id: string
  clientId: string | null
  serviceId: string
  /** Free text for the specific instance, e.g. "south side rock wall". */
  note: string
  /** Local calendar day the work is billed to, 'YYYY-MM-DD'. */
  date: string
  /** Accumulated finalized duration in seconds (excludes any live running span). */
  seconds: number
  /** epoch ms if the timer is currently running for this entry, else null. */
  runningSince: number | null
  /** $/hr snapshotted from the service at creation; edit freely without touching history. */
  rate: number
  /** Set once this entry has been placed on an invoice. */
  invoiceId: string | null
  createdAt: number
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid'

/** A non-time charge on an invoice (materials, dump fees, flat charges). */
export interface Expense {
  id: string
  label: string
  amount: number
}

export interface Invoice {
  id: string
  clientId: string
  number: string
  issuedDate: string // YYYY-MM-DD
  periodStart: string // YYYY-MM-DD
  periodEnd: string // YYYY-MM-DD
  /** Entries frozen onto this invoice (kept for reference / un-billing). */
  entryIds: string[]
  /**
   * The labor breakdown FROZEN at creation. An invoice is an immutable record —
   * editing/deleting the underlying entries later must never change what a sent
   * invoice says. Legacy invoices created before this field re-derive from live
   * entries (handled in InvoiceDetail).
   */
  snapshot: Breakdown | null
  /** Non-time charges (materials, dump fees). Editable while unpaid. */
  expenses: Expense[]
  status: InvoiceStatus
  /** Set to today's date when first marked paid; cleared if un-paid. */
  paidDate: string | null
  notes: string
  createdAt: number
}

export interface Settings {
  businessName: string
  businessEmail: string
  businessPhone: string
  businessAddress: string
  /** Monotonic counter for auto invoice numbers. */
  invoiceCounter: number
  /** Currency symbol prefix, e.g. "$". */
  currency: string
}

export interface TractionState {
  clients: Client[]
  services: Service[]
  entries: TimeEntry[]
  invoices: Invoice[]
  settings: Settings
}

// ---- Derived shapes (invoice breakdown) ----------------------------------

export interface BreakdownLine {
  serviceId: string
  serviceName: string
  notes: string[]
  seconds: number
  rate: number
  amount: number
}

export interface BreakdownDay {
  date: string
  lines: BreakdownLine[]
  daySeconds: number
  dayTotal: number
}

export interface Breakdown {
  days: BreakdownDay[]
  totalSeconds: number
  total: number
}
