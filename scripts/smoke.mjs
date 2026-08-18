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
    // A second, more recent job so one row is the "Again" button and the other
    // is a chip — the pinning tests need a chip to exist.
    {
      id: 'e2', clientId: 'c2', serviceId: 's2', note: 'driveway',
      date: iso(now - 2 * DAY), startedAt: now - 2 * DAY, seconds: 5400, runningSince: null,
      rate: 85, invoiceId: null, photoPaths: [], createdAt: now - 2 * DAY,
    },
  ],
  expenses: [],
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
await page.locator('.again-btn').click()
await page.waitForTimeout(400)
check('Again starts a timer', await page.locator('.running-card').isVisible())

let s = await readState()
// "Again" resumes the most recently created job, which is e2 (s2 for c2).
check('Started entry carries the job details',
  s.entries.some(e => e.runningSince && e.serviceId === 's2' && e.clientId === 'c2' && e.rate === 85))

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
check('Counter advanced', s.settings.invoiceCounter === 2, `got ${s.settings.invoiceCounter}`)

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

check('No console errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
