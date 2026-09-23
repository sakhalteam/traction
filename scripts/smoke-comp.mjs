/**
 * Smoke test for comps, discounts and trades: node scripts/smoke-comp.mjs
 * (needs the dev server up).
 *
 * The case this was built for: Patrick hands over a pile of weight plates and
 * asks $200 for them, so his invoice shows the usual breakdown of hours and
 * materials and then one line taking $200 back off. Also checks the split that
 * makes the record worth keeping — comped money is gone, traded money bought
 * something — and that a sent invoice stops accepting them.
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
  ],
  services: [
    { id: 's1', name: 'Pressure washing', defaultRate: 85, color: '#0ea5e9', archived: false, createdAt: now - 90 * DAY },
  ],
  entries: [
    { id: 'e1', clientId: 'c1', serviceId: 's1', note: 'driveway',
      date: iso(now - DAY), startedAt: now - DAY, seconds: 14400, runningSince: null,
      rate: 85, invoiceId: null, photoPaths: [], createdAt: now - DAY },
  ],
  expenses: [
    { id: 'x1', clientId: 'c1', label: 'Detergent', amount: 20, category: 'Materials',
      date: iso(now - DAY), billable: true, invoiceId: null, settled: null,
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
const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|supabase|fetch/i.test(m.text())) errors.push(m.text()) })

await page.goto(URL, { waitUntil: 'networkidle' })
await page.evaluate(s => localStorage.setItem('traction-state', JSON.stringify(s)), state)
await page.reload()
await page.waitForTimeout(700)

const readState = () => page.evaluate(() => JSON.parse(localStorage.getItem('traction-state')))

// ---- 1. Build Patrick an ordinary invoice -------------------------------
await page.locator('.tab, .nav-btn').filter({ hasText: 'Invoices' }).first().click()
await page.waitForTimeout(500)
await page.locator('.picker-trigger').first().click()
await page.waitForTimeout(300)
await page.locator('.picker-row', { hasText: 'Patrick' }).click()
await page.waitForTimeout(400)
await page.locator('button', { hasText: 'Create invoice' }).click()
await page.waitForTimeout(700)

let s = await readState()
let inv = s.invoices[0]
check('The invoice starts at labour plus materials', inv?.snapshot?.total === 340,
  String(inv?.snapshot?.total))
let sheet = await page.locator('.invoice-sheet').innerText()
check('It prints $360.00 before anything comes off', sheet.includes('$360.00'),
  sheet.replace(/\n/g, ' | ').slice(-90))

// ---- 2. Take $200 off as a trade ----------------------------------------
const editor = page.locator('.invoice-expenses', { hasText: 'money off this invoice' })
await editor.locator('input[placeholder^="e.g. Trade"]').fill('Trade — weight plates')
await editor.locator('input.narrow').fill('200')
await editor.locator('.chip', { hasText: 'Trade' }).click()
await editor.locator('button', { hasText: 'Take it off' }).click()
await page.waitForTimeout(500)

s = await readState()
inv = s.invoices[0]
const adj = inv?.adjustments?.[0]
check('The trade is frozen onto the invoice',
  adj?.amount === 200 && adj?.kind === 'trade' && adj?.label === 'Trade — weight plates',
  JSON.stringify(adj))
check('It is NOT recorded as an expense',
  !s.expenses.some(x => x.amount === 200 || x.amount === -200),
  'a comp is not money the business spent')

sheet = await page.locator('.invoice-sheet').innerText()
check('The invoice prints the line under your own wording',
  /trade — weight plates/i.test(sheet), sheet.replace(/\n/g, ' | ').slice(-140))
check('It prints as a subtraction', sheet.includes('−$200.00'))
check('The breakdown of hours and materials survives',
  /pressure washing/i.test(sheet) && /detergent/i.test(sheet))
check('The total drops to $160.00', sheet.includes('$160.00'))

// ---- 3. A second one, as a goodwill comp --------------------------------
await editor.locator('input[placeholder^="e.g. Trade"]').fill('Sorry about the gate')
await editor.locator('input.narrow').fill('50')
await editor.locator('.chip', { hasText: 'Comp' }).click()
await editor.locator('button', { hasText: 'Take it off' }).click()
await page.waitForTimeout(500)
s = await readState()
inv = s.invoices[0]
check('Both come off, keeping their own kind',
  inv.adjustments.length === 2 && inv.adjustments[1].kind === 'comp',
  JSON.stringify(inv.adjustments.map(a => [a.kind, a.amount])))
sheet = await page.locator('.invoice-sheet').innerText()
check('The total is now $110.00', sheet.includes('$110.00'))

// ---- 4. Reports keeps them apart ----------------------------------------
await page.locator('.nav-btn, .more-row').filter({ hasText: 'Reports' }).first().click()
await page.waitForTimeout(700)
const profit = await page.locator('.panel', { hasText: 'Net profit' }).innerText()
check('Reports shows comped and traded separately',
  profit.includes('$50.00') && profit.includes('$200.00'),
  profit.replace(/\s+/g, ' ').slice(0, 240))
// $340 of labour less the $250 taken off. Patrick pays $110, but $20 of that
// reimburses the detergent, which Reports treats as a wash either way.
check('Income is net of both', profit.includes('$90.00'),
  profit.replace(/\s+/g, ' ').slice(0, 240))

// ---- 5. Once sent, the number is a promise ------------------------------
await page.locator('.nav-btn, .tab').filter({ hasText: 'Invoices' }).first().click()
await page.waitForTimeout(500)
await page.locator('.invoice-row').first().click()
await page.waitForTimeout(500)
await page.locator('.status-btn, .chip, button').filter({ hasText: 'sent' }).first().click()
await page.waitForTimeout(500)
check('A sent invoice stops offering comps',
  (await page.locator('.invoice-expenses', { hasText: 'money off this invoice' }).count()) === 0,
  'changing a number the client has seen means voiding and reissuing')
s = await readState()
check('...and keeps the ones already on it', s.invoices[0].adjustments.length === 2)

check('No console errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
const failed = results.filter(r => !r.ok)
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed')
process.exit(failed.length ? 1 : 0)
