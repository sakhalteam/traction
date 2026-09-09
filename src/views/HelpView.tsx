import type { ReactNode } from 'react'
import { navIcon } from '../Chrome'
import type { View } from '../Chrome'

/**
 * Everything traction can do, on one page.
 *
 * Written as data rather than a wall of JSX so the contents strip builds
 * itself, and so a new feature is one entry rather than a hunt for the right
 * heading. Organised by TAB, because "where was that button" is the question
 * this page actually gets asked — not "what is this app for".
 */

/** A glyph you'd tap, shown the way it appears in the app. */
function Key({ children }: { children: ReactNode }) {
  return <kbd className="help-key">{children}</kbd>
}

interface HelpItem {
  title: string
  body: ReactNode
}

interface HelpSection {
  id: string
  /** The nav icon for the tab this describes, or null for the closing section. */
  tab: View | null
  title: string
  blurb: string
  items: HelpItem[]
}

const SECTIONS: HelpSection[] = [
  {
    id: 'timer', tab: 'timer', title: 'Timer',
    blurb: 'The home screen. Start the clock, and read back everything you have logged.',
    items: [
      {
        title: 'Start in one tap',
        body: <>The <strong>2×2 grid</strong> at the top holds the four jobs you did most
          recently. Tap one and the clock starts on the same service, client and rate —
          no pickers. Below it, chips hold pinned jobs and older recents.</>,
      },
      {
        title: 'Pin a job so it never ages out',
        body: <>Tap <Key>☆</Key> on any chip, or <strong>☆ Pin</strong> next to Start.
          Recency alone stops working once a week holds a dozen jobs — the thing you do
          every Tuesday falls off by Thursday.</>,
      },
      {
        title: 'The running timer follows you',
        body: <>Switch tabs and a slim green bar stays pinned to the bottom with the live
          clock and the running amount. <Key>■</Key> stops it; tapping the bar jumps back.
          Past <strong>8 hours</strong> you get a "still on the clock?" nudge.</>,
      },
      {
        title: 'Fix the times, including while it runs',
        body: <><Key>✎</Key> works on a running entry too — for when you started it twenty
          minutes late. <strong>Start and end are independent</strong>: moving one never
          drags the other, it just changes the duration. On a live entry the End is blank;
          leave it blank to keep running, or set a time to stop it there.</>,
      },
      {
        title: 'Log time you forgot to track',
        body: <><strong>+ Manual entry</strong> takes a date plus a start and end clock
          time. Typing a duration instead moves the end and leaves the start alone.
          Nothing can be set in the future.</>,
      },
      {
        title: 'Flat-price jobs',
        body: <>For the "I have $200, is that enough?" job. Put a <strong>flat price</strong> on
          a manual entry and it bills that number whatever the clock says — the invoice
          prints <strong>Flat rate</strong> instead of inventing an hourly one. The hours
          are still logged and still count as hours worked.</>,
      },
      {
        title: 'Continue a job',
        body: <><Key>▶</Key> on any past entry starts a <em>new</em> entry with the same
          details. It never reopens the old one, so a job split across lunch becomes two
          entries you can edit separately.</>,
      },
      {
        title: 'Job photos',
        body: <><Key>📷</Key> attaches before/after shots to an entry. They stay available
          even after invoicing — that's exactly when a client asks — and ride along on the
          invoice.</>,
      },
      {
        title: 'Ready to invoice',
        body: <>Any client with billable work sitting unbilled for <strong>3+ days</strong> surfaces
          here with the amount already totalled. <strong>Tap their name</strong> to open the
          row and see every entry behind that number.</>,
      },
      {
        title: 'Give hours away',
        body: <>Inside an opened row, <Key>✓</Key> on a single entry closes it out without
          invoicing — <em>gifted, traded, paid cash, written off, own place</em>. The hours
          stay in your log and still count as hours worked, but stop being money owed and
          are left out of earnings. A freebie is not income. Reports shows the running
          total you have given away.</>,
      },
      {
        title: 'Filter the log',
        body: <>Group by day with totals per day, and filter by client or by payment state
          (unbilled / settled / invoiced / paid).</>,
      },
    ],
  },
  {
    id: 'clients', tab: 'clients', title: 'Clients',
    blurb: 'Who you work for, what you charge them, and how they read on an invoice.',
    items: [
      {
        title: 'Names are First / Last / Business',
        body: <>Any one of them alone is enough — a business with no person
          (<em>FARTTOWN PIZZAS</em>), a first name with no surname (<em>Cathy</em>), or
          both, where the business is billed and the person becomes the invoice's
          <strong> Attn:</strong> line.</>,
      },
      {
        title: 'Couples',
        body: <><strong>+ Add another person</strong>, because a client is often genuinely two
          people. A shared surname collapses — <em>Sylvia &amp; Craig Gardner</em> — and
          different surnames spell out in full. They sort under the surname.</>,
      },
      {
        title: 'Two names get derived',
        body: <>A <strong>full</strong> name for invoices and cards, and a <strong>short</strong> one
          for pills, chips and chart legends. Without it a couple's name would swallow
          every control it sits in. The editor shows you both as you type.</>,
      },
      {
        title: 'Invoice code',
        body: <>Built from the name: every first initial, then the surname.
          Larry and Linda Gies are <strong>LLGIES</strong>; Diana Baskins is
          <strong> DBASKINS</strong>. Type your own to override it and it is never
          overwritten.</>,
      },
      {
        title: 'Pill colour',
        body: <>Twenty colours — ten hues, each in a light and a deep fill — for wherever
          the client's name appears. Every swatch is <strong>named</strong>, and the editor
          previews the real pill, so choosing never depends on seeing the colour.</>,
      },
      {
        title: 'Custom rates',
        body: <>Expand <em>Custom rates for this client</em> to override any service's rate for
          this client only. Blank means use the service default. Overrides apply to
          <strong> new</strong> entries — past ones keep the rate they were logged at.</>,
      },
      {
        title: 'What you do for them',
        body: <>Each card lists the services actually logged for that client, biggest
          first, with hours. Derived from the log, so it is never a list to maintain.</>,
      },
    ],
  },
  {
    id: 'services', tab: 'services', title: 'Services',
    blurb: 'The kinds of work you do. Global — never owned by a client.',
    items: [
      {
        title: 'Name, default rate, colour',
        body: <>The rate is copied onto each entry when you log it, so changing a service's
          rate later never rewrites old work or old invoices.</>,
      },
      {
        title: 'Icons on invoices',
        body: <>Each service gets a line-art glyph on the invoice, matched on its
          <strong> name</strong> — so renaming or recreating a service keeps its icon. Anything
          unrecognised gets a neutral mark rather than a gap.</>,
      },
      {
        title: 'Archive instead of delete',
        body: <>An archived service stays on old entries and invoices but drops out of the
          pickers. A service still in use cannot be deleted.</>,
      },
    ],
  },
  {
    id: 'expenses', tab: 'expenses', title: 'Expenses',
    blurb: 'Costs you incur. A billable one has four ways out, not one.',
    items: [
      {
        title: 'The four states',
        body: <><strong>Ready to bill</strong> — on a client, not yet invoiced, real money to
          recover. <strong>On the shelf</strong> — billable but no client yet, material you own.
          <strong> Settled</strong> — closed without an invoice. <strong>Overhead</strong> — never a
          client's cost, feeds profit in Reports.</>,
      },
      {
        title: 'The tiles open',
        body: <>The two tiles at the top show exactly which expenses make up each number,
          with actions on every row. They are open by default whenever they hold anything —
          History below only holds what has already been dealt with.</>,
      },
      {
        title: 'Settle without invoicing',
        body: <><Key>✓</Key> is the escape hatch for real life: they handed you cash at the
          door, you swapped it for concert tickets, you used the gravel at your own place,
          or you have given up on it. Pick a reason, add a note. <Key>↺</Key> reopens it.
          The amount and receipt stay in history.</>,
      },
      {
        title: 'Charge only part of it',
        body: <><Key>½</Key> splits an expense. Bought $77.04 of lumber and used half on a
          deck? Charge $38.52 and the invoice line reads
          <em> "LUMBER — $38.52 of $77.04 total, remainder unused"</em>, so a dispute answers
          itself. The other half goes to <strong>the shelf</strong> with no client — it is wood
          you own, not money that client owes.</>,
      },
      {
        title: 'Assign shelf material',
        body: <><Key>◎</Key> attaches a shelf expense to whoever ended up using it, which
          turns it back into money to recover.</>,
      },
      {
        title: 'Receipts',
        body: <>Attach a photo to any expense. Stored privately and available from the
          invoice, which is when a client is most likely to ask for proof.</>,
      },
    ],
  },
  {
    id: 'invoices', tab: 'invoices', title: 'Invoices',
    blurb: 'Turn tracked work into a document, and get it to the client.',
    items: [
      {
        title: 'Build one',
        body: <>Pick a client and traction gathers every unbilled entry and billable
          expense for them. Untick anything you do not want, optionally narrow the date
          range, and create it.</>,
      },
      {
        title: 'Already paid',
        body: <>For work settled outside traction — cash on the day, an old paper invoice.
          Creates a closed, paid invoice dated to when the work happened, so those hours
          stop showing as unbilled and land in the right month in Reports.</>,
      },
      {
        title: 'Numbering',
        body: <><strong>CODE-YYYYMMDD-NN</strong>, counting up per client per day and resetting
          at midnight. The builder shows you the number before you create it.</>,
      },
      {
        title: 'Send it',
        body: <><strong>Print / Save PDF</strong> for a paper copy or a real PDF.
          <Key>↗</Key> <strong>Share</strong> renders it as an image and hands it to your phone's
          share sheet — an image previews inline in a text message, where a PDF is a file
          the client has to decide to open.</>,
      },
      {
        title: 'The shared copy never changes shape',
        body: <>A phone and a laptop produce a byte-identical image. Your client might
          print it or forward it to a bookkeeper, so it must not depend on which screen
          made it. On <em>your</em> screen the invoice always fits the device you are reading
          it on.</>,
      },
      {
        title: 'One-off charges and notes',
        body: <>Add a charge directly on an invoice — it becomes a real billable expense so
          it still shows in Reports. Notes print at the bottom for payment terms or a
          thank you.</>,
      },
      {
        title: 'Status and money owed',
        body: <><strong>Draft → Sent → Paid.</strong> The list shows what is owed, what is still
          drafted and what you have collected, with sent-but-unpaid split by how far past
          its due date it is.</>,
      },
      {
        title: 'Invoiced work is locked',
        body: <>Once an entry or expense is on an invoice it cannot be edited or deleted,
          so a sent invoice's numbers can never drift. Delete the invoice to unlock them.</>,
      },
    ],
  },
  {
    id: 'reports', tab: 'reports', title: 'Reports',
    blurb: 'Where the hours and the money actually went.',
    items: [
      {
        title: 'Range and metric',
        body: <>This week, this month, last 30/90 days, this year, all time, or a custom
          range — shown as <strong>earnings</strong> or <strong>hours</strong>. The chart buckets by
          day, week or month automatically depending on how long the range is.</>,
      },
      {
        title: 'Breakdowns',
        body: <>Earnings by client, hours and earnings per service, and expenses by
          category for tax time.</>,
      },
      {
        title: 'Given away',
        body: <>Work you gifted, traded or wrote off is counted as hours worked but never
          as income, and called out separately — which is the whole reason those entries
          are settled rather than deleted.</>,
      },
    ],
  },
  {
    id: 'settings', tab: 'settings', title: 'Settings',
    blurb: 'Your business details, how things look, and your data.',
    items: [
      {
        title: 'Business details',
        body: <>The "from" block on every invoice: name, address, phone, email, currency
          symbol and payment terms. Each invoice freezes the terms in effect the day it is
          created, so changing them never makes an old invoice overdue.</>,
      },
      {
        title: 'Logo',
        body: <>Appears at the top of every invoice. <strong>Transparent PNGs stay
          transparent</strong>, so a cut-out logo sits on white paper instead of in a black
          box. The preview sits on a checkerboard so you can tell at a glance.</>,
      },
      {
        title: 'Invoice background',
        body: <>The watermark printed faintly behind every invoice. A topographic map ships
          with the app, so there is always one — uploading only replaces it. It prints and
          PDFs without the reader enabling "background graphics".</>,
      },
      {
        title: 'Show hours as',
        body: <><strong>4h 30m</strong> or <strong>4.5h</strong>, applied everywhere at once —
          the log, invoices, reports and the boxes you type into. The same switch sits in
          Reports and on the manual-entry form. Display only; it never changes what an
          entry bills.</>,
      },
      {
        title: 'Backups and exports',
        body: <><strong>Full backup (JSON)</strong> is a complete snapshot — keep one somewhere
          safe. CSV exports of time entries and expenses are for your accountant.
          <strong> Restore</strong> replaces everything currently in the app.</>,
      },
    ],
  },
  {
    id: 'good-to-know', tab: null, title: 'Good to know',
    blurb: 'Things that are true everywhere in the app.',
    items: [
      {
        title: 'Deleting takes two taps',
        body: <>Time entries and expenses ask <em>"Really delete?"</em> before they go. They
          represent money you spent and hours you worked, and nothing recovers them from
          inside the app.</>,
      },
      {
        title: 'It syncs across devices',
        body: <>Sign in and your data follows you between phone and desktop. If two devices
          both moved on, they are merged rather than one overwriting the other — new work
          on either side is always kept.</>,
      },
      {
        title: 'It works offline',
        body: <>Everything is stored on the device first and pushed when there is signal,
          so a yard with no bars still tracks time. Add it to your home screen to use it
          like an app.</>,
      },
      {
        title: 'The tab is in the URL',
        body: <>Each tab sets a hash, so a refresh lands you back where you were and the
          back button walks the tabs.</>,
      },
      {
        title: 'Invoices are frozen records',
        body: <>An invoice snapshots its lines when created. Editing or deleting the
          underlying work afterwards can never change what a sent invoice says.</>,
      },
    ],
  },
]

export function HelpView() {
  return (
    <div className="view help-view">
      <div className="panel">
        <h2>How to use traction</h2>
        <p className="hint">
          Everything the app does, grouped by the tab it lives on. Nothing here needs
          reading in order — jump to whatever you are trying to remember.
        </p>
        <nav className="help-toc">
          {SECTIONS.map(s => (
            <a key={s.id} className="chip" href={`#${s.id}`}
              onClick={e => {
                // The tab itself owns the hash, so a jump link must scroll rather
                // than navigate — otherwise it would look like a tab change.
                e.preventDefault()
                document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}>
              {s.title}
            </a>
          ))}
        </nav>
      </div>

      {SECTIONS.map(s => (
        <div key={s.id} id={s.id} className="panel help-section">
          <div className="help-head">
            {s.tab && <span className="help-icon">{navIcon(s.tab)}</span>}
            <div>
              <h3>{s.title}</h3>
              <p className="dim tiny">{s.blurb}</p>
            </div>
          </div>
          <dl className="help-list">
            {s.items.map(item => (
              <div key={item.title} className="help-item">
                <dt>{item.title}</dt>
                <dd>{item.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}
