import { Temporal } from 'temporal-polyfill'

/**
 * Throwaway fixture for the M0.5 spike. Deliberately includes DST days so the spur and
 * void geometry are confronted now rather than rediscovered twice a year.
 */
export type FakeTrack = { id: string; name: string; color: string }
export type FakeEntry = { trackId: string; start: Temporal.ZonedDateTime; endHours: number }

export const TIME_ZONE = 'America/New_York'

export const tracks: FakeTrack[] = [
  { id: 'sleep', name: 'Sleep', color: '#6c7bff' },
  { id: 'coffee', name: 'Coffee', color: '#d98b45' },
  { id: 'work', name: 'Work', color: '#3fa7a0' },
  { id: 'run', name: 'Run', color: '#c2557a' },
  { id: 'read', name: 'Read', color: '#8f6cc4' },
]

/** Deterministic pseudo-random so the spike looks the same on every reload. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

const SHAPES: Array<{ trackId: string; hour: number; duration: number; jitter: number }> = [
  { trackId: 'sleep', hour: 23.5, duration: 7, jitter: 1.2 },
  { trackId: 'coffee', hour: 7.5, duration: 0, jitter: 1 },
  { trackId: 'coffee', hour: 13.5, duration: 0, jitter: 1.5 },
  { trackId: 'work', hour: 9, duration: 8, jitter: 0.8 },
  { trackId: 'run', hour: 17.5, duration: 0.75, jitter: 1.5 },
  { trackId: 'read', hour: 21, duration: 1.25, jitter: 1 },
]

export function generate(startDate: Temporal.PlainDate, days: number): FakeEntry[] {
  const entries: FakeEntry[] = []

  for (let i = 0; i < days; i++) {
    const date = startDate.add({ days: i })
    for (const [s, shape] of SHAPES.entries()) {
      const seed = i * 17 + s * 3 + 1
      // Skip a few so the rings do not look mechanically identical.
      if (rand(seed * 5) < 0.12) continue

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
  return entries
}

/** The three scenarios the spike exists to answer questions about. */
export const SCENARIOS = [
  { key: 'normal', label: 'Ordinary week', start: Temporal.PlainDate.from('2026-06-08') },
  { key: 'fallback', label: 'Fall back (25h)', start: Temporal.PlainDate.from('2026-10-29') },
  { key: 'springfwd', label: 'Spring forward (23h)', start: Temporal.PlainDate.from('2026-03-05') },
] as const

export type ScenarioKey = (typeof SCENARIOS)[number]['key']
