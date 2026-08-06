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
  /**
   * Local calendar day the work is billed to, 'YYYY-MM-DD'. Always kept in sync
   * with `startedAt` when that is set — invoicing groups and filters on this.
   */
  date: string
  /**
   * epoch ms the work began. Null on legacy entries logged before wall-clock
   * times were tracked (those only ever knew `date` + `seconds`).
   *
   * NOTE: `seconds` — not (end − start) — remains the billing source of truth,
   * so nothing here can shift money on an existing entry. When `startedAt` is
   * set the two are kept consistent: editing either end of the range rewrites
   * `seconds`, and editing the duration moves the implied end time.
   */
  startedAt: number | null
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

/**
 * A cost you incurred. **Billable** expenses can be pulled onto a client's
 * invoice (client reimburses you); **non-billable** ones are your own overhead
 * (gas, gear, insurance) tracked for profit and taxes. The mirror image of a
 * TimeEntry, on the cost side.
 */
export interface Expense {
  id: string
  clientId: string | null
  label: string
  amount: number
  /** Free-ish tax bucket: Materials, Fuel, Equipment, Fees, Supplies, Other… */
  category: string
  date: string // YYYY-MM-DD
  /** true = pass through to a client's invoice; false = your own overhead. */
  billable: boolean
  /** Set once this expense has been placed on an invoice (billable only). */
  invoiceId: string | null
  note: string
  /**
   * Object path inside the private `receipts` Supabase Storage bucket, e.g.
   * `<uid>/<expenseId>-<ts>.jpg`. Null when no receipt photo is attached.
   *
   * Only the PATH lives in state — never the image bytes. The whole app state
   * is upserted as one JSON blob on every debounced save, so inlining photos
   * would re-upload every receipt on every keystroke.
   */
  receiptPath: string | null
  createdAt: number
}

/** A frozen expense line copied onto an invoice at creation (immutable record). */
export interface ExpenseLine {
  id: string
  label: string
  amount: number
}

export interface Invoice {
  id: string
  clientId: string
  number: string
  issuedDate: string // YYYY-MM-DD
  /**
   * When payment is due, 'YYYY-MM-DD'. Frozen at creation from
   * `issuedDate + settings.netDays` so later changing your default terms can't
   * retroactively make an old invoice overdue. Null on legacy invoices, which
   * are treated as having no due date (never "overdue", only "outstanding").
   */
  dueDate: string | null
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
  /** Billable expenses pulled onto this invoice (for reference / un-billing). */
  expenseIds: string[]
  /** Frozen expense lines at creation — the immutable materials record. */
  expensesSnapshot: ExpenseLine[]
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
  /** Default payment terms in days; stamped onto each new invoice's dueDate. */
  netDays: number
}

export interface TractionState {
  clients: Client[]
  services: Service[]
  entries: TimeEntry[]
  expenses: Expense[]
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
