import { Temporal } from 'temporal-polyfill'

/**
 * Throwaway fixture for the M0.5 spike. Deliberately includes DST days so the spur and
 * void geometry are confronted now rather than rediscovered twice a year, and a
 * concurrency ladder -- instant inside interval inside interval, partial overlap,
 * an event spanning midnight, and an ONGOING event on the most recent day -- so the
 * mark-encoding ideas are tested against the cases that actually collide.
 */
export type FakeTrack = { id: string; name: string; color: string }
export type FakeEntry = {
  trackId: string
  start: Temporal.ZonedDateTime
  endHours: number
  /** Still running: no end. Rendered to the simulated `now`, styled distinctly. */
  ongoing?: boolean
}

export const TIME_ZONE = 'America/New_York'

/**
 * Spike-fidelity coordinates for the fixture zone (NYC). The real app derives these from
 * the IANA zone via a zone1970.tab-based table, refined by optional Geolocation.
 */
export const LAT = 40.71
export const LNG = -74.01

/**
 * Where the fixture "lives", for day/night shading. Solar position is pure astronomy --
 * computed locally, no lookup service. The real app's chain: explicit home setting ->
 * browser geolocation (never leaves the device) -> tz representative coords -> flat.
 */
export const HOME = { lat: 40.7128, lon: -74.006 }

export const tracks: FakeTrack[] = [
  { id: 'sleep', name: 'Sleep', color: '#6c7bff' },
  { id: 'coffee', name: 'Coffee', color: '#d98b45' },
  { id: 'work', name: 'Work', color: '#3fa7a0' },
  { id: 'meeting', name: 'Meeting', color: '#8faa4b' },
  { id: 'run', name: 'Run', color: '#c2557a' },
  { id: 'read', name: 'Read', color: '#8f6cc4' },
]

/** Deterministic pseudo-random so the spike looks the same on every reload. */
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

export function generate(startDate: Temporal.PlainDate, days: number): FakeEntry[] {
  const entries: FakeEntry[] = []
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

      entries.push({
        trackId: shape.trackId,
        start: date.toZonedDateTime({
          timeZone: TIME_ZONE,
          plainTime: Temporal.PlainTime.from({
            hour: Math.floor(hour),
            minute: Math.floor((hour % 1) * 60),
          }),
        }),
        endHours: shape.duration * (0.8 + rand(seed * 7) * 0.4),
      })
    }
  }

  // Ongoing: work started this morning and has not been stopped. Its arc must extend to
  // the simulated `now` -- concurrent with the 10:00 meeting and the 10:45 instant.
  entries.push({
    trackId: 'work',
    start: startDate.add({ days: lastDay }).toZonedDateTime({ timeZone: TIME_ZONE, plainTime: '09:00' }),
    endHours: 0,
    ongoing: true,
  })
  return entries
}

/**
 * The clock is an INPUT here, same rule as evaluateGoal's injectable `now` -- views never
 * read the real clock, or geometry stops being pure and tests stop being deterministic.
 */
export function simulatedNow(startDate: Temporal.PlainDate, days: number): Temporal.ZonedDateTime {
  return startDate
    .add({ days: days - 1 })
    .toZonedDateTime({ timeZone: TIME_ZONE, plainTime: '14:30' })
}

/** The three scenarios the spike exists to answer questions about. */
export const SCENARIOS = [
  { key: 'normal', label: 'Ordinary week', start: Temporal.PlainDate.from('2026-06-08') },
  { key: 'fallback', label: 'Fall back (25h)', start: Temporal.PlainDate.from('2026-10-29') },
  { key: 'springfwd', label: 'Spring forward (23h)', start: Temporal.PlainDate.from('2026-03-05') },
] as const

export type ScenarioKey = (typeof SCENARIOS)[number]['key']
