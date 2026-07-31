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
   - [Timer](#timer) · [Log](#log) · [Clients](#clients) · [Services](#services) · [Invoices](#invoices) · [Reports](#reports) · [Settings](#settings)
4. [Guarantees & behaviors worth knowing](#4-guarantees--behaviors-worth-knowing)
5. [Worked examples](#5-worked-examples)
6. [Sync, backups & data safety](#6-sync-backups--data-safety)
7. [FAQ & troubleshooting](#7-faq--troubleshooting)

---

## 1. The mental model (read this first)

traction has exactly **four** things. Get these and everything else clicks.

| Thing | What it is | Example |
|-------|-----------|---------|
| **Client** | A person/household/HOA you bill. Optional — work can be "General". | *Larry & Linda*, *Maple St HOA* |
| **Service** | A reusable **type of work** with a default hourly rate. **Global** — never owned by a client. | *Deck cleanup* @ $30/hr, *Pressure washing* @ $55/hr |
| **Time entry** | One chunk of tracked work = `service + client + date + duration + rate + note`. The atom of everything. | *Jul 7 · Deck cleanup · Larry & Linda · 3h 47m · $30/hr* |
| **Invoice** | A frozen bundle of unbilled entries for one client, grouped by day → service. | *INV-0001 · Larry & Linda · $273.50* |

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

- **Start a timer:** pick a **Service**, optionally a **Client**, tweak the **Rate**
  if needed, add a **Note** (e.g. "south side rock wall"), hit **▶ Start timer**.
  Only one timer runs at a time — starting a new one auto-stops the previous.
- **Rate auto-fills** from the client's custom rate (if set) or the service default.
  The number shown as a placeholder is what you'll be billed at unless you type over it.
- **▶ Resume chips:** across the top are your recent *service + client* combos.
  One tap re-starts that exact job — no re-picking. Perfect for "back on Larry's deck."
- **Running card:** while a timer runs you get a big live clock + running dollar
  amount + **■ Stop**.
- **Quick-add:** the *+ New service* / *+ New client* boxes let you create either
  without leaving the Timer.
- **Today list:** everything logged today, with live totals (time + $) at the top.

> 💡 **Look at your browser tab.** While a timer runs, the tab title shows the live
> clock (`▶ 0:42:15 · traction`) so you never forget it's going. If a timer runs
> past **8 hours**, traction pops a *"still on the clock?"* nudge with a one-click Stop.

### Log

Every entry, grouped by date, newest first — your full history and manual-entry tool.

- **+ Manual entry:** forgot to run the timer? Add time by hand — service, client,
  date, **hours + minutes**, rate, note. Great for "I did 2 hours at the Stein place
  yesterday."
- **Filter by client** to see just one person's history.
- **Edit** (✎) any entry to fix the service, client, date, duration, or rate.
- **Delete** (✕) an entry you logged by mistake.
- **Locked entries:** once an entry is on an invoice it shows an **invoiced** tag and
  the edit/delete buttons disappear — see [guarantees](#4-guarantees--behaviors-worth-knowing).

### Clients

- **Add** a client with just a name (e.g. *Larry & Linda*); fill in phone, email,
  address, and notes by editing (✎).
- **Custom rates for this client:** inside the editor, expand *"Custom rates for this
  client"* to set a per-service rate that overrides the default **for this client only**.
  Example: everyone pays $30/hr for Deck cleanup, but Larry pays $35 — set it here and
  every new Larry + Deck-cleanup entry auto-uses $35. (Blank = use the service default.
  Overrides apply to **new** entries only.)
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
1. **New invoice → pick a Client.** traction lists all their **unbilled, finished**
   entries (running timers are excluded).
2. Optionally set a **From / To** date range to narrow it down.
3. **Untick** anything you don't want on this invoice. Watch the running total at the
   bottom.
4. **Create invoice** → it opens the printable sheet.

**The invoice sheet** shows your business "from" block, the client "bill to" block, and
a table broken out **by day → by service**, with per-day subtotals and a grand total —
exactly the format a client expects.

- **Materials & charges:** add non-time line items (mulch, dump fees, a flat charge)
  under *Materials & charges*. They're added on top of labor in the grand total.
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
- **Service breakdown table:** hours + earnings per service, with a total.

### Settings

- **Business details** — the invoice "from" block + currency symbol + your next
  invoice number.
- **Data & backup:**
  - **⬇ Time entries (CSV)** — a spreadsheet of every entry (date, client, service,
    hours, rate, amount, invoice). Hand this to your accountant at tax time.
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

### Example D — materials on an invoice

You planted $120 of shrubs for a client. Build their invoice as usual, then under
**Materials & charges** add `Shrubs — 120` and `Dump fee — 20`. The grand total becomes
labor + $140.

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
Open the entry in Log/Timer and edit the hours/minutes to the real duration. (traction
also nudges you after 8 hours so this is rare.)

**Q: Can I use it on my phone?**
Yes — it's a responsive web app. Add it to your home screen for one-tap access.

**Q: Is my data private?**
Yes. Each signed-in user only sees their own data (enforced server-side). The "Nic Zone"
link on the sakhalteam homepage is just a convenience curtain — your login is the real
lock.

---

*Part of the [sakhalteam](https://sakhalteam.github.io/) galaxy. Built for getting paid
without the paperwork headache.* 🌿
