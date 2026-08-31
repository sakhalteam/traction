# traction — the complete how-to guide

Everything traction does, why it works the way it does, and step-by-step recipes
for the real jobs you'll run. Written for a solo landscaping / pressure-washing
business (Friendly Pressure), but it works for any hourly trade.

If you just want the 30-second version: **track time against a service + client →
when they want to pay, roll the unbilled days into an invoice → mark it paid →
keep going.** Everything below is the detail behind that loop.

---

## Table of contents

1. [The mental model (read this first)](#1-the-mental-model-read-this-first)
2. [First-time setup](#2-first-time-setup)
3. [The tabs, one by one](#3-the-tabs-one-by-one)
   - [Timer](#timer) · [Log](#log) · [Expenses](#expenses) · [Clients](#clients) · [Services](#services) · [Invoices](#invoices) · [Reports](#reports) · [Settings](#settings)
4. [Guarantees & behaviors worth knowing](#4-guarantees--behaviors-worth-knowing)
5. [Worked examples](#5-worked-examples)
6. [Sync, backups & data safety](#6-sync-backups--data-safety)
7. [FAQ & troubleshooting](#7-faq--troubleshooting)
8. [Using it on your phone](#8-using-it-on-your-phone) ← **install it to your home screen**

---

## 1. The mental model (read this first)

traction has **five** things. Get these and everything else clicks.

| Thing | What it is | Example |
|-------|-----------|---------|
| **Client** | A person/household/HOA you bill. Optional — work can be "General". | *Larry & Linda*, *Maple St HOA* |
| **Service** | A reusable **type of work** with a default hourly rate. **Global** — never owned by a client. | *Deck cleanup* @ $30/hr, *Pressure washing* @ $55/hr |
| **Time entry** | One chunk of tracked work = `service + client + date + duration + rate + note`. | *Jul 7 · Deck cleanup · Larry & Linda · 3h 47m · $30/hr* |
| **Expense** | A cost you incurred. **Billable** ones go on a client's invoice; **overhead** (gas, gear) stays off invoices and feeds your profit. | *Jul 7 · Mulch · $120 · billable · Larry & Linda* |
| **Invoice** | A frozen bundle of a client's unbilled time **and** billable expenses, grouped by day → service. | *LARRYLINDA-20260825-01 · Larry & Linda · $273.50* |

**The one concept that trips people up:** "Is this work tied to a client or not?"
You don't answer that on the *service* — services are always reusable and global.
You answer it on the **entry**: an entry names a client (or "General"), and any
client-specific detail goes in the entry's **note**.

> So *"deck cleanup"* is a Service (everyone gets it). *"South side rock wall for
> Larry"* is just a time entry: `service = Masonry, client = Larry & Linda,
> note = "south side rock wall"`. No special folders, no fuss.

**Rates flow like this** when you start a timer:

```
per-client override for that service   →   the service's default rate   →   (you can still type a custom rate)
```

---

## 2. First-time setup

1. **Open traction** at [sakhalteam.github.io/traction](https://sakhalteam.github.io/traction/).
2. **Sign in** (top-right, GitHub) — this syncs your data across laptop + PC. You
   *can* skip it and work offline, but then data lives only in that one browser.
3. **Settings → Business details** — fill in your business name, phone, email,
   address. This is the "from" block printed on every invoice. Set your currency
   symbol here too.
4. **Add a few Services** (Services tab) — your common jobs with their default
   rates. You can always add more on the fly from the Timer.
5. **Add your Clients** (Clients tab) — or add them inline while starting a timer.

That's it. Now you're ready to track.

---

## 3. The tabs, one by one

### Timer

Your home base for tracking live work.

- **▶ Again:** the big green button restarts the last job you did, in one tap. This
  is the fastest path and usually the right one.
- **Job chips:** below it, your **pinned** jobs (★, amber) followed by recent ones.
  One tap re-starts that exact *service + client* — no re-picking. On a phone the
  strip scrolls sideways; swipe for more.
- **Again grid:** the four jobs you did most recently, as four equal one-tap buttons in
  a 2x2. Each shows its service and the client's coloured pill. No pickers, no scrolling.
- **Pinning:** tap the ☆ on any chip, or **☆ Pin** next to Start, to keep a job on
  the list permanently. Recent-only ordering works fine at five clients; once you're
  juggling fifteen, the job you do every Tuesday drops off by Thursday. Pin it.
- **Start a timer manually:** pick a **Service**, optionally a **Client**, tweak the
  **Rate**, add a **Note** (e.g. "south side rock wall"), hit **▶ Start timer**.
  Only one timer runs at a time — starting a new one auto-stops the previous.
- **The Service and Client boxes are searchable.** Tap one, start typing, tap the
  result. If what you typed doesn't exist yet, the top row offers **+ New client
  "Vasquez"** — so you can add someone while standing in their driveway. (A service
  created this way starts at $0/hr; type the rate in the Rate box, and set a proper
  default later under **Services**.)
- **Rate auto-fills** from the client's custom rate (if set) or the service default.
  The number shown as a placeholder is what you'll be billed at unless you type over it.
- **Running card:** while a timer runs you get a big live clock + running dollar
  amount + **■ Stop**.
- **Today list:** everything logged today, with live totals (time + $) at the top.
- **Ready to invoice** sits below the timer: any client with unbilled work older
  than three days, already totalled, with a button straight to their invoice.
  **Tap a client's name to open the row** and see every entry behind that number —
  date, service, note, hours and amount — then tap again to close it. Same scrutiny
  the invoice builder gives you, without leaving the timer.

> 💡 **A running timer follows you.** Switch to Invoices or Expenses and a slim green
> bar stays pinned to the bottom of the screen with the live clock, the running
> amount, and a **■** to stop it. Tap the bar itself to jump back to the Timer. The
> browser tab title also shows the clock (`▶ 0:42:15 · traction`), and if a timer
> runs past **8 hours** you get a *"still on the clock?"* nudge with a one-tap Stop.

### Log

Every entry, grouped by date, newest first — your full history and manual-entry tool.

- **+ Manual entry:** forgot to run the timer? Add time by hand — service, client,
  **date, start time and end time**, rate, note. The times you type are the times that
  print on the invoice, so a client never reads a start you weren't there for. Typing a
  duration instead moves the **end** and leaves the start alone.
- **Filter by client** to see just one person's history.
- **Edit** (✎) any entry to fix the service, client, rate, note, or times. **Start and
  end are independent** — moving one never drags the other along, it just changes the
  duration between them. Typing a duration (or using the ±5m/±15m buttons) moves the
  **end** and leaves the start alone. Nothing can be set in the future.
- **Editing a running timer:** ✎ works on a live entry too, so you can fix a start you
  began 20 minutes late without stopping. Its **End** is blank while it runs — leave it
  blank to keep going, or set a time to stop it right there.
- **Delete** (✕) an entry you logged by mistake.
- **Locked entries:** once an entry is on an invoice it shows an **invoiced** tag and
  the edit/delete buttons disappear — see [guarantees](#4-guarantees--behaviors-worth-knowing).

### Expenses

Track costs the moment you incur them — the mirror image of time entries, on the cost side.

- **Log an expense:** what it was (e.g. *Mulch*), amount, **category** (Materials, Fuel,
  Equipment, Fees, Supplies, Other), date, and a **Type**:
  - **Billable** — a cost you pass through to a client (materials, dump fees). Pick the
    **client** so it can ride onto their next invoice. The client reimburses you.
  - **Overhead** — *your* cost that never goes on a client bill (gas, a new pressure
    washer, insurance). It just feeds your profit numbers and taxes.
- **Two summary tiles:** *Unbilled billable* (materials waiting to go on an invoice) and
  *Overhead logged* (your own costs).
- **Filter** the history by All / Billable / Overhead.
**A billable expense has four ways out, not one.** It can go on an invoice, be settled
another way, sit on the shelf, or be plain overhead:

| | |
|---|---|
| **Ready to bill** | On a client, not yet invoiced. Real money to recover. |
| **On the shelf** | Bought, billable, but no client yet — material you own. Assign it (◎) to whoever ends up using it. |
| **Settled** | Closed without an invoice: **paid cash**, **traded**, **used it myself**, **written off**. Amount and receipt stay in history; it just stops waiting to be billed. |
| **Overhead** | Never a client's cost. Feeds profit in Reports. |

- **The two tiles at the top open.** Tap *Ready to bill* or *On the shelf* to see exactly
  which expenses make up the number, each with its actions.
- **✓ Settle without invoicing** is the escape hatch for real life — they handed you cash
  at the door, you swapped it for concert tickets, you ended up using the gravel at your
  own house, or you have simply given up on it. Pick a reason, add a note if you want.
  **↺** reopens it if you were wrong.
- **½ Charge only part of this** splits an expense. Say you bought $77.04 of lumber and
  only used half on a deck: charge $38.52, and the invoice line reads
  *"LUMBER — $38.52 of $77.04 total — remainder unused"* so a dispute answers itself.
  The other $38.52 goes to **the shelf** with no client attached — it is wood you own, not
  money that client still owes.
- **History** below is everything already dealt with. What still needs a decision from
  you lives up top, because a task buried in a chronological log is a task you forget.
- **Edit / delete** any expense — unless it's already on an invoice (then it's locked,
  same as time entries; delete the invoice to unlock it).

> Billable expenses show up as **candidates in the invoice builder** for that client, and
> get marked paid when the invoice is paid. Overhead never touches a client — it only
> shows up in **Reports → Profit**.

### Clients

- **Add** a client with just a name (e.g. *Larry & Linda*); fill in the rest by
  editing (✎).
- **Names are First / Last / Business, and any of them alone is enough.** A business
  with no person (*FARTTOWN PIZZAS*), a first name with no surname (*Cathy*), or both —
  in which case the business is billed and the person becomes the invoice's *Attn:* line.
- **Couples get "+ Add another person"**, because a client often genuinely *is* two
  people. A shared surname collapses — Sylvia + Craig, both Gardner, read as
  **Sylvia & Craig Gardner**. Different surnames spell out: **Dana Vasquez & Kim
  Oyelaran**. They sort under the first surname, not the first first name.
- **Two names are derived from that**, and the editor shows you both as you type:
  the **full** name for invoices, CSVs and client cards, and a **short** one for pills,
  Again-grid buttons and chart legends (the surname, or the business, or the first names).
  Without it, "Sylvia & Craig Gardner" would swallow a pill in the time log.
- **Existing clients are left alone.** Nothing is auto-split — opening one in the editor
  pre-fills the fields from its old single-line name for you to correct, and only saving
  applies it.
- **Pill colour:** each client can wear one of **20 colours** (ten hues, each in a light
  and a deep fill) wherever their name appears — the time log, expenses, the running bar,
  the Again grid. Every swatch is named, and the editor previews the actual pill with the
  colour's name beside it, so you never have to identify one by looking at it. Blank =
  the default neutral pill.
- **Invoice code:** the prefix on this client's invoice numbers. Built from the name —
  **every person's first initial, then the surname in full**: Larry and Linda Gies are
  `LLGIES`, Diana Baskins is `DBASKINS`, Grayson and Catherine MacArthur are
  `GCMACARTHUR`. A business uses its own name. Type your own to override it, and that
  choice is never overwritten. Nothing is ever auto-*saved* into the field — the code
  follows the name until you set one. Both the code and the client's colour show on
  their card in the Clients list.
- **Custom rates for this client:** inside the editor, expand *"Custom rates for this
  client"* to set a per-service rate that overrides the default **for this client only**.
  Example: everyone pays $30/hr for Deck cleanup, but Larry pays $35 — set it here and
  every new Larry + Deck-cleanup entry auto-uses $35. (Blank = use the service default.
  Overrides apply to **new** entries only.)
- **What you do for them:** each card lists the services you've actually logged for
  that client, biggest first, with hours. Derived from the time log, so it's never a
  list you have to keep up to date.
- Each client card shows their **unbilled** balance (money you've tracked but not yet
  invoiced) and a **Create invoice →** shortcut.
- **Deleting a client keeps their time entries** — those entries just become "General"
  so your billing history stays intact.

### Services

- **Add** a service with a name and default $/hr. Give it a **color** (used in the
  Timer swatches and the Reports donut).
- **Editing a rate only affects *future* timers.** Past entries keep the rate they were
  logged at — that's the rate-snapshot rule that keeps old invoices honest.
- **Can't delete a service that's in use** (it would orphan history). Services you've
  logged against show an entry count and a "can't delete" note. Delete is only offered
  for services with zero entries.

### Invoices

Where tracked time becomes money owed. Three parts: the **builder**, the **A/R summary**,
and the **list**.

**Building an invoice:**
1. **New invoice → pick a Client.** traction lists their **unbilled, finished** time
   entries (running timers are excluded) **and** their unbilled **billable expenses**.
2. Optionally set a **From / To** date range to narrow it down.
3. **Untick** any time or expense you don't want on this invoice. Watch the running total.
4. **Create invoice** → it opens the printable sheet.

**The invoice sheet** shows your business "from" block, the client "bill to" block, and
a table broken out **by day → by service**, with per-day subtotals, a **Materials &
charges** section, and a grand total — exactly the format a client expects.

- **Materials & charges** come from the billable **Expenses** you ticked in the builder.
  You can also add a quick **one-off charge** right on the invoice (the *+ Add charge*
  box) — it's saved as a billable expense too, so it still shows up in Reports.
- **Notes:** payment terms, a thank-you, your Venmo — printed at the bottom.
- **Status pills — draft → sent → paid:**
  - **draft** = built but not sent out yet.
  - **sent** = you've billed them; it counts toward **"Owed to you"** in the A/R summary.
  - **paid** = collected; stamps a **paid date** and locks the invoice.
- **Print / Save PDF:** hit the button, then in the print dialog choose "Save as PDF."
  The chrome/toolbar are hidden — only the clean sheet prints.
- **Delete** an invoice to **release** its entries back to unbilled (useful if you need
  to re-split — see the FAQ).

**A/R summary** (top of the list): three tiles — **Owed to you** (sent, unpaid),
**Draft** (built, not sent), **Collected** (paid). Your at-a-glance "who owes me money."

### Reports

Your analytics dashboard — the Toggl-style view of the business.

- **Date range:** *This week · This month · Last 30d · Last 90d · This year · All time ·
  Custom.*
- **Earnings / Hours toggle:** flip every chart between dollars and time.
- **Stat tiles:** Earned, Hours, Unbilled, and Avg rate for the range.
- **Earnings/Hours over time:** a bar chart that auto-buckets by **day** (short ranges),
  **week**, or **month** (long ranges). Hover any bar for the exact figure.
- **By service** & **By client** donuts: where your time/money actually goes. Hover a
  slice or legend row to highlight it.
- **Profit:** Income (earnings) − Overhead = Net profit. Billable materials are treated
  as reimbursed (a wash), so they don't cut your profit. Plus an **Expenses by category**
  donut for tax time.
- **Service breakdown table:** hours + earnings per service, with a total.

### Sending an invoice

- **↗ Share** (next to Print) renders the invoice as an **image** and hands it to your
  phone's share sheet — text it, email it, AirDrop it. An image previews inline in a
  message, where a PDF arrives as a file the client has to decide to open. On a browser
  with no share sheet the button saves the image instead.
- **The shared copy is always the same document**, whichever device you make it on. A
  phone and a laptop produce a byte-for-byte identical image. Your client might print it
  or forward it to a bookkeeper, so it should never change shape based on which screen
  you happened to be holding.
- **Print / Save PDF** is still there for a paper copy or a real PDF attachment.

> 💡 **There is no "desktop version" of an invoice.** It isn't a file — it's rebuilt from
> your data every time you open it, so it always fits the screen you're reading it on.
> Only sharing and printing freeze it, and those freeze it to one fixed format on purpose.

### What an invoice looks like

Black ink on white paper, monospaced and uppercase, ruled with hairlines — built to be
printed or PDF'd rather than admired on screen. There is no colour on the sheet at all,
so a black-and-white printer loses nothing. Each line item carries a **line-art glyph**
for its service (a sprout for gardening, shears for pruning, a nozzle for pressure
washing), and anything without one gets a neutral mark rather than a gap.

On a phone the line items stack into small cards — date, the work, then hours, rate and
amount on one line — because five monospaced columns cannot fit 390px without pushing
the amount off the edge. That's a **reading** layout only; printing and sharing always
use the full letter-width table.

### Settings

- **Logo** — appears at the top of every invoice. **Transparent PNGs are kept
  transparent**, so a cut-out logo sits on the invoice's white paper instead of in a
  black box. The preview sits on a checkerboard so you can tell at a glance whether the
  background really is transparent. Opaque images are still stored as JPEG, which is
  much smaller.
- **Invoice background** — the watermark printed faintly behind every invoice. A
  topographic map ships with the app, so there is always one; uploading only replaces
  it. It's drawn as a real image rather than a CSS background, so it prints and PDFs
  **without** the reader having to enable "background graphics". Portrait, page-shaped
  and mostly transparent works best.
- **Business details** — the invoice "from" block + currency symbol + payment terms.
  Invoice numbers aren't set here: they're `CODE-YYYYMMDD-NN`, built per client per day
  (set a client's code under **Clients**).
- **Show hours as** — `4h 30m` or `4.5h`, applied everywhere at once: the time log,
  invoices, reports and the duration boxes you type into. The same switch sits in
  **Reports** and on the **manual entry** form, so you can flip it without leaving what
  you're looking at. It only changes how time is *displayed* — never what an entry
  bills.
- **Data & backup:**
  - **⬇ Time entries (CSV)** — a spreadsheet of every entry (date, client, service,
    hours, rate, amount, invoice). Hand this to your accountant at tax time.
  - **⬇ Expenses (CSV)** — every expense (date, category, amount, billable?, client,
    invoice) for tax deductions.
  - **⬇ Full backup (JSON)** — a complete snapshot of everything. Keep it somewhere safe
    (Dropbox!).
  - **⬆ Restore backup** — load a JSON backup. **This replaces everything currently in
    traction**, so use it deliberately.
- **Danger zone → Reset all data** — wipes clients, services, entries, and invoices from
  this device *and* your synced copy. No undo.

---

## 4. Guarantees & behaviors worth knowing

These are the "traction won't let you shoot yourself in the foot" rules:

- **Rate snapshotting.** Every entry stores the rate it was logged at. Bump a service
  from $40 → $45 next season and **past entries and invoices don't change**.
- **Invoices are frozen records.** When you create an invoice, its line items are
  snapshotted. Editing or deleting the underlying entries afterward **cannot** change
  what a sent invoice says. An invoice is a historical document, not a live view.
- **Invoiced entries are locked.** Once an entry is on an invoice you can't edit or
  delete it (the buttons vanish, it shows an *invoiced* tag). To change it, delete the
  invoice first to release the entries.
- **No double-billing.** An entry can only be on one invoice; invoiced entries drop out
  of the "unbilled" pool automatically.
- **Deleting a client preserves history** (entries become "General"). Deleting an
  invoice releases its entries back to unbilled.
- **Offline-first.** traction works fully without signing in — data lives in the
  browser. Signing in adds cross-device sync on top.

---

## 5. Worked examples

### Example A — a day at Larry & Linda's (the classic)

You do two things for Larry on July 7th:

1. Timer → **Deck cleanup**, client **Larry & Linda**, rate auto-fills $30 → **Start**.
   Work 3h 47m → **Stop**.
2. Resume/Start → **Replanting**, Larry & Linda, $40 → **Start** → 4h → **Stop**.

When Larry wants his bill: **Invoices → New invoice → Larry & Linda → Create.** traction
produces:

```
Jul 7, 2026
  Deck cleanup    3h 47m   $30/hr   $113.50
  Replanting      4h 0m    $40/hr   $160.00
  Jul 7 subtotal  7h 47m            $273.50
  ─────────────────────────────────────────
  Total           7h 47m            $273.50
```

Print → Save as PDF → send. When he pays, open the invoice → **Paid**. Done.

### Example B — the Stein weekly cycle (your actual rhythm)

Stein pays in full each cycle, so:

1. **Track** hours all week against the Stein client (Timer + resume chips).
2. When they're ready to pay: **Invoices → New invoice → Stein → Create** (this grabs
   *all* their unbilled entries to date).
3. Mark it **Sent** when you hand it over, **Paid** when the money lands.
4. Those entries are now locked & collected. Start tracking the next week fresh — the
   next invoice will only pick up the new hours.

Repeat. Your **Reports → All time** and the **Collected** A/R tile keep the running story.

### Example C — a per-client rate

Maple St HOA negotiated $50/hr for pressure washing (your default is $55).
**Clients → Maple St HOA → ✎ → Custom rates → Pressure washing = 50 → Save.**
Now every new *Maple + Pressure washing* timer auto-bills at $50. Everyone else stays $55.

### Example D — materials & your own costs

Mid-job at Larry's you buy $120 of shrubs and pay a $20 dump fee, and you also fill up
$45 of gas for the truck.

1. **Expenses → Log an expense:** `Shrubs · 120 · Materials · Billable · Larry & Linda`,
   then `Dump fee · 20 · Fees · Billable · Larry & Linda`.
2. Log the gas as **Overhead** (no client): `Gas · 45 · Fuel · Overhead`.
3. When you invoice Larry, the $120 + $20 show up as tickable **expense candidates** —
   include them and they land under *Materials & charges* ($140 on top of labor). He
   reimburses them when he pays.
4. The $45 gas never touches Larry's bill. It shows in **Reports → Profit** as overhead,
   trimming your net profit and giving you a tax-deductible record.

### Example E — non-client / general work

Sharpening your own mower blades, or a quick favor with no client? Start a timer with
**Client = General (no client)**. It's tracked for your Reports but won't show up in any
client's invoice pool.

---

## 6. Sync, backups & data safety

- **Cross-device sync:** sign in with GitHub on both machines and traction keeps them in
  step. The little cloud indicator shows *syncing… / synced / sync failed*.
- **How conflicts resolve:** whole-document, newest-wins. When you switch to a tab,
  traction re-pulls the latest so your **laptop adopts newer work from the PC** instead
  of overwriting it. Practically: **don't edit the same data on both machines at the
  exact same time** and you'll never lose anything.
- **Belt & suspenders:** every so often hit **Settings → Full backup (JSON)** and drop it
  in Dropbox. It's your escape hatch and your tax-season archive.
- **Taxes:** **Settings → Time entries (CSV)** opens straight in Excel/Sheets.

---

## 7. FAQ & troubleshooting

**Q: How do I mark just *some* days as paid?**
Payment is tracked per **invoice**, not per day. Build an invoice containing exactly the
paid days (untick the rest in the builder), mark it **Paid**; put the remaining days on a
second invoice. See [Example B](#example-b--the-stein-weekly-cycle-your-actual-rhythm) for
the common "pay it all" case.

**Q: I put too many entries on an invoice. How do I fix it?**
Open the invoice → **Delete**. That releases all its entries back to unbilled. Rebuild it
correctly.

**Q: I changed a service's rate — did my old invoices change?**
No. Rates are snapshotted per entry and invoices are frozen. Rate changes only affect
*new* timers.

**Q: An entry won't let me edit or delete it.**
It's on an invoice (look for the *invoiced* tag). Delete that invoice to unlock it.

**Q: I forgot to stop a timer and it ran overnight.**
Open the entry (✎) and set the real **End** time — that stops it there. Or fix the
hours/minutes if it's already stopped. (traction also nudges you after 8 hours so this
is rare.)

**Q: My client is a couple — whose name do I put?**
Both. Fill in the first person, tap **+ Add another person**, fill in the second. If they
share a surname it reads as *Sylvia & Craig Gardner*; if they don't, both names show in
full. The client is both people, not a head of household with an appendage.

**Q: Can I see hours as 4.5 instead of 4h 30m?**
Yes — **Show hours as** in Settings, or the same toggle in Reports and on the manual
entry form. It's one app-wide setting, so everything reads the same way at once. The
live running clock stays as a stopwatch (`1:30:02`) — that one counts seconds.

**Q: How are invoices numbered?**
`CLIENTCODE-YYYYMMDD-NN` — e.g. Cathy's first invoice on Aug 25 2026 is
`CATHY-20260825-01`, the second that same day is `-02`, and the first one after midnight
is `CATHY-20260826-01`. The code comes from the client's **Invoice code** (Clients → ✎),
defaulting to their name. The builder shows the number before you create it.

**Q: Can I use it on my phone?**
Yes, and it's built for that — see [Using it on your phone](#8-using-it-on-your-phone).

**Q: Is my data private?**
Yes. Each signed-in user only sees their own data (enforced server-side). The "Nic Zone"
link on the sakhalteam homepage is just a convenience curtain — your login is the real
lock.

---

## 8. Using it on your phone

The phone is where traction actually gets used — you're standing in a yard, not sitting
at a desk. It's built as an installable app for exactly that.

### Install it to your home screen

**iPhone (Safari):** open `sakhalteam.github.io/traction/` → **Share** → **Add to Home
Screen**.
**Android (Chrome):** open the same link → **⋮** menu → **Install app** (or **Add to
Home screen**).

You get a real app icon, no browser chrome, and it launches straight to the timer.

### What's different on a phone

- **Bottom tab bar.** Timer, Expenses, Invoices, Clients sit within thumb reach;
  Services, Reports and Settings live behind **More**. A green dot on the Timer tab
  means a clock is running.
- **The running timer is always visible** as a bar above the tab bar, on every screen.
- **Everything is a big target.** Buttons are sized to be hit one-handed, in a hurry,
  with work gloves on.
- **Searchable pickers** instead of long scrolling dropdowns — see the Timer section.

### It works with no signal

traction saves to your device first and syncs to the cloud afterwards, so a backyard
with no bars is fine:

- The app **opens offline** once you've installed it.
- Time you log offline is kept locally and **pushed automatically the moment signal
  comes back** — you don't have to remember to do anything.
- If your phone and your PC both changed things while they were apart, traction
  **merges** them rather than picking a winner. You'll see *"merged with cloud"* in the
  header. Nothing you logged gets dropped for being a few seconds older than something
  else.

> ⚠️ The one thing merging can't recover is a **deletion**. If you delete an entry on
> your phone while it's offline and the PC syncs in the meantime, the deleted entry can
> come back. That's the deliberate trade: a row you have to delete twice is a nuisance,
> whereas quietly losing three hours of tracked work is money gone. Delete it again and
> it stays gone.

---

*Part of the [sakhalteam](https://sakhalteam.github.io/) galaxy. Built for getting paid
without the paperwork headache.* 🌿
