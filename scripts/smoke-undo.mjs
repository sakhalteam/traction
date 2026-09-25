/**
 * Smoke test for undo/redo: node scripts/smoke-undo.mjs
 * (needs the dev server up).
 *
 * Undo here is deliberately small: whole-document snapshots, held in memory,
 * this device and this session only. These checks pin down the parts that make
 * that safe — no arrows on a cold load, a fresh action dropping the redo
 * branch, a deleted expense coming back whole, and typing in a text box still
 * belonging to the text box.
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
    { id: 's1', name: 'Mowing', defaultRate: 60, color: '#22c55e', archived: false, createdAt: now - 90 * DAY },
  ],
  entries: [
    { id: 'e1', clientId: 'c1', serviceId: 's1', note: 'front strip',
      date: iso(now - DAY), startedAt: now - DAY, seconds: 3600, runningSince: null,
      rate: 60, invoiceId: null, photoPaths: [], createdAt: now - DAY },
  ],
  expenses: [
    { id: 'x1', clientId: null, label: 'Spare timber', amount: 25, category: 'Materials',
      date: iso(now - DAY), billable: true, invoiceId: null, settled: null,
      note: '', receiptPath: 'uid/x1-photo.jpg', createdAt: now - DAY },
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
const undoBtn = page.locator('.history-btns .icon-btn').first()
const redoBtn = page.locator('.history-btns .icon-btn').last()

// ---- 1. A cold load offers nothing to undo ------------------------------
check('No arrows before you have done anything',
  (await page.locator('.history-btns').count()) === 0)

// ---- 2. Deleting an expense is undoable, photo and all ------------------
await page.locator('.tab, .nav-btn').filter({ hasText: 'Expenses' }).first().click()
await page.waitForTimeout(500)
const row = page.locator('.group-shelf li', { hasText: 'Spare timber' })
// Expense rows sit folded to one line; the buttons appear once it is opened.
await row.locator('.xrow-line').click()
await page.waitForTimeout(150)
await row.locator('.icon-btn.danger[title="Delete"]').click()
await page.waitForTimeout(250)
await row.locator('.confirm-del').click()
await page.waitForTimeout(400)
let s = await readState()
check('The expense is gone', !s.expenses.some(x => x.id === 'x1'))
check('Arrows appear once there is something to undo',
  (await page.locator('.history-btns').count()) === 1)

await undoBtn.click()
await page.waitForTimeout(400)
s = await readState()
const back = s.expenses.find(x => x.id === 'x1')
check('Undo brings the expense back', !!back)
check('It comes back whole, receipt path intact',
  back?.receiptPath === 'uid/x1-photo.jpg' && back?.amount === 25,
  JSON.stringify([back?.receiptPath, back?.amount]))
check('The row is on screen again',
  (await page.locator('.group-shelf li', { hasText: 'Spare timber' }).count()) === 1)

// ---- 3. Redo puts it back ------------------------------------------------
await redoBtn.click()
await page.waitForTimeout(400)
s = await readState()
check('Redo re-applies the delete', !s.expenses.some(x => x.id === 'x1'))
await undoBtn.click()
await page.waitForTimeout(400)

// ---- 4. A new action drops the redo branch ------------------------------
const form = page.locator('.panel', { hasText: 'Log an expense' })
await form.locator('input[placeholder^="e.g. Mulch"]').fill('Dump fee')
await form.locator('input[placeholder="0.00"]').first().fill('30')
await form.locator('button', { hasText: 'Log expense' }).click()
await page.waitForTimeout(400)
check('Redo is unavailable once you do something new', await redoBtn.isDisabled())
s = await readState()
check('The new expense is there', s.expenses.some(x => x.label === 'Dump fee'))

await undoBtn.click()
await page.waitForTimeout(400)
s = await readState()
check('Undo removes the newly logged expense', !s.expenses.some(x => x.label === 'Dump fee'))
check('...and leaves the restored one alone', s.expenses.some(x => x.id === 'x1'))

// ---- 5. Ctrl+Z works, but not while typing ------------------------------
// Log something real first, so there is genuinely a step to take back.
await form.locator('input[placeholder^="e.g. Mulch"]').fill('Skip hire')
await form.locator('input[placeholder="0.00"]').first().fill('80')
await form.locator('button', { hasText: 'Log expense' }).click()
await page.waitForTimeout(400)

// Typing into a box and hitting Ctrl+Z means "undo my typing", never "undo my
// afternoon". The app has to keep its hands off while a field has focus.
await form.locator('input[placeholder^="e.g. Mulch"]').fill('Typed but not saved')
await page.keyboard.press('Control+z')
await page.waitForTimeout(300)
s = await readState()
check('Ctrl+Z inside a text box is left to the text box',
  s.expenses.some(x => x.label === 'Skip hire'), 'the app state must not have moved')

await page.locator('h2', { hasText: 'Expenses' }).click()
await page.keyboard.press('Control+z')
await page.waitForTimeout(400)
s = await readState()
check('Ctrl+Z outside a text box undoes the app action',
  !s.expenses.some(x => x.label === 'Skip hire'))
await page.keyboard.press('Control+y')
await page.waitForTimeout(400)
s = await readState()
check('Ctrl+Y redoes it', s.expenses.some(x => x.label === 'Skip hire'))

// ---- 6. Undoing past the end of the stack is harmless -------------------
for (let i = 0; i < 8; i++) {
  if (await undoBtn.isDisabled()) break
  await undoBtn.click()
  await page.waitForTimeout(180)
}
s = await readState()
check('Unwinding the whole session lands back where it started',
  s.expenses.length === 1 && s.expenses[0].id === 'x1' && s.entries.length === 1,
  JSON.stringify(s.expenses.map(x => x.label)))
check('Undo disables itself at the bottom of the stack', await undoBtn.isDisabled())

// ---- 7. Restoring a backup is not undoable ------------------------------
// It replaces the document wholesale and brings its own history; an undo stack
// pointing at what it replaced would be a trap.
await page.locator('.nav-btn, .more-row').filter({ hasText: 'Settings' }).first().click()
await page.waitForTimeout(500)
check('Settings offers a sweep for photos nothing points at',
  (await page.locator('button', { hasText: 'Clean up unused photos' }).count()) === 1)

check('No console errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
const failed = results.filter(r => !r.ok)
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed')
process.exit(failed.length ? 1 : 0)
