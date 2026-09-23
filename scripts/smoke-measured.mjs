/**
 * Smoke test for measured material: node scripts/smoke-measured.mjs
 * (needs the dev server up).
 *
 * Walks Nic's Crossbow case end to end — a quart on the shelf, 2 fl oz drawn
 * for one client at a markup plus a service fee, invoiced under a name chosen
 * at assign time — and checks that the cost never reaches the invoice while the
 * margin and the fee both reach Reports. Then the no-fee path (sawzall blades,
 * billed per unit), a legacy container, and pouring unused units back in.
 */
import { chromium } from 'playwright-core'

const URL = 'http://localhost:5173/traction/'
const DAY = 86_400_000
const now = Date.now()
const iso = ms => {
  const d = new Date(ms)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const state = {
  clients: [
    { id: 'c1', name: 'Patrick Hale', email: '', phone: '', address: '', notes: '', rates: {}, archived: false, createdAt: now - 90 * DAY },
    { id: 'c2', name: 'Okonkwo residence', email: '', phone: '', address: '', notes: '', rates: {}, archived: false, createdAt: now - 90 * DAY },
  ],
  services: [
    { id: 's1', name: 'Herbicide application', defaultRate: 60, color: '#22c55e', archived: false, createdAt: now - 90 * DAY },
  ],
  entries: [
    { id: 'e1', clientId: 'c1', serviceId: 's1', note: 'hillside',
      date: iso(now - DAY), startedAt: now - DAY, seconds: 3600, runningSince: null,
      rate: 60, invoiceId: null, photoPaths: [], createdAt: now - DAY },
  ],
  expenses: [
    // Already on the shelf before quantity tracking existed.
    { id: 'z1', clientId: null, label: 'Zinc bucket', amount: 150, category: 'Materials',
      date: iso(now - 5 * DAY), billable: true, invoiceId: null, settled: null,
      note: '', receiptPath: null, createdAt: now - 5 * DAY },
    // Straight pass-through material: billed per unit, no fee.
    { id: 'b1', clientId: null, label: 'Pruning blades 5pk', amount: 45, category: 'Materials',
      date: iso(now - 4 * DAY), billable: true, invoiceId: null, settled: null,
      note: '', receiptPath: null, createdAt: now - 4 * DAY,
      measure: { unit: 'blade', holds: 5, qty: 5, clientLabel: 'Pruning blade', markupPct: 20, serviceFee: 0, usual: 1 } },
    // A container priced the OLD way, before markup/fee existed. $10/fl oz on a
    // jug costing $1.1403/fl oz must keep charging $10/fl oz after conversion.
    { id: 'g1', clientId: null, label: 'Legacy jug', amount: 36.49, category: 'Materials',
      date: iso(now - 7 * DAY), billable: true, invoiceId: null, settled: null,
      note: '', receiptPath: null, createdAt: now - 7 * DAY,
      measure: { unit: 'fl oz', holds: 32, qty: 32, clientLabel: 'Old treatment', unitPrice: 10, usual: 1 } },
    // A hand-mangled measure must hydrate into something countable, not NaN.
    { id: 'bad', clientId: null, label: 'Mangled', amount: 10, category: 'Materials',
      date: iso(now - 6 * DAY), billable: true, invoiceId: null, settled: null,
      note: '', receiptPath: null, createdAt: now - 6 * DAY,
      measure: { unit: 'scoop', qty: 'lots', holds: null, markupPct: 'x', clientLabel: 7 } },
  ],
  invoices: [],
  settings: {
    businessName: 'Sakhal Grounds', businessEmail: '', businessPhone: '', businessAddress: '',
    favorites: [], invoiceCounter: 1, currency: '$', netDays: 30, logoPath: null,
  },
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge' })
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|supabase|fetch/i.test(m.text())) errors.push(m.text()) })

await page.goto(URL)
await page.evaluate(s => localStorage.setItem('traction-state', JSON.stringify(s)), state)
await page.reload()
await page.waitForTimeout(600)

const readState = () => page.evaluate(() => JSON.parse(localStorage.getItem('traction-state')))

/**
 * Drag one element onto another using real pointer events.
 *
 * The app deliberately does not use HTML5 drag-and-drop (it never fires on
 * touch), so this has to move a pointer the way a hand would: press, move past
 * the slop threshold, travel, release.
 */
const dragOnto = async (from, to) => {
  // Measured, scrolled and fired in ONE in-page pass.
  //
  // Driving this with page.mouse does not work here: under Playwright's mobile
  // emulation its coordinates and document.elementFromPoint disagree, and its
  // scroll-into-view mid-gesture fires a pointercancel that legitimately aborts
  // the drag. Doing it in the page keeps the geometry self-consistent, and both
  // ends are brought on screen together first — a drop point below the fold
  // resolves to nothing at all.
  const fh = await from.elementHandle()
  const th = await to.elementHandle()
  const outcome = await page.evaluate(([f, t]) => {
    // The usable band is what neither the sticky header nor the fixed tab bar
    // covers. A drop landing under the chrome hit-tests to the chrome, which
    // belongs to no drop zone — the gesture then quietly does nothing.
    const vh = window.innerHeight
    const chrome = document.querySelector('.chrome')
    const tabbar = document.querySelector('.tabbar')
    const safeTop = chrome ? chrome.getBoundingClientRect().bottom : 0
    const barVisible = tabbar && getComputedStyle(tabbar).display !== 'none'
    const safeBottom = vh - (barVisible ? tabbar.getBoundingClientRect().height : 0)

    const boxes = () => [f.getBoundingClientRect(), t.getBoundingClientRect()]
    let [fr, tr] = boxes()
    const top = Math.min(fr.top, tr.top), bottom = Math.max(fr.bottom, tr.bottom)
    if (top < safeTop || bottom > safeBottom) {
      const wanted = (top + bottom) / 2 - (safeTop + safeBottom) / 2
      window.scrollTo({ top: window.scrollY + wanted, behavior: 'instant' })
      ;[fr, tr] = boxes()
    }
    const clear = r => r.top >= safeTop && r.bottom <= safeBottom
    if (!clear(fr) || !clear(tr)) return `both ends do not fit in the usable band (band ${Math.round(safeTop)}-${Math.round(safeBottom)}, from ${Math.round(fr.top)}-${Math.round(fr.bottom)}, to ${Math.round(tr.top)}-${Math.round(tr.bottom)})`

    const fx = fr.x + fr.width / 2, fy = fr.y + 12
    const tx = tr.x + tr.width / 2, ty = tr.y + tr.height / 2
    const grabbed = document.elementFromPoint(fx, fy)
    if (!grabbed) return 'nothing to grab'
    if (grabbed.closest('button, input, select, textarea, a')) return 'grab point is a control'

    const fire = (type, x, y, target) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
    }))
    fire('pointerdown', fx, fy, grabbed)
    fire('pointermove', fx, fy + 30, window)
    fire('pointermove', tx, ty, window)
    fire('pointerup', tx, ty, window)
    return 'ok'
  }, [fh, th])
  if (outcome !== 'ok') check(`drag could not be performed: ${outcome}`, false)
  await page.waitForTimeout(450)
}

// ---- 1. Legacy + mangled containers hydrate safely -----------------------
await page.locator('.tab', { hasText: 'Expenses' }).click()
await page.waitForTimeout(500)
let s = await readState()
const legacy = s.expenses.find(x => x.id === 'g1')
check('A legacy per-unit price converts to the markup that reproduces it',
  Math.abs(legacy.measure.markupPct - 777) < 0.5 && legacy.measure.serviceFee === 0,
  JSON.stringify(legacy.measure))
const mangled = page.locator('.group-shelf li', { hasText: 'Mangled' })
check('A mangled measure renders as a countable container',
  (await mangled.locator('.measure-tag').innerText()).includes('0 of 1 scoop left'),
  await mangled.locator('.measure-tag').innerText())

// ---- 2. Log a quart of Crossbow, tracked by the fl oz --------------------
const form = page.locator('.panel', { hasText: 'Log an expense' })
await form.locator('input[placeholder^="e.g. Mulch"]').fill('Crossbow 1qt')
await form.locator('input[placeholder="0.00"]').first().fill('36.49')
await form.locator('.check-field input').check()
await form.locator('input[placeholder="fl oz"]').fill('fl oz')
await form.locator('input[placeholder="32"]').fill('32')
await form.locator('input[placeholder="e.g. Herbicide treatment"]').fill('Herbicide treatment')
await page.waitForTimeout(200)
check('The container form shows cost per unit',
  (await form.locator('.measure-fields').innerText()).includes('$1.14 per fl oz'))
check('Markup defaults to 20% and is editable',
  (await form.locator('.measure-fields input[step="1"]').last().inputValue()) === '20')
await form.locator('button', { hasText: 'Log expense' }).click()
await page.waitForTimeout(400)

s = await readState()
let jug = s.expenses.find(x => x.label === 'Crossbow 1qt')
check('The jug keeps what was PAID as its amount', jug?.amount === 36.49, String(jug?.amount))
check('The jug is a full container carrying default terms',
  jug?.clientId === null && jug?.measure?.qty === 32 && jug?.measure?.markupPct === 20,
  JSON.stringify(jug?.measure))
const jugRow = page.locator('.group-shelf li', { hasText: 'Crossbow' })
check('The shelf row says how much is left',
  (await jugRow.locator('.measure-tag').innerText()).includes('32 of 32 fl oz left'))
check('A measured row offers no money split', (await jugRow.locator('.icon-btn', { hasText: '.' }).count()) === 0)

// ---- 3. Draw 2 fl oz for Patrick, priced for this job --------------------
await jugRow.locator('.icon-btn[title="Assign to a client"]').click()
await page.waitForTimeout(200)
const assign = jugRow.locator('.measure-assign')
const qtyBox = assign.locator('input[type="number"]').first()
check('The amount box starts at the usual amount', (await qtyBox.inputValue()) === '1')
await qtyBox.fill('40')
check('More than is left cannot be drawn',
  await jugRow.locator('.settle-opts .chip', { hasText: 'Hale' }).isDisabled())
await qtyBox.fill('2')
// Markup and fee are chosen HERE, per job, not on the container.
await assign.locator('input[step="1"]').last().fill('30')
await assign.locator('input[step="0.01"]').fill('7.04')
await page.waitForTimeout(200)
const quote = await assign.locator('.measure-quote').innerText()
check('The drawer quotes what the client pays and what it cost you',
  quote.includes('$10.00') && quote.includes('$2.28'), quote.replace(/\s+/g, ' '))
await jugRow.locator('.settle-opts .chip', { hasText: 'Hale' }).click()
await page.waitForTimeout(400)

s = await readState()
jug = s.expenses.find(x => x.label === 'Crossbow 1qt' && x.clientId === null)
const dose = s.expenses.find(x => x.label === 'Crossbow 1qt' && x.clientId === 'c1')
check('The container is left with 30 fl oz', jug?.measure?.qty === 30, JSON.stringify(jug?.measure))
check('The drawn piece freezes qty, markup and fee',
  dose?.measure?.qty === 2 && dose?.measure?.markupPct === 30 && dose?.measure?.serviceFee === 7.04,
  JSON.stringify(dose?.measure))
check('The container keeps its own defaults, unchanged by the job',
  jug?.measure?.markupPct === 20 && jug?.measure?.serviceFee === 0, JSON.stringify(jug?.measure))
check('The cost splits to the cent',
  dose?.amount === 2.28 && jug?.amount === 34.21 && Math.round((dose.amount + jug.amount) * 100) === 3649,
  String(dose?.amount) + ' + ' + String(jug?.amount))
check('Ready to bill counts what the client is charged, not the cost',
  (await page.locator('.ar-tile', { hasText: 'Ready to bill' }).innerText()).includes('$10.00'))

// ---- 4. The no-fee path: blades billed per unit --------------------------
const bladeRow = page.locator('.group-shelf li', { hasText: 'Pruning blades' })
await bladeRow.locator('.icon-btn[title="Assign to a client"]').click()
await page.waitForTimeout(200)
await bladeRow.locator('.measure-assign input[type="number"]').first().fill('2')
await page.waitForTimeout(150)
await bladeRow.locator('.settle-opts .chip', { hasText: 'Okonkwo' }).click()
await page.waitForTimeout(400)
s = await readState()
const blades = s.expenses.find(x => x.label === 'Pruning blades 5pk' && x.clientId === 'c2')
check('Blades cost $18 and carry no fee',
  blades?.amount === 18 && blades?.measure?.serviceFee === 0,
  JSON.stringify([blades?.amount, blades?.measure]))

// ---- 5. Invoice Patrick --------------------------------------------------
await page.locator('.tab', { hasText: 'Invoices' }).click()
await page.waitForTimeout(500)
await page.locator('.picker-trigger').first().click()
await page.waitForTimeout(300)
await page.locator('.picker-row', { hasText: 'Patrick' }).click()
await page.waitForTimeout(400)
const cands = (await page.locator('.candidate-list').allInnerTexts()).join(' ')
check('The builder shows the invoice name, the count and the billed price',
  cands.includes('Herbicide treatment') && cands.includes('2') && cands.includes('$10.00'),
  cands.replace(/\s+/g, ' ').slice(0, 150))
await page.locator('button', { hasText: 'Create invoice' }).click()
await page.waitForTimeout(700)

s = await readState()
const line = s.invoices[0]?.expensesSnapshot?.[0]
check('A fee-bundled line freezes name and total, and NO per-unit price',
  line?.label === 'Herbicide treatment' && line?.amount === 10
  && line?.qty === undefined && line?.unitPrice === undefined && line?.measured === true,
  JSON.stringify(line))
const sheet = await page.locator('.invoice-sheet').innerText()
check('The invoice prints one named line at $10.00',
  /herbicide treatment\s*\n\s*\$10\.00/i.test(sheet), sheet.replace(/\n/g, ' | ').slice(0, 140))
check('The bundled line never reveals the per-unit breakdown', !sheet.includes('× 2'))
check('What you paid never reaches the invoice',
  !/crossbow/i.test(sheet) && !sheet.includes('2.28') && !sheet.includes('36.49'))
check('You can still see the quantity in your own records',
  (await readState()).expenses.find(x => x.id === line.id)?.measure?.qty === 2)

// ---- 6. Reports splits margin from fees ----------------------------------
await page.locator('.tab', { hasText: 'More' }).click()
await page.waitForTimeout(300)
await page.locator('.more-row', { hasText: 'Reports' }).click()
await page.waitForTimeout(600)
const profit = await page.locator('.panel', { hasText: 'Net profit' }).innerText()
// Margin is 30% of the $2.28 dose (68c) plus 20% of the $18 of blades ($3.60).
// Both are assigned but not yet invoiced, which is the same moment "ready to
// bill" starts counting them — earned is earned.
check('Reports shows material margin and service fees separately',
  profit.includes('$4.28') && profit.includes('$7.04'), profit.replace(/\s+/g, ' ').slice(0, 220))
check('Income adds both on top of labour', profit.includes('$71.32'),
  profit.replace(/\s+/g, ' ').slice(0, 220))

// ---- 7. Turn quantity tracking on for something already on the shelf ----
await page.locator('.tab', { hasText: 'Expenses' }).click()
await page.waitForTimeout(500)
const zinc = page.locator('.group-shelf li', { hasText: 'Zinc bucket' })
await zinc.locator('.icon-btn[title="Edit"]').click()
await page.waitForTimeout(300)
const ed = page.locator('.entry-row.editing')
await ed.locator('.check-field input').check()
await ed.locator('input[placeholder="fl oz"]').fill('roof')
await ed.locator('input[placeholder="32"]').fill('5')
await ed.locator('input[placeholder="e.g. Herbicide treatment"]').fill('Roof zinc treatment')
await page.waitForTimeout(200)
await ed.locator('button', { hasText: 'Save' }).click()
await page.waitForTimeout(400)
s = await readState()
check('An existing shelf item can switch to quantity tracking',
  s.expenses.find(x => x.id === 'z1')?.measure?.qty === 5,
  JSON.stringify(s.expenses.find(x => x.id === 'z1')?.measure))

// Draw one roof for the Okonkwos by dragging it off the shelf.
await page.setViewportSize({ width: 1180, height: 900 })
await page.waitForTimeout(400)
await dragOnto(
  page.locator('.group-shelf li', { hasText: 'Zinc bucket' }).first(),
  page.locator('.group-billable .group-head'),
)
check('Dragging a container off the shelf asks how much, and at what price',
  (await page.locator('.drop-dialog .measure-assign').count()) === 1)
await page.locator('.drop-dialog .chip', { hasText: 'Okonkwo' }).click()
await page.waitForTimeout(400)
s = await readState()
check('One roof came off the bucket',
  s.expenses.find(x => x.id === 'z1')?.measure?.qty === 4
  && s.expenses.some(x => x.label === 'Zinc bucket' && x.clientId === 'c2' && x.measure?.qty === 1))

// It went unused: back to the shelf, then poured back in.
await dragOnto(
  page.locator('.group-billable li', { hasText: 'Zinc bucket' }).first(),
  page.locator('.group-shelf .group-head'),
)
await dragOnto(
  page.locator('.group-shelf li', { hasText: 'Zinc bucket' }).nth(1),
  page.locator('.group-shelf li', { hasText: 'Zinc bucket' }).nth(0),
)
check('Pouring back asks first',
  (await page.locator('.drop-dialog', { hasText: 'Pour it back in' }).count()) === 1)
await page.locator('.drop-dialog button', { hasText: 'Merge them' }).click()
await page.waitForTimeout(400)
s = await readState()
const live = s.expenses.filter(x => x.label === 'Zinc bucket' && !x.absorbedInto)
check('The bucket is whole again',
  live.length === 1 && live[0].measure?.qty === 5 && live[0].amount === 150,
  JSON.stringify(live.map(x => [x.amount, x.measure?.qty])))

check('No console errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
const failed = results.filter(r => !r.ok)
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed')
process.exit(failed.length ? 1 : 0)
