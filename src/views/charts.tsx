import { useState } from 'react'

// Hand-rolled SVG charts so traction stays dependency-free. Marks follow the
// data-viz method: thin marks, rounded data-ends on the baseline, a 2px surface
// gap between fills, a legend for categorical series with selective direct
// labels, recessive axes, and a hover tooltip by default.

const SURFACE = '#131c2e' // matches --panel-solid; the 2px gap "ink"

type Tip = { x: number; y: number; label: string; value: string } | null

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
      <div className="chart-tip-label">{tip.label}</div>
      <div className="chart-tip-value">{tip.value}</div>
    </div>
  )
}

// ---- Bar chart (single series) -------------------------------------------

export interface BarDatum { key: string; label: string; value: number }

export function BarChart({
  data, color = '#22c55e', formatValue,
}: {
  data: BarDatum[]
  color?: string
  formatValue: (v: number) => string
}) {
  const [tip, setTip] = useState<Tip>(null)
  const W = 680, H = 240
  const padL = 8, padR = 8, padT = 16, padB = 28
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const max = Math.max(1, ...data.map(d => d.value))
  const n = data.length || 1
  const slot = plotW / n
  const gap = Math.min(10, slot * 0.25)
  const barW = Math.max(2, slot - gap)
  const labelEvery = Math.ceil(n / 9)

  // 3 recessive gridlines.
  const ticks = [0.25, 0.5, 0.75, 1].map(f => ({ f, v: max * f }))

  return (
    <div className="chart-wrap" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" preserveAspectRatio="none">
        {ticks.map(t => {
          const y = padT + plotH * (1 - t.f)
          return (
            <g key={t.f}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} className="chart-grid" />
              <text x={W - padR} y={y - 3} className="chart-axis-label" textAnchor="end">
                {formatValue(t.v)}
              </text>
            </g>
          )
        })}
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} className="chart-axis" />
        {data.map((d, i) => {
          const h = d.value <= 0 ? 0 : Math.max(2, (d.value / max) * plotH)
          const x = padL + i * slot + gap / 2
          const y = padT + plotH - h
          return (
            <g key={d.key}>
              {h > 0 && (
                <rect
                  x={x} y={y} width={barW} height={h} rx={4} ry={4}
                  fill={color} className="chart-bar"
                  onMouseMove={e => {
                    const r = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect()
                    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, label: d.label, value: formatValue(d.value) })
                  }}
                />
              )}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 8} className="chart-axis-label" textAnchor="middle">
                  {d.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

// ---- Donut (categorical share) -------------------------------------------

export interface Slice { key: string; label: string; value: number; color: string }

function ring(cx: number, cy: number, rO: number, rI: number, a0: number, a1: number): string {
  if (a1 - a0 >= 359.999) {
    // Full circle → draw as two arcs so the path is valid.
    return ring(cx, cy, rO, rI, a0, a0 + 180) + ring(cx, cy, rO, rI, a0 + 180, a1)
  }
  const p = (r: number, a: number): [number, number] => {
    const rad = (a - 90) * Math.PI / 180
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
  }
  const [ox0, oy0] = p(rO, a0), [ox1, oy1] = p(rO, a1)
  const [ix1, iy1] = p(rI, a1), [ix0, iy0] = p(rI, a0)
  const large = a1 - a0 > 180 ? 1 : 0
  return `M${ox0},${oy0} A${rO},${rO} 0 ${large},1 ${ox1},${oy1} L${ix1},${iy1} A${rI},${rI} 0 ${large},0 ${ix0},${iy0} Z`
}

export function Donut({
  slices, formatValue, centerLabel, centerValue,
}: {
  slices: Slice[]
  formatValue: (v: number) => string
  centerLabel: string
  centerValue: string
}) {
  const [tip, setTip] = useState<Tip>(null)
  const [active, setActive] = useState<string | null>(null)
  const total = slices.reduce((s, x) => s + x.value, 0)
  const S = 200, cx = 100, cy = 100, rO = 92, rI = 58

  if (total <= 0) {
    return <p className="hint">No data in this range.</p>
  }

  let angle = 0
  const arcs = slices.map(s => {
    const frac = s.value / total
    const a0 = angle, a1 = angle + frac * 360
    angle = a1
    return { ...s, a0, a1, frac, mid: (a0 + a1) / 2 }
  })

  return (
    <div className="donut-block">
      <div className="chart-wrap donut-wrap" onMouseLeave={() => { setTip(null); setActive(null) }}>
        <svg viewBox={`0 0 ${S} ${S}`} className="donut-svg" role="img">
          {arcs.map(a => (
            <path
              key={a.key} d={ring(cx, cy, rO, rI, a.a0, a.a1)}
              fill={a.color} stroke={SURFACE} strokeWidth={2}
              className={`donut-arc ${active && active !== a.key ? 'dim' : ''}`}
              onMouseMove={e => {
                const r = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect()
                setActive(a.key)
                setTip({
                  x: e.clientX - r.left, y: e.clientY - r.top,
                  label: a.label, value: `${formatValue(a.value)} · ${Math.round(a.frac * 100)}%`,
                })
              }}
            />
          ))}
          {/* Direct % labels on slices big enough to fit one. */}
          {arcs.filter(a => a.frac >= 0.08).map(a => {
            const rad = (a.mid - 90) * Math.PI / 180
            const rr = (rO + rI) / 2
            return (
              <text key={a.key} x={cx + rr * Math.cos(rad)} y={cy + rr * Math.sin(rad) + 4}
                className="donut-pct" textAnchor="middle">
                {Math.round(a.frac * 100)}%
              </text>
            )
          })}
          <text x={cx} y={cy - 4} className="donut-center-value" textAnchor="middle">{centerValue}</text>
          <text x={cx} y={cy + 16} className="donut-center-label" textAnchor="middle">{centerLabel}</text>
        </svg>
        <Tooltip tip={tip} />
      </div>
      <ul className="donut-legend">
        {arcs.map(a => (
          <li key={a.key} className={active && active !== a.key ? 'dim' : ''}
            onMouseEnter={() => setActive(a.key)} onMouseLeave={() => setActive(null)}>
            <span className="legend-swatch" style={{ background: a.color }} />
            <span className="legend-label">{a.label}</span>
            <span className="legend-value">{formatValue(a.value)}</span>
            <span className="legend-pct">{Math.round(a.frac * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
