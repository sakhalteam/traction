import type { TimeEntry, TractionState } from './types'
import { formatClock, formatMoney, liveSeconds, lineAmount, clientShortName } from './store'

/**
 * The running timer, pinned to the bottom of every screen.
 *
 * Toggl's mini-timer exists because a running clock you can't see is a running
 * clock you forget to stop. traction previously showed the live entry only on
 * the Timer tab, so writing an invoice or logging fuel hid the fact that you
 * were still on the clock — and on a phone, where you're one tab away from the
 * timer at all times, that's exactly when it gets forgotten.
 *
 * Tapping the body jumps to the Timer screen; Stop is a separate, deliberately
 * large target so it can be hit one-handed without landing on navigation.
 */
export function TimerBar({
  entry, state, now, onStop, onOpen,
}: {
  entry: TimeEntry
  state: TractionState
  now: number
  onStop: (id: string) => void
  onOpen: () => void
}) {
  const secs = liveSeconds(entry, now)
  const service = state.services.find(s => s.id === entry.serviceId)
  const client = entry.clientId
    ? clientShortName(state.clients.find(c => c.id === entry.clientId))
    : 'General'

  return (
    <div className="timer-bar" role="status" aria-live="off">
      <button className="timer-bar-main" onClick={onOpen} title="Go to the timer">
        <span className="timer-bar-dot" style={{ background: service?.color ?? 'var(--accent)' }} />
        <span className="timer-bar-text">
          <span className="timer-bar-title">{service?.name ?? 'Work'}</span>
          <span className="timer-bar-sub">
            {client}{entry.note ? ` · ${entry.note}` : ''}
          </span>
        </span>
      </button>
      <span className="timer-bar-figures">
        <span className="timer-bar-clock">{formatClock(secs)}</span>
        <span className="timer-bar-amt">{formatMoney(lineAmount(secs, entry.rate), state.settings.currency)}</span>
      </span>
      <button className="timer-bar-stop" onClick={() => onStop(entry.id)} title="Stop the timer">
        <span aria-hidden="true">■</span>
        <span className="sr-only">Stop</span>
      </button>
    </div>
  )
}
