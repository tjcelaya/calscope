import { Temporal } from 'temporal-polyfill'
import { ValueType, type Entry, type Track } from './core'

/**
 * Deterministic demo fixture -- now a PRODUCER of real core Entry/Track data, feeding
 * the same buildModel as the op-log store. Deliberately includes DST days so the spur
 * and void geometry are confronted now rather than rediscovered twice a year, and a
 * concurrency ladder -- instant inside interval inside interval, partial overlap,
 * an event spanning midnight, and an ONGOING event on the most recent day -- so the
 * mark encoding is tested against the cases that actually collide.
 */
export const TIME_ZONE = 'America/New_York'

/**
 * Spike-fidelity coordinates for the fixture zone (NYC), for day/night shading. Solar
 * position is pure astronomy -- computed locally, no lookup service. The real app derives
 * approximate coords from the IANA zone via a zone1970.tab-based table, refined by
 * optional Geolocation (M2). See docs/PLAN.md.
 */
export const LAT = 40.71
export const LNG = -74.01

/**
 * Instant captures ride Binary tracks (a "did happen" mark, per the scribcal mapping);
 * everything with extent is an Interval track. Ongoing-ness is not a valueType -- it is
 * an Interval entry whose `end` is still absent.
 */
export const demoTracks: Track[] = [
  { id: 'sleep', name: 'Sleep', valueType: ValueType.Interval, tags: [], color: '#6c7bff' },
  { id: 'coffee', name: 'Coffee', valueType: ValueType.Binary, tags: [], color: '#d98b45' },
  { id: 'work', name: 'Work', valueType: ValueType.Interval, tags: [], color: '#3fa7a0' },
  { id: 'meeting', name: 'Meeting', valueType: ValueType.Interval, tags: [], color: '#8faa4b' },
  { id: 'run', name: 'Run', valueType: ValueType.Binary, tags: [], color: '#c2557a' },
  { id: 'read', name: 'Read', valueType: ValueType.Interval, tags: [], color: '#8f6cc4' },
]

/** Deterministic pseudo-random so the demo looks the same on every reload. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Seeded by DAY INDEX, not date, so every scenario shows identical marks and the only
 * visible difference between scenarios is the DST anomaly itself. Controlled comparison
 * -- but it means scenario discriminability rests entirely on the anomaly encoding.
 */
const SHAPES: Array<{ trackId: string; hour: number; duration: number; jitter: number }> = [
  { trackId: 'sleep', hour: 23.5, duration: 7, jitter: 1.2 },
  { trackId: 'coffee', hour: 7.5, duration: 0, jitter: 1 },
  // The concurrency ladder: coffee at 10:45 sits inside the 10:00 meeting, which sits
  // inside the 9-17 work block -- three deep. The 16:30 meeting straddles work's end.
  { trackId: 'coffee', hour: 10.75, duration: 0, jitter: 0.2 },
  { trackId: 'work', hour: 9, duration: 8, jitter: 0.8 },
  { trackId: 'meeting', hour: 10, duration: 1.5, jitter: 0.3 },
  { trackId: 'meeting', hour: 16.5, duration: 1, jitter: 0.3 },
  { trackId: 'run', hour: 17.5, duration: 0, jitter: 1.5 },
  { trackId: 'read', hour: 21, duration: 1.25, jitter: 1 },
]

export function generateEntries(startDate: Temporal.PlainDate, days: number): Entry[] {
  const entries: Entry[] = []
  const lastDay = days - 1

  for (let i = 0; i < days; i++) {
    const date = startDate.add({ days: i })
    for (const [s, shape] of SHAPES.entries()) {
      const seed = i * 17 + s * 3 + 1
      // Skip a few so the rings do not look mechanically identical.
      if (rand(seed * 5) < 0.12) continue
      // The most recent day's work block becomes the ongoing entry instead.
      if (i === lastDay && shape.trackId === 'work') continue

      const offset = (rand(seed) - 0.5) * shape.jitter
      const raw = shape.hour + offset
      const hour = ((raw % 24) + 24) % 24

      // 'compatible' disambiguation may nudge a start out of a DST-skipped hour; the
      // resulting string carries the true offset, so it still satisfies ZonedIsoSchema.
      const start = date.toZonedDateTime({
        timeZone: TIME_ZONE,
        plainTime: Temporal.PlainTime.from({
          hour: Math.floor(hour),
          minute: Math.floor((hour % 1) * 60),
        }),
      })
      const endHours = shape.duration * (0.8 + rand(seed * 7) * 0.4)

      entries.push({
        id: `demo-${i}-${s}`,
        trackId: shape.trackId,
        start: start.toString(),
        // Instants (duration 0) carry no end; `end` in exact minutes (Duration fields
        // must be integers) crosses DST honestly.
        ...(shape.duration > 0
          ? { end: start.add({ minutes: Math.round(endHours * 60) }).toString() }
          : {}),
      })
    }
  }

  // Ongoing: work started this morning and has not been stopped -- an Interval entry
  // with no `end`, exactly the shape the capture panel's "start" writes. Its mark must
  // extend to `now`, concurrent with the 10:00 meeting and the 10:45 instant.
  entries.push({
    id: 'demo-ongoing-work',
    trackId: 'work',
    start: startDate
      .add({ days: lastDay })
      .toZonedDateTime({ timeZone: TIME_ZONE, plainTime: '09:00' })
      .toString(),
  })
  return entries
}

/**
 * The demo's clock is simulated so the fixture stays deterministic; the App boundary
 * substitutes the real clock in my-data mode. Either way `now` reaches the views as a
 * parameter, never a clock read.
 */
export function simulatedNow(startDate: Temporal.PlainDate, days: number): Temporal.ZonedDateTime {
  return startDate
    .add({ days: days - 1 })
    .toZonedDateTime({ timeZone: TIME_ZONE, plainTime: '14:30' })
}

/** The three scenarios the demo fixture exists to answer questions about. */
export const SCENARIOS = [
  { key: 'normal', label: 'Ordinary week', start: Temporal.PlainDate.from('2026-06-08') },
  { key: 'fallback', label: 'Fall back (25h)', start: Temporal.PlainDate.from('2026-10-29') },
  { key: 'springfwd', label: 'Spring forward (23h)', start: Temporal.PlainDate.from('2026-03-05') },
] as const

export type ScenarioKey = (typeof SCENARIOS)[number]['key']
