/**
 * Smoke test for measured material ("track by quantity"):
 *   node scripts/smoke-measured.mjs   (needs the dev server up)
 *
 * Walks the Crossbow case end to end: log a quart on the shelf, draw 2 fl oz
 * for one client, invoice it under its customer-facing name, and check the cost
 * never leaks onto the invoice while the margin does reach Reports. Then turns
 * quantity tracking on for something already on the shelf and pours an unused
 * piece back into its container.
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
    // A hand-mangled measure must hydrate into something countable, not NaN.
    { id: 'bad', clientId: null, label: 'Mangled', amount: 10, category: 'Materials',
      date: iso(now - 6 * DAY), billable: true, invoiceId: null, settled: null,
      note: '', receiptPath: null, createdAt: now - 6 * DAY,
      measure: { unit: 'scoop', qty: 'lots', holds: null, unitPrice: 'x', clientLabel: 7 } },
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


// ---- 1. A mangled measure hydrates safely --------------------------------
await page.locator('.tab', { hasText: 'Expenses' }).click()
await page.waitForTimeout(500)
const mangled = page.locator('.group-shelf li', { hasText: 'Mangled' })
check('A mangled measure renders as a countable container',
  (await mangled.locator('.measure-tag').innerText()).includes('0 of 1 scoop left'),
  await mangled.locator('.measure-tag').innerText())

// ---- 2. Log a quart of Crossbow, tracked by the fl oz ---------------------
const form = page.locator('.panel', { hasText: 'Log an expense' })
await form.locator('input[placeholder^="e.g. Mulch"]').fill('Crossbow 1qt')
await form.locator('input[placeholder="0.00"]').fill('36.49')
await form.locator('.check-field input').check()
await form.locator('input[placeholder="fl oz"]').fill('fl oz')
await form.locator('input[placeholder="32"]').fill('32')
await form.locator('input[placeholder="e.g. Herbicide treatment"]').fill('Herbicide treatment')
await page.waitForTimeout(200)
const priceBox = form.locator('.measure-fields input[step="0.01"]')
check('Price per unit starts at cost + 20%', (await priceBox.inputValue()) === '1.37', await priceBox.inputValue())
check('The form shows cost per unit', (await form.locator('.measure-fields').innerText()).includes('$1.14 per fl oz'))
await priceBox.fill('10')
await form.locator('button', { hasText: 'Log expense' }).click()
await page.waitForTimeout(400)

let s = await readState()
let jug = s.expenses.find(x => x.label === 'Crossbow 1qt')
check('The jug keeps what was PAID as its amount', jug?.amount === 36.49, String(jug?.amount))
check('The jug is a full container on the shelf',
  jug?.clientId === null && jug?.measure?.qty === 32 && jug?.measure?.holds === 32 && jug?.measure?.unitPrice === 10,
  JSON.stringify(jug?.measure))
const jugRow = page.locator('.group-shelf li', { hasText: 'Crossbow' })
check('The shelf row says how much is left',
  (await jugRow.locator('.measure-tag').innerText()).includes('32 of 32 fl oz left'))
check('A measured row offers no money split', (await jugRow.locator('.icon-btn', { hasText: '½' }).count()) === 0)

// ---- 3. Draw 2 fl oz for Patrick ------------------------------------------
await jugRow.locator('.icon-btn[title="Assign to a client"]').click()
await page.waitForTimeout(200)
const qtyBox = jugRow.locator('.qty-field input')
check('The amount box starts at the usual amount', (await qtyBox.inputValue()) === '1')
await qtyBox.fill('40')
check('More than is left cannot be drawn',
  await jugRow.locator('.settle-opts .chip', { hasText: 'Hale' }).isDisabled())
await qtyBox.fill('2')
await jugRow.locator('.settle-opts .chip', { hasText: 'Hale' }).click()
await page.waitForTimeout(400)

s = await readState()
jug = s.expenses.find(x => x.label === 'Crossbow 1qt' && x.clientId === null)
const dose = s.expenses.find(x => x.label === 'Crossbow 1qt' && x.clientId === 'c1')
check('The container is left with 30 fl oz', jug?.measure?.qty === 30, JSON.stringify(jug?.measure))
check("Patrick's piece holds 2 fl oz at the frozen price",
  dose?.measure?.qty === 2 && dose?.measure?.unitPrice === 10, JSON.stringify(dose?.measure))
check('The cost splits to the cent',
  dose?.amount === 2.28 && jug?.amount === 34.21 && Math.round((dose.amount + jug.amount) * 100) === 3649,
  `${dose?.amount} + ${jug?.amount}`)
check('Container and piece share a lineage', !!dose?.lineageId && dose.lineageId === jug?.lineageId)
check('Ready to bill counts what Patrick is charged, not the cost',
  (await page.locator('.ar-tile', { hasText: 'Ready to bill' }).innerText()).includes('$20.00'))
check('So does the ready-to-bill card header',
  (await page.locator('.group-billable .group-head').innerText()).includes('$20.00'))

// ---- 4. Invoice it --------------------------------------------------------
await page.locator('.tab', { hasText: 'Invoices' }).click()
await page.waitForTimeout(500)
await page.locator('.picker-trigger').first().click()
await page.waitForTimeout(300)
await page.locator('.picker-row', { hasText: 'Patrick' }).click()
await page.waitForTimeout(400)
const cands = (await page.locator('.candidate-list').allInnerTexts()).join(' ')
check('The builder offers it under its invoice name at the billed price',
  cands.includes('Herbicide treatment') && cands.includes('× 2') && cands.includes('$20.00'), cands.replace(/\s+/g, ' ').slice(0, 160))
await page.locator('button', { hasText: 'Create invoice' }).click()
await page.waitForTimeout(700)

s = await readState()
const inv = s.invoices[0]
const line = inv?.expensesSnapshot?.[0]
check('The invoice freezes name, count, price and total',
  line?.label === 'Herbicide treatment' && line?.qty === 2 && line?.unitPrice === 10 && line?.amount === 20,
  JSON.stringify(line))
const sheet = await page.locator('.invoice-sheet').innerText()
// The sheet uppercases through CSS, so match without caring about case. The
// line reads in the table's own columns: name, count, per-unit price, total.
check('The invoice prints × 2 @ $10.00 = $20.00',
  /herbicide treatment\n× 2\n\$10\.00\n\$20\.00/i.test(sheet), sheet.slice(0, 120))
check('What you paid never reaches the invoice',
  !/crossbow/i.test(sheet) && !sheet.includes('2.28') && !sheet.includes('36.49'))
check('Measured lines are not free-typed on the draft',
  (await page.locator('.invoice-expenses .expense-row.measured').count()) === 1)

// ---- 5. Reports counts the margin -----------------------------------------
await page.locator('.tab', { hasText: 'More' }).click()
await page.waitForTimeout(300)
await page.locator('.more-row', { hasText: 'Reports' }).click()
await page.waitForTimeout(600)
const profit = await page.locator('.panel', { hasText: 'Net profit' }).innerText()
check('Reports counts the $17.72 charged over cost as income',
  profit.includes('$17.72') && profit.includes('$77.72'), profit.replace(/\s+/g, ' ').slice(0, 200))

// ---- 6. Turn quantity tracking on for something already on the shelf -----
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
let bucket = s.expenses.find(x => x.id === 'z1')
check('An existing shelf item can switch to quantity tracking',
  bucket?.measure?.qty === 5 && bucket?.measure?.holds === 5 && bucket?.measure?.unitPrice === 36,
  JSON.stringify(bucket?.measure))

// Draw one roof for the Okonkwos by dragging it off the shelf.
await page.setViewportSize({ width: 1180, height: 900 })
await page.waitForTimeout(400)
await dragOnto(
  page.locator('.group-shelf li', { hasText: 'Zinc bucket' }).first(),
  page.locator('.group-billable .group-head'),
)
check('Dragging a container off the shelf asks how much',
  (await page.locator('.drop-dialog .qty-field').count()) === 1)
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
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
