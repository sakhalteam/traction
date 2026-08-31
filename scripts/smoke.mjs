/**
 * Functional smoke test against the running dev server: node scripts/smoke.mjs
 *
 * Covers the flows that changed, plus the invoice-creation path that used to
 * depend on React invoking a setState updater synchronously.
 */
import { chromium } from 'playwright-core'

const URL = 'http://localhost:5173/traction/'
const DAY = 86_400_000
const now = Date.now()
// Local calendar day, not UTC — the app bills on local dates.
const iso = ms => {
  const d = new Date(ms)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const state = {
  clients: [
    { id: 'c1', name: 'The Steins', email: '', phone: '206-555-0142', address: '', notes: '', rates: {}, archived: false, createdAt: now - 90 * DAY },
    { id: 'c2', name: 'Okonkwo residence', email: '', phone: '', address: '', notes: '', rates: {}, archived: false, createdAt: now - 90 * DAY },
  ],
  services: [
    { id: 's1', name: 'Mowing & edging', defaultRate: 65, color: '#22c55e', archived: false, createdAt: now - 90 * DAY },
    { id: 's2', name: 'Pressure washing', defaultRate: 85, color: '#0ea5e9', archived: false, createdAt: now - 90 * DAY },
  ],
  entries: [
    {
      id: 'e1', clientId: 'c1', serviceId: 's1', note: 'front strip',
      date: iso(now - 5 * DAY), startedAt: now - 5 * DAY, seconds: 7200, runningSince: null,
      rate: 65, invoiceId: null, photoPaths: [], createdAt: now - 5 * DAY,
    },
    {
      id: 'e2', clientId: 'c2', serviceId: 's2', note: 'driveway',
      date: iso(now - 2 * DAY), startedAt: now - 2 * DAY, seconds: 5400, runningSince: null,
      rate: 85, invoiceId: null, photoPaths: [], createdAt: now - 2 * DAY,
    },
    // Five distinct service+client pairings in total: four fill the Again grid
    // and the fifth is pushed down to the chip row, which the pinning tests need.
    {
      id: 'e3', clientId: 'c2', serviceId: 's1', note: 'side lawn',
      date: iso(now - DAY), startedAt: now - DAY, seconds: 3600, runningSince: null,
      rate: 65, invoiceId: null, photoPaths: [], createdAt: now - DAY,
    },
    {
      id: 'e4', clientId: 'c1', serviceId: 's2', note: 'back patio',
      date: iso(now - 4 * DAY), startedAt: now - 4 * DAY, seconds: 3600, runningSince: null,
      rate: 85, invoiceId: null, photoPaths: [], createdAt: now - 4 * DAY,
    },
    {
      id: 'e5', clientId: null, serviceId: 's1', note: 'own yard',
      date: iso(now - 6 * DAY), startedAt: now - 6 * DAY, seconds: 1800, runningSince: null,
      rate: 0, invoiceId: null, photoPaths: [], createdAt: now - 6 * DAY,
    },
    // Old, unbilled and rated, so it earns a "Ready to invoice" row. Reuses an
    // existing service+client pairing so it can't disturb the Again grid.
    {
      id: 'e6', clientId: 'c2', serviceId: 's2', note: 'gutters',
      date: iso(now - 10 * DAY), startedAt: now - 10 * DAY, seconds: 7200, runningSince: null,
      rate: 85, invoiceId: null, photoPaths: [], createdAt: now - 10 * DAY,
    },
  ],
  expenses: [
    // Two on a client and one unattributed, so every expense state has a case.
    { id: 'x1', clientId: 'c2', label: 'Mulch', amount: 40, category: 'Materials',
      date: iso(now - 3 * DAY), billable: true, invoiceId: null, settled: null,
      note: '', receiptPath: null, createdAt: now - 3 * DAY },
    { id: 'x2', clientId: 'c2', label: 'Lumber', amount: 77.04, category: 'Materials',
      date: iso(now - 2 * DAY), billable: true, invoiceId: null, settled: null,
      note: '', receiptPath: null, createdAt: now - 2 * DAY },
    { id: 'x3', clientId: null, label: 'Spare timber', amount: 25, category: 'Materials',
      date: iso(now - DAY), billable: true, invoiceId: null, settled: null,
      note: '', receiptPath: null, createdAt: now - DAY },
    { id: 'x4', clientId: null, label: 'Gas', amount: 60, category: 'Fuel',
      date: iso(now - DAY), billable: false, invoiceId: null, settled: null,
      note: '', receiptPath: null, createdAt: now - DAY },
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
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(URL)
await page.evaluate(s => localStorage.setItem('traction-state', JSON.stringify(s)), state)
await page.reload()
await page.waitForTimeout(600)

const readState = () => page.evaluate(() => JSON.parse(localStorage.getItem('traction-state')))

// ---- 1. Start a timer from the "Again" button ----------------------------
check('Again grid caps at four unique jobs',
  await page.locator('.again-btn').count() === 4, `got ${await page.locator('.again-btn').count()}`)
await page.locator('.again-btn').first().click()
await page.waitForTimeout(400)
check('Again starts a timer', await page.locator('.running-card').isVisible())

let s = await readState()
// The first grid slot is the most recently created job, e3 (s1 for c2).
check('Started entry carries the job details',
  s.entries.some(e => e.runningSince && e.serviceId === 's1' && e.clientId === 'c2' && e.rate === 65))

// ---- 2. The running bar follows you to another tab -----------------------
await page.locator('.tab', { hasText: 'Invoices' }).click()
await page.waitForTimeout(300)
check('Running bar shows on other tabs', await page.locator('.timer-bar').isVisible())
check('Timer tab shows a live dot', await page.locator('.tab-live').isVisible())

// ---- 3. Stop from the bar ------------------------------------------------
await page.locator('.timer-bar-stop').click()
await page.waitForTimeout(400)
check('Stop from the bar clears it', !(await page.locator('.timer-bar').isVisible()))
s = await readState()
check('Stopped entry kept its seconds', s.entries.every(e => e.runningSince === null))

// ---- 4. Create an invoice (exercises the createInvoice return value) -----
await page.locator('.picker-trigger').first().click()
await page.waitForTimeout(300)
await page.locator('.picker-row', { hasText: 'The Steins' }).click()
await page.waitForTimeout(400)
await page.locator('button', { hasText: 'Create invoice' }).click()
await page.waitForTimeout(600)

check('Invoice detail opens after creating', await page.locator('.invoice-sheet').isVisible(),
  'this is the regression that returned null before')
s = await readState()
check('Invoice was persisted', s.invoices.length === 1, `got ${s.invoices.length}`)
check('Invoice has a frozen snapshot', !!s.invoices[0]?.snapshot)
// Only the billed client's work is frozen; everyone else stays unbilled.
check('Billed entries were marked invoiced',
  s.entries.filter(e => e.clientId === 'c1').every(e => e.invoiceId === s.invoices[0]?.id))
check('Other clients were left unbilled',
  s.entries.filter(e => e.clientId === 'c2').every(e => e.invoiceId === null))
// Numbering is CODE-YYYYMMDD-NN, derived per client per day — no global counter.
const todayCompact = iso(Date.now()).replaceAll('-', '')
check('Invoice number uses the client + date convention',
  s.invoices[0]?.number === `TSTEINS-${todayCompact}-01`, `got ${s.invoices[0]?.number}`)

// ---- 5. Pin a job from the timer screen ----------------------------------
await page.locator('.tab', { hasText: 'Timer' }).click()
await page.waitForTimeout(400)
await page.locator('.chip-pin').first().click()
await page.waitForTimeout(400)
s = await readState()
check('Pinning writes a favourite', (s.settings.favorites ?? []).length === 1,
  JSON.stringify(s.settings.favorites))

await page.locator('.chip-pin.on').first().click()
await page.waitForTimeout(400)
s = await readState()
check('Unpinning removes it', (s.settings.favorites ?? []).length === 0)

// ---- 6. Picker search + create ------------------------------------------
await page.locator('.picker-trigger').nth(1).click()
await page.waitForTimeout(300)
await page.locator('.picker-sheet input').fill('Vasquez')
await page.waitForTimeout(300)
await page.locator('.picker-row.create').click()
await page.waitForTimeout(400)
s = await readState()
check('Picker creates a client inline', s.clients.some(c => c.name === 'Vasquez'))
check('New client is selected',
  (await page.locator('.picker-trigger').nth(1).innerText()).includes('Vasquez'))

// ---- 7. Start and end times are independent (the Toggl rule) -------------
/** Shift a 'YYYY-MM-DDTHH:mm' input value by whole minutes, staying local. */
const shiftLocal = (value, minutes) => {
  const d = new Date(value)
  d.setMinutes(d.getMinutes() + minutes)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

await page.locator('.entry-row', { hasText: 'driveway' }).locator('.icon-btn[title="Edit"]').click()
await page.waitForTimeout(300)
const editor = page.locator('.entry-editor')
const startIn = editor.locator('input[type="datetime-local"]').nth(0)
const endIn = editor.locator('input[type="datetime-local"]').nth(1)
const start0 = await startIn.inputValue()
const end0 = await endIn.inputValue()

const start1 = shiftLocal(start0, 15)
await startIn.fill(start1)
await page.waitForTimeout(250)
check('Moving the start leaves the end where it was',
  (await endIn.inputValue()) === end0, `end was ${end0}, now ${await endIn.inputValue()}`)

const end1 = shiftLocal(end0, 12)
await endIn.fill(end1)
await page.waitForTimeout(250)
check('Moving the end leaves the start where it was',
  (await startIn.inputValue()) === start1, `start was ${start1}, now ${await startIn.inputValue()}`)

await editor.locator('button', { hasText: 'Save' }).click()
await page.waitForTimeout(400)
s = await readState()
const edited = s.entries.find(e => e.id === 'e2')
// 5400s, start pushed 15m later (−900s), end pushed 12m later (+720s).
check('Saved duration reflects both edges', edited?.seconds === 5400 - 900 + 720,
  `got ${edited?.seconds}`)
check('Saved start matches what was typed',
  new Date(edited?.startedAt).getTime() === new Date(start1).getTime())

// ---- 8. A running entry can be re-timed without stopping ----------------
await page.locator('.again-btn').first().click()
await page.waitForTimeout(500)
await page.locator('.entry-row.live').locator('.icon-btn[title*="Edit"]').click()
await page.waitForTimeout(300)
const liveStart = editor.locator('input[type="datetime-local"]').nth(0)
const liveEnd = editor.locator('input[type="datetime-local"]').nth(1)
check('A running entry has no end time yet', (await liveEnd.inputValue()) === '')
const backdated = shiftLocal(await liveStart.inputValue(), -30)
await liveStart.fill(backdated)
await page.waitForTimeout(200)
await editor.locator('button', { hasText: 'Save' }).click()
await page.waitForTimeout(500)
s = await readState()
const live = s.entries.find(e => e.runningSince)
check('Backdating a live timer keeps it running', !!live)
check('Backdated start re-anchors the running span',
  live && live.runningSince === live.startedAt
    && new Date(live.startedAt).getTime() === new Date(backdated).getTime(),
  `startedAt ${live && new Date(live.startedAt).toISOString()}`)
check('Live entry still reads as running', await page.locator('.running-card').isVisible())

// ---- 9. Manual entry takes real start and end times ---------------------
await page.locator('.entry-row.live .icon-btn[title="Stop"]').click()
await page.waitForTimeout(400)
await page.locator('button', { hasText: '+ Manual entry' }).click()
await page.waitForTimeout(400)
const form = page.locator('.manual-form')
check('Manual entry offers start and end times',
  await form.locator('input[type="time"]').count() === 2)

await form.locator('.picker-trigger').first().click()
await page.waitForTimeout(300)
await page.locator('.picker-row', { hasText: 'Mowing & edging' }).click()
await page.waitForTimeout(300)
await form.locator('input[type="date"]').fill(iso(now - 3 * DAY))
await form.locator('input[type="time"]').nth(0).fill('07:15')
await form.locator('input[type="time"]').nth(1).fill('11:45')
await page.waitForTimeout(300)
check('Duration follows the typed times',
  (await form.locator('input[type="number"]').first().inputValue()) === '4',
  `hours field reads ${await form.locator('input[type="number"]').first().inputValue()}`)

await form.locator('button', { hasText: 'Add entry' }).click()
await page.waitForTimeout(500)
s = await readState()
const manual = s.entries.find(e => e.date === iso(now - 3 * DAY))
check('Manual entry stored a real start time',
  manual && new Date(manual.startedAt).getHours() === 7 && new Date(manual.startedAt).getMinutes() === 15,
  manual ? new Date(manual.startedAt).toString() : 'no entry')
check('Manual entry duration is end − start', manual?.seconds === 4.5 * 3600, `got ${manual?.seconds}`)

// ---- 10. Decimal-hours toggle is global ---------------------------------
await page.locator('.tab', { hasText: 'Timer' }).click()
await page.waitForTimeout(300)
await page.locator('button', { hasText: '+ Manual entry' }).click()
await page.waitForTimeout(300)
await page.locator('.duration-toggle button', { hasText: '4.5h' }).click()
await page.waitForTimeout(400)
s = await readState()
check('Toggle writes the app-wide setting', s.settings.durationFormat === 'decimal',
  `got ${s.settings.durationFormat}`)
// Assert the shape, not a count of every number box on the form — the form has
// gained fields since (a flat price) and a raw count silently went stale.
// innerText is the RENDERED text, which CSS uppercases — compare in one case.
const manualLabels = (await page.locator('.manual-form .field > span').allInnerTexts())
  .map(t => t.trim().toLowerCase())
check('Decimal mode collapses Hours and Minutes into one field',
  manualLabels.includes('hours') && !manualLabels.includes('minutes'),
  manualLabels.join(', '))

const dayHead = await page.locator('.panel-head h3', { hasText: '·' }).first().innerText()
check('Time log reads in decimal', /\d+(\.\d+)?h$/.test(dayHead.trim()), `header reads "${dayHead}"`)

await page.locator('.tab', { hasText: 'More' }).click()
await page.waitForTimeout(300)
await page.locator('.more-row', { hasText: 'Reports' }).click()
await page.waitForTimeout(600)
const hoursTile = await page.locator('.stat-tile', { hasText: 'Hours' }).innerText()
check('Reports reads in decimal too', /[0-9]+(\.[0-9]+)?h/.test(hoursTile), hoursTile.split(String.fromCharCode(10)).join(' '))
await page.locator('.duration-toggle button', { hasText: '4h 30m' }).click()
await page.waitForTimeout(400)
s = await readState()
check('Reports toggle flips it back', s.settings.durationFormat === 'hm')

// ---- 11. Client pill colours -------------------------------------------
await page.locator('.tab', { hasText: 'Clients' }).click()
await page.waitForTimeout(500)
await page.locator('.client-card', { hasText: 'The Steins' }).locator('.icon-btn').click()
await page.waitForTimeout(400)
check('Twenty colours plus a default are offered',
  await page.locator('.client-swatch').count() === 21,
  `got ${await page.locator('.client-swatch').count()}`)
await page.locator('.client-swatch[aria-label="Amber deep"]').click()
await page.waitForTimeout(300)
await page.locator('.client-editor button', { hasText: 'Save' }).click()
await page.waitForTimeout(400)
s = await readState()
check('Chosen colour is stored on the client',
  s.clients.find(c => c.id === 'c1')?.colorId === 'amber-deep',
  `got ${s.clients.find(c => c.id === 'c1')?.colorId}`)

await page.locator('.tab', { hasText: 'Timer' }).click()
await page.waitForTimeout(500)
const pill = page.locator('.entry-row', { hasText: 'front strip' }).locator('.client-tag').first()
const pillBg = await pill.evaluate(el => getComputedStyle(el).backgroundColor)
check('The pill actually wears it in the time log',
  pillBg.replace(/\s/g, '') === 'rgba(234,179,8,0.42)', `computed ${pillBg}`)

// ---- 12. Structured client names ---------------------------------------
await page.locator('.tab', { hasText: 'Clients' }).click()
await page.waitForTimeout(500)
await page.locator('.client-card', { hasText: 'The Steins' }).locator('.icon-btn').click()
await page.waitForTimeout(400)
const cEditor = page.locator('.client-editor')
check('A legacy name is split into the fields as a starting point',
  (await cEditor.locator('input').nth(0).inputValue()) === 'The'
    && (await cEditor.locator('input').nth(1).inputValue()) === 'Steins',
  `got "${await cEditor.locator('input').nth(0).inputValue()}" / "${await cEditor.locator('input').nth(1).inputValue()}"`)

// Turn them into a couple: Sylvia & Craig Gardner.
await cEditor.locator('input').nth(0).fill('Sylvia')
await cEditor.locator('input').nth(1).fill('Gardner')
await cEditor.locator('button', { hasText: '+ Add another person' }).click()
await page.waitForTimeout(300)
await cEditor.locator('.person-row').nth(1).locator('input').nth(0).fill('Craig')
await cEditor.locator('.person-row').nth(1).locator('input').nth(1).fill('Gardner')
await page.waitForTimeout(300)
await cEditor.locator('button', { hasText: 'Save' }).click()
await page.waitForTimeout(500)
s = await readState()
const couple = s.clients.find(c => c.id === 'c1')
check('Both people are stored, not one head of household',
  couple?.people?.length === 2 && couple.people[1].first === 'Craig', JSON.stringify(couple?.people))
check('A shared surname collapses on the card',
  (await page.locator('.client-card', { hasText: 'Gardner' }).locator('.client-name-pill').innerText())
    .trim() === 'Sylvia & Craig Gardner',
  await page.locator('.client-card', { hasText: 'Gardner' }).locator('.client-name-pill').innerText())
check('The legacy name field mirrors the derived full name',
  couple?.name === 'Sylvia & Craig Gardner', `got ${couple?.name}`)
// Initials + surname: Sylvia and Craig Gardner are SCGARDNER, not GARDNER.
check('The card shows the derived invoice code',
  (await page.locator('.client-card', { hasText: 'Gardner' }).locator('.inv-code-tag').innerText()) === 'SCGARDNER',
  await page.locator('.client-card', { hasText: 'Gardner' }).locator('.inv-code-tag').innerText())

await page.locator('.tab', { hasText: 'Timer' }).click()
await page.waitForTimeout(500)
check('Pills use the short name, not the full one',
  (await page.locator('.entry-row', { hasText: 'front strip' }).locator('.client-tag').first().innerText()) === 'Gardner',
  await page.locator('.entry-row', { hasText: 'front strip' }).locator('.client-tag').first().innerText())

// ---- 13. A business-only client ----------------------------------------
await page.locator('.tab', { hasText: 'Clients' }).click()
await page.waitForTimeout(400)
await page.locator('.quick-row input').fill('placeholder')
await page.locator('button', { hasText: 'Add client' }).click()
await page.waitForTimeout(400)
await page.locator('.client-card', { hasText: 'placeholder' }).locator('.icon-btn').click()
await page.waitForTimeout(400)
await cEditor.locator('.person-row').nth(0).locator('input').nth(0).fill('')
await cEditor.locator('.person-row').nth(0).locator('input').nth(1).fill('')
await cEditor.locator('input[placeholder="e.g. FARTTOWN PIZZAS"]').fill('FARTTOWN PIZZAS')
await page.waitForTimeout(300)
await cEditor.locator('button', { hasText: 'Save' }).click()
await page.waitForTimeout(500)
s = await readState()
const biz = s.clients.find(c => c.business === 'FARTTOWN PIZZAS')
check('A business with no person is a valid client', !!biz && biz.name === 'FARTTOWN PIZZAS',
  JSON.stringify({ name: biz?.name, business: biz?.business }))

// ---- 14. Ready-to-invoice rows open up ---------------------------------
await page.locator('.tab', { hasText: 'Timer' }).click()
await page.waitForTimeout(600)
// e5 is 6 days old and unbilled, so it earns a nudge row.
check('A nudge row starts collapsed', await page.locator('.nudge-entries').count() === 0)
await page.locator('.nudge-who').first().click()
await page.waitForTimeout(400)
check('Clicking a nudge shows the hours behind it',
  await page.locator('.nudge-entries li').count() > 0,
  `${await page.locator('.nudge-entries li').count()} rows`)
await page.locator('.nudge-who').first().click()
await page.waitForTimeout(400)
check('Clicking it again collapses it', await page.locator('.nudge-entries').count() === 0)

// ---- 15. The adjust-end buttons are one row, not a 2x2 -----------------
// .nudge-row used to be shared with the invoice nudge, whose grid stacked them.
await page.locator('.entry-row .icon-btn[title="Edit"]').first().click()
await page.waitForTimeout(400)
const btnRow = await page.locator('.nudge-btns').boundingBox()
const oneBtn = await page.locator('.nudge-btns .btn').first().boundingBox()
check('Adjust-end stays on a single row', btnRow.height < oneBtn.height * 1.6,
  `row ${Math.round(btnRow.height)}px vs button ${Math.round(oneBtn.height)}px`)

// ---- 16. A transparent logo survives upload processing -----------------
// Runs the REAL downscale() out of the dev server, on a PNG with genuine
// alpha. JPEG has no alpha channel, so encoding one as JPEG turns every clear
// pixel black -- burned into the stored file, unfixable at render time.
const logo = await page.evaluate(async () => {
  const mod = await import('/traction/src/receipts.ts')
  const make = () => new Promise(res => {
    const c = document.createElement('canvas')
    c.width = 60; c.height = 60
    const x = c.getContext('2d')
    x.fillStyle = '#ff0000'
    x.fillRect(0, 0, 30, 30)          // one opaque quadrant; the rest stays clear
    c.toBlob(b => res(new File([b], 'logo.png', { type: 'image/png' })), 'image/png')
  })
  const file = await make()

  const kept = await mod.downscale(file, { preserveAlpha: true })
  const flat = await mod.downscale(file)                     // receipts/job photos

  // Decode what would actually be stored and read the corner that was clear.
  const img = await new Promise((res, rej) => {
    const i = new Image()
    i.onload = () => res(i); i.onerror = rej
    i.src = URL.createObjectURL(kept.blob)
  })
  const c2 = document.createElement('canvas')
  c2.width = img.width; c2.height = img.height
  const x2 = c2.getContext('2d')
  x2.drawImage(img, 0, 0)
  const clear = x2.getImageData(img.width - 1, img.height - 1, 1, 1).data
  const solid = x2.getImageData(1, 1, 1, 1).data

  // An opaque source must NOT be upgraded to PNG just because we asked.
  const opaqueFile = await new Promise(res => {
    const c = document.createElement('canvas')
    c.width = 20; c.height = 20
    const x = c.getContext('2d')
    x.fillStyle = '#00ff00'; x.fillRect(0, 0, 20, 20)
    c.toBlob(b => res(new File([b], 'flat.png', { type: 'image/png' })), 'image/png')
  })
  const opaque = await mod.downscale(opaqueFile, { preserveAlpha: true })

  return {
    keptType: kept.contentType, keptExt: kept.ext,
    flatType: flat.contentType, flatExt: flat.ext,
    clearAlpha: clear[3], solidAlpha: solid[3], solidRed: solid[0],
    opaqueType: opaque.contentType,
  }
})

check('A transparent logo is stored as PNG', logo.keptType === 'image/png' && logo.keptExt === 'png',
  `${logo.keptType} / .${logo.keptExt}`)
check('Its transparent pixels stay transparent', logo.clearAlpha === 0,
  `corner alpha ${logo.clearAlpha} (255 = the old black box)`)
check('Its opaque pixels are untouched', logo.solidAlpha === 255 && logo.solidRed > 200,
  `rgba alpha ${logo.solidAlpha}, red ${logo.solidRed}`)
check('An opaque PNG is not needlessly upgraded', logo.opaqueType === 'image/jpeg', logo.opaqueType)
check('Receipts and job photos stay JPEG', logo.flatType === 'image/jpeg' && logo.flatExt === 'jpg',
  `${logo.flatType} / .${logo.flatExt}`)

// ---- 17. Invoice sheet: watermark, icons, black ink --------------------
await page.locator('.tab', { hasText: 'Invoices' }).click()
await page.waitForTimeout(600)
await page.locator('.invoice-row').first().click()
await page.waitForTimeout(800)

const bg = page.locator('.invoice-sheet .invoice-bg')
check('Every invoice gets a background', await bg.count() === 1)
check('With no upload it uses the bundled default',
  /invoice-bg.*\.png/.test(await bg.getAttribute('src') ?? ''), await bg.getAttribute('src'))
// An <img>, not a CSS background-image: browsers omit background images from
// print unless the reader enables them, which an invoice cannot depend on.
check('The watermark is a real <img> so it prints',
  (await bg.evaluate(el => el.tagName)) === 'IMG')
check('Line items carry a service glyph',
  await page.locator('.invoice-table .svc-glyph').count() > 0,
  `${await page.locator('.invoice-table .svc-glyph').count()} glyphs`)

// Black ink on white paper — no theme colour may leak onto the printable sheet.
const ink = await page.evaluate(() => {
  const rgb = (el) => getComputedStyle(el).color
  const sheet = document.querySelector('.invoice-sheet')
  return {
    paper: getComputedStyle(sheet).backgroundColor,
    total: rgb(document.querySelector('.grand-total td')),
    heading: rgb(document.querySelector('.invoice-meta h1')),
    mono: getComputedStyle(sheet).fontFamily.toLowerCase(),
  }
})
check('Paper is white', ink.paper === 'rgb(255, 255, 255)', ink.paper)
check('The total is pure black', ink.total === 'rgb(0, 0, 0)', ink.total)
check('The heading is pure black', ink.heading === 'rgb(0, 0, 0)', ink.heading)
check('The sheet is monospaced', /mono/.test(ink.mono), ink.mono.slice(0, 40))

// ---- 18. The invoice fits a phone ---------------------------------------
// Five mono columns overflowed 390px and dropped RATE and AMOUNT off the edge.
const fit = await page.evaluate(() => {
  const t = document.querySelector('.invoice-table')
  const amount = document.querySelector('.grand-total td:last-child')
  return {
    pageOver: document.documentElement.scrollWidth > window.innerWidth,
    tableOver: t.scrollWidth > t.clientWidth + 1,
    amountVisible: amount.getBoundingClientRect().right <= window.innerWidth + 1,
  }
})
check('The invoice does not overflow a phone', !fit.pageOver && !fit.tableOver,
  `page:${fit.pageOver} table:${fit.tableOver}`)
check('The total amount is on screen, not clipped off the edge', fit.amountVisible)

// ---- 19. The shared copy is device-independent ---------------------------
// The whole point: a client's copy must not change shape depending on which
// screen produced it, so this renders at letter width from a 390px viewport.
const png = await page.evaluate(async () => {
  const { elementToPng } = await import('/traction/src/share.ts')
  const blob = await elementToPng(document.querySelector('.invoice-sheet'))
  const img = await createImageBitmap(blob)
  const c = new OffscreenCanvas(img.width, img.height)
  const x = c.getContext('2d')
  x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, img.width, img.height).data
  let ink = 0
  for (let i = 0; i < d.length; i += 4 * 53) if (d[i] < 100) ink++
  // The bottom eighth should be near-empty; a mis-measured height padded the
  // image with a slab of white below the total.
  const tail = x.getImageData(0, Math.floor(img.height * 0.88), img.width, Math.floor(img.height * 0.12)).data
  let tailInk = 0
  for (let i = 0; i < tail.length; i += 4 * 53) if (tail[i] < 100) tailInk++
  return { w: img.width, h: img.height, kb: Math.round(blob.size / 1024), ink, tailInk }
})
check('Shares at letter width regardless of viewport', png.w === 1632,
  `${png.w}x${png.h} from a 390px screen`)
check('The image has real content, not a blank canvas', png.ink > 100, `${png.ink} dark samples`)
check('No dead space padding the bottom', png.tailInk < png.ink / 8,
  `tail ${png.tailInk} vs total ${png.ink}`)
check('Shared image is a sane size to text', png.kb < 1500, `${png.kb}KB`)

// ---- 20. Expenses: an expense has more than one way to close ------------
await page.locator('.tab', { hasText: 'Expenses' }).click()
await page.waitForTimeout(600)

check('Open work is split from the shelf',
  (await page.locator('.tile-btn').count()) === 2)

// REGRESSION: History holds only what has been dealt with, so on a day when
// every expense is still open the tab looked empty and read as data loss.
// Open work must be visible without anyone having to tap a tile.
check('Open expenses are visible without tapping anything',
  (await page.locator('.open-expenses li').count()) === 3,
  `${await page.locator('.open-expenses li').count()} rows on arrival`)
const seeded = await readState()
const openSeeded = seeded.expenses.filter(x => x.billable && !x.invoiceId && !x.settled)
const listed = (await page.locator('.open-expenses li').count())
  + (await page.locator('.panel').filter({ hasText: 'History' }).locator('.entry-list li').count())
check('Every expense is on screen somewhere, none hidden',
  listed === seeded.expenses.length,
  `${listed} shown of ${seeded.expenses.length} (${openSeeded.length} open)`)

// Each tile still toggles, and independently of the other.
await page.locator('.tile-btn').first().click()
await page.waitForTimeout(400)
check('Collapsing one tile leaves the other alone',
  (await page.locator('.open-expenses li', { hasText: 'Mulch' }).count()) === 0
    && (await page.locator('.open-expenses li', { hasText: 'Spare timber' }).count()) === 1)
await page.locator('.tile-btn').first().click()
await page.waitForTimeout(400)
check('And opens again', (await page.locator('.open-expenses li').count()) === 3)

// Settle one without ever invoicing it — the "traded it / they handed me cash"
// case that previously had no exit but deleting the record.
await page.locator('.open-expenses li', { hasText: 'Mulch' })
  .locator('.icon-btn[title="Settle without invoicing"]').click()
await page.waitForTimeout(400)
await page.locator('.row-drawer .chip', { hasText: 'Traded' }).click()
await page.locator('.row-drawer input').fill('swapped for concert tickets')
await page.locator('.row-drawer button', { hasText: 'Settle' }).click()
await page.waitForTimeout(500)
s = await readState()
const settled = s.expenses.find(x => x.label === 'Mulch')
check('Settling records how and why',
  settled?.settled?.how === 'trade' && settled.settled.note === 'swapped for concert tickets',
  JSON.stringify(settled?.settled))
check('The amount is left intact, not zeroed', settled?.amount === 40)
check('It leaves the open lists entirely',
  (await page.locator('.open-expenses li', { hasText: 'Mulch' }).count()) === 0,
  `${await page.locator('.open-expenses li').count()} open rows left`)

// Split: charge for half the lumber, shelve the offcut.
await page.locator('.open-expenses li', { hasText: 'Lumber' })
  .locator('.icon-btn[title="Charge only part of this"]').click()
await page.waitForTimeout(400)
await page.locator('.row-drawer input[type="number"]').fill('38.52')
await page.locator('.row-drawer button', { hasText: 'Split' }).click()
await page.waitForTimeout(500)
s = await readState()
const lumber = s.expenses.filter(x => x.label === 'Lumber')
check('Splitting makes two expenses', lumber.length === 2, `${lumber.length}`)
const billedHalf = lumber.find(x => x.clientId)
const offcut = lumber.find(x => !x.clientId)
check('The billed half keeps the client and the money adds up',
  billedHalf?.amount === 38.52 && offcut?.amount === 38.52,
  `${billedHalf?.amount} + ${offcut?.amount} of 77.04`)
check('The remainder goes to the shelf, not back on the client',
  offcut?.clientId === null && offcut?.billable === true && !offcut?.settled)
check('The billed half explains itself on the invoice',
  /[$]38\.52 of [$]77\.04/.test(billedHalf?.note ?? ''), billedHalf?.note)

// The shelf now holds the original spare plus the offcut, and it was already
// open — no tapping needed to see material you own.
s = await readState()
const onShelf = s.expenses.filter(x => x.billable && !x.clientId && !x.invoiceId && !x.settled)
check('The shelf holds the spare and the offcut', onShelf.length === 2,
  onShelf.map(x => x.label).join(', '))
check('Both open lists show at once',
  (await page.locator('.open-expenses li').count()) === 3,
  `${await page.locator('.open-expenses li').count()} rows across both groups`)

// Assign a shelf item to whoever ended up using it.
await page.locator('.open-expenses li', { hasText: 'Spare timber' })
  .locator('.icon-btn[title="Assign to a client"]').click()
await page.waitForTimeout(400)
await page.locator('.row-drawer .chip').first().click()
await page.waitForTimeout(500)
s = await readState()
const spare = s.expenses.find(x => x.label === 'Spare timber')
check('Assigning a shelf item gives it a client', !!spare?.clientId, String(spare?.clientId))

// A settled expense must never be offered for billing again.
await page.locator('.tab', { hasText: 'Invoices' }).click()
await page.waitForTimeout(600)
await page.locator('.picker-trigger').first().click()
await page.waitForTimeout(400)
await page.locator('.picker-row', { hasText: 'Okonkwo' }).click()
await page.waitForTimeout(600)
const offered = await page.locator('.candidate-list').allInnerTexts()
check('A settled expense is not offered as an invoice candidate',
  !offered.join(' ').includes('Mulch'), offered.join(' ').slice(0, 90))
check('An unsettled one still is', offered.join(' ').includes('Lumber'))

// ---- 21. Destructive actions take two taps ------------------------------
// A real loss: an expense and 1.86h of logged work were deleted by single
// mistaps on a ✕ sitting one icon away from Settle. Money records must not be
// one thumb-width from gone.
await page.locator('.tab', { hasText: 'Expenses' }).click()
await page.waitForTimeout(600)
const expensesBefore = (await readState()).expenses.length
await page.locator('.open-expenses li').first().locator('.icon-btn.danger').click()
await page.waitForTimeout(400)
check('One tap on an expense ✕ deletes nothing',
  (await readState()).expenses.length === expensesBefore)
check('It arms a confirm instead',
  (await page.locator('.confirm-del').count()) === 1)
await page.locator('.confirm-del').click()
await page.waitForTimeout(400)
check('The second tap deletes',
  (await readState()).expenses.length === expensesBefore - 1)

await page.locator('.tab', { hasText: 'Timer' }).click()
await page.waitForTimeout(600)
const entriesBefore = (await readState()).entries.length
await page.locator('.entry-row .icon-btn.danger[title="Delete"]').first().click()
await page.waitForTimeout(400)
check('One tap on an entry ✕ deletes nothing',
  (await readState()).entries.length === entriesBefore)
await page.locator('.confirm-del').first().click()
await page.waitForTimeout(400)
check('The second tap deletes the entry',
  (await readState()).entries.length === entriesBefore - 1)

// ---- 22. The tab lives in the URL --------------------------------------
await page.locator('.tab', { hasText: 'Expenses' }).click()
await page.waitForTimeout(400)
check('The tab is mirrored into the hash',
  (await page.evaluate(() => location.hash)) === '#expenses',
  await page.evaluate(() => location.hash))
await page.reload()
await page.waitForTimeout(900)
check('A refresh lands back on the same tab',
  (await page.locator('.tab.active').innerText()).includes('Expenses'),
  await page.locator('.tab.active').innerText())
await page.goBack()
await page.waitForTimeout(600)
check('Back walks the tabs', !(await page.locator('.tab.active').innerText()).includes('Expenses'))
await page.evaluate(() => { location.hash = 'nonsense' })
await page.waitForTimeout(400)
check('A junk hash is ignored, not rendered',
  (await page.locator('.view').count()) > 0)

// ---- 23. Flat-rate work -------------------------------------------------
// "I have $200, is that enough?" — the money was agreed as a number, so hours
// stop deciding it, but the job still belongs in the log.
await page.locator('.tab', { hasText: 'Timer' }).click()
await page.waitForTimeout(600)
await page.locator('button', { hasText: '+ Manual entry' }).click()
await page.waitForTimeout(400)
const mf = page.locator('.manual-form')
await mf.locator('.picker-trigger').first().click()
await page.waitForTimeout(300)
await page.locator('.picker-row', { hasText: 'Mowing & edging' }).click()
await page.waitForTimeout(300)
await mf.locator('.picker-trigger').nth(1).click()
await page.waitForTimeout(300)
await page.locator('.picker-row', { hasText: 'Vasquez' }).click()
await page.waitForTimeout(300)
await mf.locator('input[placeholder="hourly"]').fill('200')
await page.waitForTimeout(300)
check('Setting a flat price disables the hourly rate',
  await mf.locator('input[placeholder]').nth(0).isDisabled() ||
  await mf.locator('.narrow-field input[type="number"]').nth(2).isDisabled(),
  'rate field locked')
await mf.locator('button', { hasText: 'Add entry' }).click()
await page.waitForTimeout(600)
s = await readState()
const flatEntry = s.entries.find(e => e.flatAmount === 200)
check('A flat job is stored as a price, not a rate', !!flatEntry,
  JSON.stringify(flatEntry && { flat: flatEntry.flatAmount, rate: flatEntry.rate }))

// It prices at the agreed number no matter what the clock says.
const flatShown = await page.locator('.entry-row', { hasText: 'Mowing & edging' })
  .filter({ hasText: 'flat' }).first().innerText()
check('The log prices it at the agreed number', flatShown.includes('$200.00'),
  flatShown.split('\n').join(' ').slice(0, 70))

// And the invoice says Flat rate rather than inventing an hourly one.
await page.locator('.tab', { hasText: 'Invoices' }).click()
await page.waitForTimeout(600)
await page.locator('.picker-trigger').first().click()
await page.waitForTimeout(400)
await page.locator('.picker-row', { hasText: 'Vasquez' }).click()
await page.waitForTimeout(600)
await page.locator('button', { hasText: 'Create invoice' }).click()
await page.waitForTimeout(900)
const sheet = await page.locator('.invoice-table').innerText()
check('The invoice prints "Flat rate" instead of a made-up hourly rate',
  sheet.includes('Flat rate'), sheet.split('\n').slice(0, 6).join(' | '))
check('And the flat amount is the total', sheet.includes('$200.00'))

// ---- 24. Gifted hours are dealt with, and are not income ----------------
await page.locator('.tab', { hasText: 'Timer' }).click()
await page.waitForTimeout(700)
const before = (await readState()).entries.filter(e => e.settled).length
// Target a specific known entry (2h of gutters, $170) rather than whichever
// happens to sort first — an arbitrary pick made this assert against a
// zero-length entry and hid what it was meant to check.
const nudge = page.locator('.nudge-item', { hasText: 'Okonkwo' })
await nudge.locator('.nudge-who').click()
await page.waitForTimeout(500)
await nudge.locator('.nudge-entries li', { hasText: 'gutters' }).locator('.ne-settle').click()
await page.waitForTimeout(400)
await page.locator('.ne-drawer .chip', { hasText: 'Gifted' }).click()
await page.locator('.ne-drawer input').fill('quick freebie')
await page.locator('.ne-drawer button', { hasText: 'Close it out' }).click()
await page.waitForTimeout(600)
s = await readState()
const freebies = s.entries.filter(e => e.settled)
check('Closing an entry out records how and why',
  freebies.length === before + 1 && freebies.some(e => e.settled.how === 'gift'),
  JSON.stringify(freebies.map(e => e.settled?.how)))
const gift = freebies.find(e => e.settled.how === 'gift')
check('The hours survive — a freebie is a record, not a deletion',
  gift.seconds > 0, `${gift.seconds}s kept`)
// Gifting the oldest entry can retire the whole client from the nudge, which
// is correct — what is left is not old unbilled work any more.
const panel = await page.locator('.nudge-panel').innerText().catch(() => '')
check('The gifted hours leave the ready-to-invoice panel', !panel.includes('gutters'),
  panel.split(String.fromCharCode(10)).join(' ').slice(0, 80))
check('And their money stops being counted as owed', !panel.includes('170.00'))

// Reports: hours yes, earnings no.
await page.locator('.tab', { hasText: 'More' }).click()
await page.waitForTimeout(300)
await page.locator('.more-row', { hasText: 'Reports' }).click()
await page.waitForTimeout(900)
const reportText = await page.locator('.view').innerText()
check('Reports calls out what was given away', /given away/i.test(reportText),
  (reportText.match(/Plus[^.]*given away[^.]*/i) ?? ['not found'])[0].slice(0, 90))

check('No console errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
