import type { DurationStyle } from '../types'
import { secondsFromDecimalHours } from '../store'

/**
 * The duration inputs, in whichever shape the app-wide format setting asks for:
 * a paired Hours/Minutes in 'hm', a single decimal Hours box in 'decimal'.
 *
 * Always reports whole seconds, so switching format mid-edit can never change
 * what an entry bills — only how you type it.
 */
export function DurationFields({
  seconds, style, onChange,
}: {
  seconds: number
  style: DurationStyle
  onChange: (seconds: number) => void
}) {
  const safe = Math.max(0, seconds)

  if (style === 'decimal') {
    return (
      <label className="field narrow-field">
        <span>Hours</span>
        <input
          type="number" min="0" step="0.25" inputMode="decimal"
          value={Number((safe / 3600).toFixed(2))}
          onChange={e => onChange(secondsFromDecimalHours(e.target.value))}
        />
      </label>
    )
  }

  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const set = (h: number, m: number) => onChange(Math.max(0, h * 3600 + m * 60))

  return (
    <>
      <label className="field narrow-field">
        <span>Hours</span>
        <input
          type="number" min="0" inputMode="numeric"
          value={hours}
          onChange={e => set(Number(e.target.value) || 0, minutes)}
        />
      </label>
      <label className="field narrow-field">
        <span>Minutes</span>
        <input
          type="number" min="0" max="59" inputMode="numeric"
          value={minutes}
          onChange={e => set(hours, Number(e.target.value) || 0)}
        />
      </label>
    </>
  )
}

/**
 * The app-wide h:m ↔ decimal switch. Deliberately repeated on every screen
 * where the format actually matters (Reports, manual entry, Settings) instead
 * of living only in Settings: it's a reading preference you flip mid-thought,
 * and a preference you have to leave the screen to change is one you stop
 * using. Every copy drives the same single setting.
 */
export function DurationToggle({
  value, onChange,
}: {
  value: DurationStyle
  onChange: (style: DurationStyle) => void
}) {
  return (
    <div className="metric-toggle duration-toggle" role="group" aria-label="Duration format">
      <button
        type="button"
        className={value !== 'decimal' ? 'active' : ''}
        aria-pressed={value !== 'decimal'}
        onClick={() => onChange('hm')}
      >4h 30m</button>
      <button
        type="button"
        className={value === 'decimal' ? 'active' : ''}
        aria-pressed={value === 'decimal'}
        onClick={() => onChange('decimal')}
      >4.5h</button>
    </div>
  )
}
