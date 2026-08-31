import { useMemo, useState } from 'react'
import type { DurationStyle, TractionState } from '../types'
import {
  decimalHours, EXPENSE_CATEGORIES, formatDuration, formatMoney, formatDate, liveSeconds,
  monthKey, periodLabel, todayISO, weekStartISO, clientShortName, entryAmount,
} from '../store'
import { BarChart, Donut, type BarDatum, type Slice } from './charts'
import { DurationToggle } from './DurationFields'

// Validated categorical palette (dark surface #131c2e) for CLIENT series —
// see the dataviz validator run. Services carry their own colors instead.
const CLIENT_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
const GENERAL_COLOR = '#64748b'
const OTHER_COLOR = '#475569'

type Metric = 'earnings' | 'hours'
type RangeId = 'week' | 'month' | '30d' | '90d' | 'year' | 'all' | 'custom'

const RANGES: { id: RangeId; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: '30d', label: 'Last 30d' },
  { id: '90d', label: 'Last 90d' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
]

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return todayISO(date)
}

function enumerate(from: string, to: string, g: 'day' | 'week' | 'month'): string[] {
  const out: string[] = []
  if (g === 'month') {
    let [y, m] = from.split('-').map(Number)
    const [ty, tm] = to.split('-').map(Number)
    while (y < ty || (y === ty && m <= tm)) {
      out.push(`${y}-${String(m).padStart(2, '0')}`)
      m++; if (m > 12) { m = 1; y++ }
    }
  } else {
    const step = g === 'week' ? 7 : 1
    let cur = g === 'week' ? weekStartISO(from) : from
    const end = g === 'week' ? weekStartISO(to) : to
    let guard = 0
    while (cur <= end && guard++ < 2000) { out.push(cur); cur = addDays(cur, step) }
  }
  return out
}

export function ReportsView({
  state, onSetDurationFormat,
}: {
  state: TractionState
  onSetDurationFormat: (style: DurationStyle) => void
}) {
  const [metric, setMetric] = useState<Metric>('earnings')
  const [rangeId, setRangeId] = useState<RangeId>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState(todayISO())
  const cur = state.settings.currency
  const durationStyle = state.settings.durationFormat ?? 'hm'

  const today = todayISO()
  const firstEntryDate = useMemo(
    () => state.entries.reduce((min, e) => (e.date < min ? e.date : min), today),
    [state.entries, today],
  )

  const { from, to } = useMemo(() => {
    switch (rangeId) {
      case 'week': return { from: weekStartISO(today), to: today }
      case 'month': return { from: today.slice(0, 8) + '01', to: today }
      case '30d': return { from: addDays(today, -29), to: today }
      case '90d': return { from: addDays(today, -89), to: today }
      case 'year': return { from: today.slice(0, 4) + '-01-01', to: today }
      case 'all': return { from: firstEntryDate, to: today }
      case 'custom': return { from: customFrom || firstEntryDate, to: customTo || today }
    }
  }, [rangeId, today, firstEntryDate, customFrom, customTo])

  const inRange = useMemo(
    () => state.entries.filter(e => e.date >= from && e.date <= to),
    [state.entries, from, to],
  )

  // Metric accessors: earnings in dollars, hours in seconds (formatted as h m).
  /**
   * Hours worked count whatever happened to the money; earnings do not count
   * work that was given away. A freebie is real time and zero income.
   */
  const val = (e: TractionState['entries'][number], secs: number) =>
    metric === 'earnings' ? (e.settled ? 0 : entryAmount(e, secs)) : secs
  const fmt = (v: number) => metric === 'earnings' ? formatMoney(v, cur) : formatDuration(v, durationStyle)

  const totals = useMemo(() => {
    let earnings = 0, seconds = 0, unbilled = 0, givenAway = 0, givenSeconds = 0
    for (const e of inRange) {
      const secs = liveSeconds(e)
      const amt = entryAmount(e, secs)
      seconds += secs
      if (e.settled) {
        // Not income — but worth counting, because "how much have I given away"
        // is the reason for keeping these instead of deleting them.
        givenAway += amt; givenSeconds += secs
        continue
      }
      earnings += amt
      if (!e.invoiceId) unbilled += amt
    }
    return {
      earnings: Math.round(earnings * 100) / 100, seconds,
      unbilled: Math.round(unbilled * 100) / 100,
      givenAway: Math.round(givenAway * 100) / 100, givenSeconds,
    }
  }, [inRange])

  const granularity: 'day' | 'week' | 'month' = useMemo(() => {
    const span = (new Date(to).getTime() - new Date(from).getTime()) / 86400000
    if (span <= 31) return 'day'
    if (span <= 182) return 'week'
    return 'month'
  }, [from, to])

  const bars: BarDatum[] = useMemo(() => {
    const sums = new Map<string, number>()
    for (const e of inRange) {
      const key = granularity === 'month' ? monthKey(e.date) : granularity === 'week' ? weekStartISO(e.date) : e.date
      sums.set(key, (sums.get(key) ?? 0) + val(e, liveSeconds(e)))
    }
    return enumerate(from, to, granularity).map(key => ({
      key, label: periodLabel(key, granularity), value: sums.get(key) ?? 0,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRange, from, to, granularity, metric])

  const serviceSlices: Slice[] = useMemo(() => {
    const sums = new Map<string, number>()
    for (const e of inRange) sums.set(e.serviceId, (sums.get(e.serviceId) ?? 0) + val(e, liveSeconds(e)))
    return [...sums.entries()]
      .map(([id, value]) => {
        const svc = state.services.find(s => s.id === id)
        return { key: id, label: svc?.name ?? 'Unknown', value, color: svc?.color ?? OTHER_COLOR }
      })
      .filter(s => s.value > 0)
      .sort((a, b) => b.value - a.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRange, state.services, metric])

  // Stable per-client colors: assigned by creation order, never by rank.
  const clientColor = useMemo(() => {
    const map = new Map<string, string>()
    ;[...state.clients].sort((a, b) => a.createdAt - b.createdAt)
      .forEach((c, i) => map.set(c.id, CLIENT_COLORS[i % CLIENT_COLORS.length]))
    return map
  }, [state.clients])

  const clientSlices: Slice[] = useMemo(() => {
    const sums = new Map<string, number>()
    for (const e of inRange) {
      const key = e.clientId ?? 'general'
      sums.set(key, (sums.get(key) ?? 0) + val(e, liveSeconds(e)))
    }
    const all = [...sums.entries()]
      .map(([key, value]) => ({
        key,
        label: key === 'general' ? 'General' : clientShortName(state.clients.find(c => c.id === key)),
        value,
        color: key === 'general' ? GENERAL_COLOR : (clientColor.get(key) ?? OTHER_COLOR),
      }))
      .filter(s => s.value > 0)
      .sort((a, b) => b.value - a.value)
    // Fold anything past the 7th into a single "Other" slice.
    if (all.length <= 8) return all
    const head = all.slice(0, 7)
    const rest = all.slice(7)
    head.push({ key: 'other', label: `Other (${rest.length})`, color: OTHER_COLOR, value: rest.reduce((s, x) => s + x.value, 0) })
    return head
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRange, state.clients, clientColor, metric])

  const avgRate = totals.seconds > 0 ? totals.earnings / (totals.seconds / 3600) : 0

  // Expenses in range → profit picture. Billable materials are treated as a
  // wash (client reimburses them), so profit = earnings − overhead.
  const expStats = useMemo(() => {
    let billable = 0, overhead = 0
    const byCat = new Map<string, number>()
    for (const x of state.expenses) {
      if (x.date < from || x.date > to) continue
      if (x.billable) billable += x.amount; else overhead += x.amount
      byCat.set(x.category, (byCat.get(x.category) ?? 0) + x.amount)
    }
    const r2 = (v: number) => Math.round(v * 100) / 100
    return { billable: r2(billable), overhead: r2(overhead), spent: r2(billable + overhead), byCat }
  }, [state.expenses, from, to])

  const net = Math.round((totals.earnings - expStats.overhead) * 100) / 100
  const categorySlices: Slice[] = useMemo(() => (
    [...expStats.byCat.entries()]
      .map(([cat, value]) => ({ key: cat, label: cat, value, color: CLIENT_COLORS[Math.max(0, EXPENSE_CATEGORIES.indexOf(cat)) % CLIENT_COLORS.length] }))
      .filter(s => s.value > 0)
      .sort((a, b) => b.value - a.value)
  ), [expStats])

  if (state.entries.length === 0) {
    return (
      <div className="view">
        <div className="panel"><h2>Reports</h2>
          <p className="hint">Track some time and your earnings, hours, and breakdowns will show up here.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="view reports-view">
      <div className="panel">
        <div className="reports-controls">
          <div className="range-row">
            {RANGES.map(r => (
              <button key={r.id} className={`chip range-chip ${rangeId === r.id ? 'sel' : ''}`}
                onClick={() => setRangeId(r.id)}>{r.label}</button>
            ))}
            <button className={`chip range-chip ${rangeId === 'custom' ? 'sel' : ''}`}
              onClick={() => setRangeId('custom')}>Custom</button>
          </div>
          {rangeId === 'custom' && (
            <div className="quick-row custom-range">
              <label className="field"><span>From</span>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} /></label>
              <label className="field"><span>To</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} /></label>
            </div>
          )}
          <div className="toggle-row">
            <div className="metric-toggle">
              <button className={metric === 'earnings' ? 'active' : ''} onClick={() => setMetric('earnings')}>Earnings</button>
              <button className={metric === 'hours' ? 'active' : ''} onClick={() => setMetric('hours')}>Hours</button>
            </div>
            {/* Right here rather than only in Settings: deciding a week reads
                better in decimal is a thought you have while looking at it. */}
            <DurationToggle value={durationStyle} onChange={onSetDurationFormat} />
          </div>
        </div>
        <p className="hint tiny range-caption">{formatDate(from)} – {formatDate(to)}</p>

        <div className="stat-grid">
          <StatTile label="Earned" value={formatMoney(totals.earnings, cur)} accent />
          <StatTile label="Hours" value={formatDuration(totals.seconds, durationStyle)} />
          <StatTile label="Unbilled" value={formatMoney(totals.unbilled, cur)} />
          <StatTile label="Avg rate" value={`${formatMoney(avgRate, cur)}/hr`} />
        </div>
        {/* Only when there is some — an always-on zero would read as a nag. */}
        {totals.givenAway > 0 && (
          <p className="hint tiny">
            Plus <strong>{formatMoney(totals.givenAway, cur)}</strong> across{' '}
            {formatDuration(totals.givenSeconds, durationStyle)} given away — gifted,
            traded or written off. Counted as hours worked, not as income.
          </p>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>{metric === 'earnings' ? 'Earnings' : 'Hours'} over time</h3>
          <span className="dim tiny">by {granularity}</span>
        </div>
        <BarChart data={bars} formatValue={fmt} />
      </div>

      <div className="donut-grid">
        <div className="panel">
          <h3>By service</h3>
          <Donut slices={serviceSlices} formatValue={fmt}
            centerLabel={metric === 'earnings' ? 'earned' : 'tracked'}
            centerValue={fmt(serviceSlices.reduce((s, x) => s + x.value, 0))} />
        </div>
        <div className="panel">
          <h3>By client</h3>
          <Donut slices={clientSlices} formatValue={fmt}
            centerLabel={metric === 'earnings' ? 'earned' : 'tracked'}
            centerValue={fmt(clientSlices.reduce((s, x) => s + x.value, 0))} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Profit</h3>
          <span className="dim tiny">earnings − overhead</span>
        </div>
        <div className="stat-grid">
          <StatTile label="Income" value={formatMoney(totals.earnings, cur)} />
          <StatTile label="Materials" value={formatMoney(expStats.billable, cur)} />
          <StatTile label="Overhead" value={formatMoney(expStats.overhead, cur)} />
          <StatTile label="Net profit" value={formatMoney(net, cur)} accent={net >= 0} />
        </div>
        <p className="hint tiny">
          Net = earnings − overhead. Billable materials ({formatMoney(expStats.billable, cur)}) are
          treated as reimbursed by clients, so they don't reduce profit. Track costs in the Expenses tab.
        </p>
      </div>

      {categorySlices.length > 0 && (
        <div className="panel">
          <h3>Expenses by category</h3>
          <Donut slices={categorySlices} formatValue={v => formatMoney(v, cur)}
            centerLabel="spent" centerValue={formatMoney(expStats.spent, cur)} />
        </div>
      )}

      <div className="panel">
        <h3>Service breakdown</h3>
        <table className="report-table">
          <thead>
            <tr><th>Service</th><th className="num">Hours</th><th className="num">Earned</th></tr>
          </thead>
          <tbody>
            {serviceBreakdownRows(inRange, state).map(r => (
              <tr key={r.id}>
                <td><span className="legend-swatch" style={{ background: r.color }} /> {r.name}</td>
                <td className="num">{formatDuration(r.seconds, durationStyle)}</td>
                <td className="num">{formatMoney(r.earnings, cur)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">{formatDuration(totals.seconds, durationStyle)}</td>
              <td className="num">{formatMoney(totals.earnings, cur)}</td>
            </tr>
          </tfoot>
        </table>
        {durationStyle === 'hm' && (
          <p className="hint tiny">{decimalHours(totals.seconds)} decimal hours in this range.</p>
        )}
      </div>
    </div>
  )
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`stat-tile ${accent ? 'accent' : ''}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function serviceBreakdownRows(entries: TractionState['entries'], state: TractionState) {
  const map = new Map<string, { seconds: number; earnings: number }>()
  for (const e of entries) {
    const secs = liveSeconds(e)
    const cur = map.get(e.serviceId) ?? { seconds: 0, earnings: 0 }
    cur.seconds += secs; cur.earnings += e.settled ? 0 : entryAmount(e, secs)
    map.set(e.serviceId, cur)
  }
  return [...map.entries()]
    .map(([id, v]) => {
      const svc = state.services.find(s => s.id === id)
      return { id, name: svc?.name ?? 'Unknown', color: svc?.color ?? OTHER_COLOR, ...v, earnings: Math.round(v.earnings * 100) / 100 }
    })
    .sort((a, b) => b.earnings - a.earnings)
}
