# Next up — three pinned features

**For whoever picks this up next (human or Claude Code).** Written after shipping the
shelf rework (`cfa6ee2`). Each pin below came out of a real conversation about real jobs,
so the *why* matters as much as the *what* — read a pin's rationale before designing
around it.

Work them in any order; they don't depend on each other. Pin 1 is the biggest and the one
Nic hits most often.

---

## Orientation (read first if you're new to this repo)

traction is a solo-trade back-office app (Friendly Pressure): track time → build invoices →
get paid. Vite + React 19 + TypeScript, deployed to GitHub Pages at `/traction/`.

**The whole app state is one JSON blob** in a single Supabase row per user
(`supabase-setup.sql`). That means adding fields to an entity costs **no migration** — just
default it in `hydrateState` (`src/store.ts:1008`) so older blobs keep loading.

Files you'll care about:

| | |
|---|---|
| `src/types.ts` | Every entity. Heavily commented — the comments explain *why*, keep that up. |
| `src/store.ts` | Pure logic: state derivation, splitting, merging, invoice maths, sync. |
| `src/App.tsx` | All state mutations live here as `useCallback`s over `mutate`. |
| `src/views/ExpensesView.tsx` | The Expenses tab, including the shelf. |
| `src/useShelfDrag.ts` | Pointer-event drag hook (works on touch *and* mouse). |
| `src/receipts.ts` | Supabase Storage: upload/downscale/sign/delete. Paths only in state. |
| `scripts/smoke.mjs` | Functional suite driving a real browser. **Currently 138 checks.** |

### How to run and verify

```bash
npm run dev                 # localhost:5173/traction/
node scripts/smoke.mjs      # needs the dev server up; 138/138 must pass
npx tsc -b                  # ALWAYS before committing — deploy fails on TS errors
npm run build
```

### Five traps this codebase will spring on you

1. **The cloud merge keeps no tombstones.** `mergeStates` (`src/store.ts:1177`) unions
   every collection by id; a record deleted on one device while the cloud still holds it
   **comes back**. That's deliberate and correct for time entries (a resurrected row is
   visible and one tap to remove; silently dropped hours are money gone). It is *not*
   safe for anything representing money that could be double-counted. The shelf's
   recombine works around this by **absorbing rather than deleting** — see
   `Expense.absorbedInto`. Copy that pattern for anything similar.
2. **Whole-object merge, so new fields ride along free** — but a field only one device
   knows about will lose to the cloud's copy of that record wholesale. Never split one
   fact across two records.
3. **Mobile rows are a named CSS grid.** In the `max-width: 860px` block
   (`src/index.css`), `.entry-row` becomes `grid-template-areas: "swatch main" …`.
   **Any new child of `.entry-row` needs an explicit grid placement** or it auto-places
   into a ~100px column and renders as a squeezed mess. This bit us twice.
4. **Sticky header + fixed tab bar cover anything scrolled to a viewport edge.** Fixed
   globally with `scroll-padding` on `html`. If you add more fixed chrome, update it.
5. **Never do side effects inside a `setState` updater.** StrictMode double-invokes them.

### Invoices are frozen records

An invoice snapshots its lines at creation (`Invoice.snapshot`, `Invoice.expensesSnapshot`).
Editing the underlying work later must **never** change what a sent invoice says. When in
doubt, the rule is: *what have we already told the client they owe?* Draft = nothing, change
freely. Sent = they've seen a number, warn and offer to void/reissue. Paid = refuse, and
handle it as a credit on the next invoice.

---

## Pin 1 — One receipt, many expenses

### The problem

Nic goes to Home Depot and buys weed fabric, landscape staples and nails **in one
transaction, on one receipt**. The nails were for client A; the fabric and staples for
client B. In traction that's three separate expenses, but `Expense.receiptPath` is a single
string — so today he'd either attach the same photo three times (three uploads, three
storage objects, three things to keep in sync) or attach it to one and lose the evidence on
the other two.

This is the single most common real-world shape of his spending and the model doesn't
represent it.

### Why it matters beyond tidiness

- **Storage**: free-tier Supabase, and receipts are the bulk of it. Three copies of one
  4MB photo (downscaled to ~200KB each) is waste that compounds.
- **Evidence**: when a client queries a charge months later, the answer is "here's the
  receipt" — which should be *the* receipt, not one of three near-duplicates.
- **Deletion**: already subtle. Split pieces share a path and `receiptRefCount`
  (`src/store.ts:560`) makes sure only the last one out deletes the object. A proper
  many-to-one model should make that guard the *natural* behaviour rather than a special
  case bolted on.

### Suggested design

Promote the receipt to its own entity and let expenses reference it.

```ts
/** One photographed purchase, which may have paid for several expenses. */
export interface Receipt {
  id: string
  /** Object path in the private `receipts` Storage bucket. */
  path: string
  /** Vendor / what it was, for finding it again: "Home Depot, Sep 14". */
  label: string
  date: string          // YYYY-MM-DD
  /** Total on the paper, so the split across expenses can be checked against it. */
  total?: number | null
  createdAt: number
}
```

Then on `Expense`, **keep `receiptPath` and add `receiptId`**. Do not rip out
`receiptPath`: every existing expense has one, and `hydrateState` should treat a bare
`receiptPath` with no `receiptId` as a valid legacy one-off. Read through a helper
(`receiptFor(expense, state)`) that prefers `receiptId` and falls back to `receiptPath`, so
no view needs to know which era a record is from.

### The flow worth building

The valuable version isn't "attach the same photo to three rows" — it's **"photograph the
receipt once, then split it into the expenses it paid for."** Something like:

1. Snap the receipt → creates a `Receipt` plus **one** expense for the full amount, on the
   shelf (no client yet).
2. That expense is then cut up with the machinery that already exists (`½`, split into N),
   and each piece dragged to whoever used it.
3. Every piece points at the same `receiptId`, and the UI shows *"part of a shared
   receipt"* (this tag already exists — `.partial-tag`, `ExpensesView.tsx:519`).

That reuses the whole shelf feature instead of inventing a parallel one. **Strongly prefer
this over a multi-select attach UI.**

### Edge cases to get right

- **Deleting an expense** must only delete the Storage object when no *other* live expense
  references that receipt. Generalise `receiptRefCount` to count by `receiptId` as well as
  `receiptPath`. See `App.tsx:488` for the current guard.
- **Replacing** a photo on one expense that shares a receipt: does it replace for all? It
  should — it's one piece of paper. Make that explicit in the UI rather than silently
  doing either thing.
- **Orphaned receipts**: if every expense referencing a receipt is deleted, the `Receipt`
  record and its object should go too.
- A receipt whose expense pieces **don't sum to `total`** is not an error (he may not have
  logged everything on it) but is worth surfacing quietly.

### Verification

Add smoke coverage: one receipt → split into three → each piece assigned to a different
client → delete two → the photo still exists for the third → delete the third → the object
is cleaned up. Note the smoke suite can't reach real Supabase Storage, so assert on state
shape and on `receiptRefCount` logic in isolation.

---

## Pin 2 — "Stock" items that stop asking to be attributed

### The problem

Some material isn't bought for a job — it lives on the truck. A $150 bucket of zinc roof
treatment does about five roofs. Right now anything billable with no client sits on the
shelf **asking to be attributed**, forever. That's correct for 300yd of fabric bought for
the Stein job. It's wrong, and quietly nagging, for a bucket of consumable you restock.

### Why it matters

The shelf's whole value is that it's a short list of decisions you still owe yourself. A
permanent resident that will never be attributed is exactly the kind of thing that makes an
ADHD-friendly list stop working — once there's noise on it, you stop reading it.

### Suggested design

A third state alongside billable/overhead, or a flag on a shelf item: **stock**. Marking a
shelf item as stock should:

- Drop it out of the shelf list and its total.
- Count as **overhead** in Reports (it's a cost of doing business, absorbed by the price of
  the service — see Pin 3 and the *Business notes* section of the how-to).
- Stay findable — a "Stock" filter or section, so "what do I have on the truck" is still
  answerable.

Model-wise this is probably a `stock?: boolean` on `Expense` plus a branch in
`expenseState()` (`src/store.ts:328`), which is already the single place every view asks
"where does this sit". Everything downstream (`isOpenExpense`, the tiles, the invoice
builder candidate filter, Reports) reads from there, so one well-placed branch does most of
the work. **Check each of those call sites** rather than assuming.

Do **not** implement this as a `billable: false` flip. There's a long-standing rule in this
codebase (see the comment on `Expense.settled` in `types.ts`): overhead means *a cost that
was never a client's*, and rewriting history to say that changes what Reports claims about
the business. Stock is its own thing: a cost that's real, yours, and not yet consumed.

### Open question for Nic

Should stock be **depletable** — i.e. does he want to record "used ⅕ of the bucket on the
Okonkwo roof" and watch it draw down? That's genuinely useful inventory tracking and the
lineage/split machinery could express it, but it's a much bigger feature and edges toward
"inventory app". **Ask before building it.** The minimum viable version is just "stop
nagging me about this", which is the actual complaint.

---

## Pin 3 — Markup on materials

### The problem

Nic marks materials up (he mentioned ~20% on the zinc bucket). traction currently bills
materials **at cost**: the expense amount goes straight onto the invoice. So either he
edits the amount to the marked-up figure — losing what he actually paid, which is the
number Reports needs for profit — or he eats the markup.

Those are two different numbers and the model only has room for one.

### Why it matters

It's the difference between "what I spent" (Reports, taxes, profit) and "what they owe"
(the invoice). Conflating them corrupts the profit figures, which is the thing the
Overhead/Materials split in Reports exists to protect.

### Suggested design

Add to `Expense` something like:

```ts
/** Percentage added when this is billed on. Absent/0 = billed at cost. */
markupPct?: number
```

- `amount` stays **what you paid**. Reports keeps using it unchanged.
- A derived `billableAmount(expense)` = `amount * (1 + markupPct/100)`, rounded to cents, is
  what reaches the invoice.
- The invoice's `expensesSnapshot` freezes the **billed** figure (it already freezes label
  and amount — see `App.tsx:582`, where the snapshot is built). What the client sees must
  not move when you later correct a markup.
- A default markup in `Settings` so he isn't typing 20 every time, overridable per expense.

Interactions to be careful about:

- **Splitting**: `splitExpense` / `splitExpenseEqually` (`src/store.ts:385` and `:438`) must carry
  `markupPct` onto every piece, and the "$38.52 of $77.04 total" note should keep quoting
  **cost** figures consistently (or switch wholly to billed figures — pick one and say so
  in the note, don't mix).
- **Recombining**: `recombineExpenses` should refuse, or ask, if pieces carry different
  markups — same spirit as the sibling rule.
- **Whether the client sees the markup at all.** Probably not as a separate line — most
  trades bill a materials price, not "cost + 20%". Default to showing one number, and ask
  Nic before exposing the breakdown on an invoice.

### The policy question is already settled — don't relitigate it

The *pricing philosophy* was worked out and shipped into the **Business notes** section of
the how-to (`src/views/HelpView.tsx`, section id `notes`, and §9 of `docs/how-to.md`). The
short version:

> **Bought for this job specifically → pass it through. Kept on the truck → price it into
> the service.** You're not selling a bucket, you're selling a roof treatment.

Markup is the tool for the *first* half of that rule. Pin 2 (stock) is the tool for the
second. If the design starts drifting toward "charge the first client for the whole
bucket", re-read that section — Nic considered and rejected that.

---

## A note on how Nic likes to work

Talk it through before building. He'd rather chat over a design and be pushed back on than
receive a finished thing built on a wrong assumption — the shelf rework went through two
full rounds of Q&A before a line was written, and it was much better for it. He has severe
ADHD: keep responses concise, lead with what you did, and nudge him back on track if the
conversation wanders off an in-progress thing.

He's on a laptop *and* a PC, syncing through git and Supabase, so **anything that only
works on one machine is a bug.**
