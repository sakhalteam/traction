# Next up — nothing pinned

**For whoever picks this up next (human or Claude Code).** The five pinned features from
September 2026 are closed: four shipped, one dropped on purpose. Nothing is queued. Read
the orientation below before touching anything, then ask Nic what he wants — don't pick
something off the "parked" list on your own.

---

## Orientation (read first if you're new to this repo)

traction is a solo-trade back-office app (Friendly Pressure): track time → build invoices →
get paid. Vite + React 19 + TypeScript, deployed to GitHub Pages at `/traction/`.

**The whole app state is one JSON blob** in a single Supabase row per user
(`supabase-setup.sql`). That means adding fields to an entity costs **no migration** — just
default it in `hydrateState` (`src/store.ts`) so older blobs keep loading. Pricing on
expenses has lived in three places over three eras; `hydratePricing` is the worked example
of lifting an old shape into a new one without losing what a user already entered.

Files you'll care about:

| | |
|---|---|
| `src/types.ts` | Every entity. Heavily commented — the comments explain *why*, keep that up. |
| `src/store.ts` | Pure logic: state derivation, splitting, merging, pricing, invoice maths, sync. |
| `src/App.tsx` | All state mutations live here as `useCallback`s over `mutate`, which is also where undo snapshots are taken. |
| `src/views/ExpensesView.tsx` | The Expenses tab, including the shelf and the assign/pricing drawer. |
| `src/useShelfDrag.ts` | Pointer-event drag hook (works on touch *and* mouse). |
| `src/receipts.ts` | Supabase Storage: upload/downscale/sign, plus the orphan sweep. Paths only in state. |

### How to run and verify

```bash
npm run dev                          # localhost:5173/traction/
node scripts/smoke.mjs               # 139 checks — the whole app
node scripts/smoke-measured.mjs      # 32 — track by quantity, per-job pricing
node scripts/smoke-undo.mjs          # 18 — undo/redo
node scripts/smoke-comp.mjs          # 15 — comps and trades on invoices
npx tsc -b                           # ALWAYS before committing — deploy fails on TS errors
npm run build
```

All suites need the dev server up and `npm i --no-save playwright-core`; they drive installed
Edge via `channel: 'msedge'`.

### Six traps this codebase will spring on you

1. **The cloud merge keeps no tombstones.** `mergeStates` unions every collection by id; a
   record deleted on one device while the cloud still holds it **comes back**. That's
   deliberate and correct for time entries (a resurrected row is visible and one tap to
   remove; silently dropped hours are money gone). It is *not* safe for anything
   representing money that could be double-counted. The shelf's recombine works around
   this by **absorbing rather than deleting** — see `Expense.absorbedInto`. Copy that
   pattern for anything similar.
2. **Whole-object merge, so new fields ride along free** — but a field only one device
   knows about will lose to the cloud's copy of that record wholesale. Never split one
   fact across two records.
3. **Mobile time-entry rows are a named CSS grid.** In the phone block of `src/index.css`,
   `.entry-row:not(.xrow)` becomes `"swatch main main" / "swatch figures actions"`.
   **Any new child needs an explicit grid placement** or it auto-places into a column it
   then widens. This bit us three times — the last was the money line sharing the colour
   bar's column and leaving a 250px empty square beside every title. Expense rows are
   `.xrow` and lay themselves out as a folded line instead; tests reach their buttons
   through an `openRow` helper, and drags through the `.drag-handle` grip.
4. **Sticky header + fixed tab bar cover anything scrolled to a viewport edge.** Fixed
   globally with `scroll-padding` on `html`. If you add more fixed chrome, update it.
5. **StrictMode runs every `setState` updater twice.** `mutate` still does its work inside
   one, which is only safe because each step is idempotent — the undo push checks what is
   already on top of the stack. `undo`/`redo` do their bookkeeping *outside* the updater,
   because a pop cannot be made idempotent; doing it inside silently stepped back two
   actions at a time. Anything new that mutates a ref belongs outside.
6. **Nothing deletes a stored photo on the spot any more.** Deleting an expense or an entry,
   or detaching a receipt, only forgets the path, so undo can put it back. Stored images
   are cleaned up by **Settings → Stored photos**, which builds its in-use set from
   receipts, job photos, the logo *and* the invoice background — they share one bucket.
   If you add another kind of stored file, add it to that set or the sweep will delete it.

### Invoices are frozen records

An invoice snapshots its lines at creation (`Invoice.snapshot`, `Invoice.expensesSnapshot`,
`Invoice.adjustments`). Editing the underlying work later must **never** change what a sent
invoice says. When in doubt, the rule is: *what have we already told the client they owe?*
Draft = nothing, change freely. Sent = they've seen a number, warn and offer to
void/reissue. Paid = refuse, and handle it as a credit on the next invoice.

### Money has two numbers, and they never merge

`Expense.amount` is always **what Nic paid**. What a client is charged is derived —
`billedAmount()`: amount × (1 + markup) + a flat per-job service fee. Reports is built on
`amount`; invoices freeze the billed figure. A marked-up number stored as `amount` would
quietly make the business look like it spends more than it does.

---

## What shipped from the September pins

| Pin | Status | Where to look |
|---|---|---|
| 2. Stock that stops nagging | **Shipped, reframed.** Nic wants the shelf to show what's in the shed, so containers stay on it and deplete visibly — "Track by quantity" (`Expense.measure`). No separate stock section. | `drawMeasured`, `MeasureFields` |
| 3. Markup on materials | **Shipped for every billable expense**, not just measured ones. Markup %, service fee and invoice name are defaults on the expense and chosen again per job in the assign drawer. `0` markup = pass-through at cost. | `priceUnits`, `billedAmount`, `AssignFields` |
| 4. Undo/redo | **Shipped.** In-memory, this device and this session only, capped at 40. Cleared whenever cloud state is adopted or merged. | `mutate`, `undo`, `redo` in `App.tsx` |
| 5. Comp / discount / trade | **Shipped.** `Invoice.adjustments`, drafts only, two kinds — comp (money given away) and trade (money swapped for something you now own). Reports keeps them apart. | `AdjustmentsEditor`, `adjustmentsTotal` |
| 1. One receipt, many expenses | **Dropped.** Uploading the same receipt photo to each expense costs ~200KB a time against a 1GB free tier, and keeps every charge carrying its own evidence. A shared-receipt entity would have added a model, a migration and a new class of bugs to save two taps on an occasional shopping trip. | — |

### Decisions worth not relitigating

- **Pricing is suggested, never enforced.** Every computed price is an editable prefill.
  A big lawn owned by someone Nic wants to go easy on gets a regular-sized fee, on
  purpose, and the record says so afterwards. A formula he can't overrule is worse than
  no formula.
- **A fee-bundled invoice line prints one name and one total.** Dividing a bundled price
  back out would quote a per-unit rate he never set. Without a fee, material prints
  `× qty @ price` like any pass-through. Either way Nic still sees the count in-app —
  past jobs are how he estimates the next one.
- **Material margin and service fees are reported separately**, and so are comps and
  trades. Summing either pair hides the number worth tuning.

## Parked — only if Nic asks

- **Restore points** (synced version history, like adhdo's `galaxy_versions`). Nic parked
  this himself: a restore on one device overwriting another made him nervous, and the
  no-tombstone merge means a restore would need an epoch marker to stick. The JSON
  backup/restore in Settings covers the disaster case today.
- **"Use a receipt from another expense"** — attach an already-uploaded photo instead of
  uploading it again. About an hour. Only worth it if re-uploading starts to annoy him.

---

## A note on how Nic likes to work

Talk it through before building. He'd rather chat over a design and be pushed back on than
receive a finished thing built on a wrong assumption — the shelf rework went through two
full rounds of Q&A before a line was written, and it was much better for it. He also
changes his mind when a design turns out heavier than the problem (Pin 1), and that's a
good outcome, not a wasted conversation.

He has severe ADHD: keep responses concise, lead with what you did, and nudge him back on
track if the conversation wanders off an in-progress thing.

He's on a laptop *and* a PC, syncing through git and Supabase, so **anything that only
works on one machine is a bug.**
