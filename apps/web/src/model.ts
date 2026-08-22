import { Temporal } from 'temporal-polyfill'
import {
  containmentDepth,
  slotPosition,
  virtualDay,
  type DstPolicy,
  type VirtualDay,
} from '@calscope/views'
import { daylightSegments, type DaylightSeg } from './daylight'
import { ValueType, type Entry, type Track } from './core'

/**
 * One day-model, three projections. Every view -- radial, day columns, year grid --
 * renders from this same structure. Grown out of spike-model.ts: the input is now real
 * core Entry/Track data, so the deterministic fixture (demo mode) and the folded op log
 * (my-data mode) are just two producers of the same shapes.
 */
export const MarkKind = {
  Instant: 'instant',
  Interval: 'interval',
  Ongoing: 'ongoing',
} as const
export type MarkKind = (typeof MarkKind)[keyof typeof MarkKind]

export type Mark = {
  entryId: string
  trackId: string
  color: string
  kind: MarkKind
  /** Grid slots: hours from the range start's midnight. Equal for instants. */
  startSlot: number
  endSlot: number
  /** Containment depth: strictly-longer intervals fully containing this one. */
  depth: number
}

/** A mark's share of one day, in within-day slots. Intervals crossing midnight split. */
export type DaySegment = { mark: Mark; from: number; to: number }

export type DayModel = {
  day: VirtualDay
  index: number
  daylight: DaylightSeg[]
  segments: DaySegment[]
  ticks: Mark[]
}

export type ViewModel = {
  days: DayModel[]
  marks: Mark[]
  /** Within-day slot of `now`, for the now-line. */
  nowSlot: number
  /** Day index of `now`, clamped into range so the now-line always lands on a ring. */
  nowDay: number
  now: Temporal.ZonedDateTime
}

export type ModelRange = {
  start: Temporal.PlainDate
  days: number
  /** Display zone: every entry is projected into it, whatever zone it was recorded in. */
  tz: string
  /** Spike-fidelity coordinates for daylight shading; zone1970.tab derivation is M2. */
  lat: number
  lng: number
}

/**
 * `now` is an INPUT, never a clock read (same rule as evaluateGoal): the App boundary
 * owns the real clock and passes it down, so geometry stays pure and deterministic.
 */
export function buildModel(
  entries: readonly Entry[],
  tracks: readonly Track[],
  range: ModelRange,
  policy: DstPolicy,
  now: Temporal.ZonedDateTime,
): ViewModel {
  const count = range.days
  const days = Array.from({ length: count }, (_, i) =>
    virtualDay(range.start.add({ days: i }), range.tz, policy),
  )

  const colorOf = new Map(tracks.map((t) => [t.id, t.color]))
  const typeOf = new Map(tracks.map((t) => [t.id, t.valueType]))

  const nowLocal = now.withTimeZone(range.tz)
  const nowSlot = slotPosition(nowLocal)
  const nowDayIndex = range.start.until(nowLocal.toPlainDate()).days
  const nowDay = Math.min(Math.max(nowDayIndex, 0), count - 1)
  const nowGrid = nowDayIndex * 24 + nowSlot
  const gridEnd = count * 24

  // Grid slot of a timestamp: whole days from range start, plus the WALL-CLOCK position
  // within its day. Wall-clock (not elapsed hours) is what the locked-zoom invariant
  // wants: a repeated hour maps onto the same slot; the anomaly is drawn separately.
  const gridSlot = (zdt: Temporal.ZonedDateTime): number => {
    const local = zdt.withTimeZone(range.tz)
    return range.start.until(local.toPlainDate()).days * 24 + slotPosition(local)
  }

  const marks: Mark[] = []
  for (const e of entries) {
    // Invariant 7: offset 'reject' keeps the two 1:30ams of a fall-back night distinct
    // and refuses spring-forward wall times. An unparseable entry is skipped here --
    // the schema boundary (import/ops) is where it gets *reported*.
    let start: Temporal.ZonedDateTime
    try {
      start = Temporal.ZonedDateTime.from(e.start, { offset: 'reject' })
    } catch {
      continue
    }
    const s = gridSlot(start)

    let kind: MarkKind
    let endSlot = s
    if (e.end !== undefined) {
      let end: Temporal.ZonedDateTime
      try {
        end = Temporal.ZonedDateTime.from(e.end, { offset: 'reject' })
      } catch {
        continue
      }
      endSlot = Math.max(gridSlot(end), s)
      // Zero-duration is an instant, same reading as the scribcal import heuristics.
      kind = endSlot > s ? MarkKind.Interval : MarkKind.Instant
    } else if (typeOf.get(e.trackId) === ValueType.Interval) {
      // Started but not stopped: ongoing until `now`. Clamped so a stale ongoing entry
      // cannot run past the visible range's outer edge.
      kind = MarkKind.Ongoing
      endSlot = Math.max(s, Math.min(nowGrid, gridEnd))
    } else {
      kind = MarkKind.Instant
    }

    // Visibility: instants must land on a day in range; spans must intersect it (an
    // interval that started before the range still shows its in-range part).
    if (kind === MarkKind.Instant) {
      if (s < 0 || s >= gridEnd) continue
    } else if (endSlot <= 0 || s >= gridEnd) {
      continue
    }

    marks.push({
      entryId: e.id,
      trackId: e.trackId,
      color: colorOf.get(e.trackId) ?? '#888',
      kind,
      startSlot: s,
      endSlot,
      depth: 0,
    })
  }

  const intervals = marks.filter((m) => m.kind !== MarkKind.Instant)
  const depths = containmentDepth(intervals)
  intervals.forEach((m, i) => {
    m.depth = depths[i] ?? 0
  })

  const dayModels: DayModel[] = days.map((day, index) => {
    const segments: DaySegment[] = []
    const ticks: Mark[] = []
    for (const m of marks) {
      if (m.kind === MarkKind.Instant) {
        if (Math.floor(m.startSlot / 24) === index) ticks.push(m)
        continue
      }
      const from = Math.max(m.startSlot, index * 24)
      const to = Math.min(m.endSlot, (index + 1) * 24)
      if (to > from) segments.push({ mark: m, from: from - index * 24, to: to - index * 24 })
    }
    return {
      day,
      index,
      daylight: daylightSegments(day.date, range.tz, range.lat, range.lng),
      segments,
      ticks,
    }
  })

  return { days: dayModels, marks, nowSlot, nowDay, now }
}

/** Which facet the views emphasize; everything else dims but never disappears. */
export const Emphasis = {
  All: 'all',
  Now: 'now',
  Instants: 'instants',
  Durations: 'durations',
} as const
export type Emphasis = (typeof Emphasis)[keyof typeof Emphasis]

export function dimmed(kind: MarkKind, e: Emphasis): boolean {
  if (e === Emphasis.All) return false
  if (e === Emphasis.Now) return kind !== MarkKind.Ongoing
  if (e === Emphasis.Instants) return kind !== MarkKind.Instant
  return kind !== MarkKind.Interval
}
