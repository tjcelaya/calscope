import { Temporal } from 'temporal-polyfill'
import { type DstPolicy, type VirtualDay, slotPosition, virtualDay } from '@calscope/views'
import { daylightSegments, type DaylightSeg } from './daylight'
import { LAT, LNG, TIME_ZONE, generate, simulatedNow, tracks } from './fake-data'

/**
 * One day-model, three projections. Every view -- radial, day columns, year grid --
 * renders from this same structure, so cross-view consistency is checkable by eye and
 * the structure itself is the prototype of M2's shared ViewModel contract.
 */
export const trackColor = new Map(tracks.map((t) => [t.id, t.color]))

export const MarkKind = {
  Instant: 'instant',
  Interval: 'interval',
  Ongoing: 'ongoing',
} as const
export type MarkKind = (typeof MarkKind)[keyof typeof MarkKind]

export type SpikeMark = {
  trackId: string
  color: string
  kind: MarkKind
  /** Grid slots: hours from day 0's midnight. Equal for instants. */
  startSlot: number
  endSlot: number
  /** Containment depth: strictly-longer intervals fully containing this one. */
  depth: number
}

/** A mark's share of one day, in within-day slots. Intervals crossing midnight split. */
export type DaySegment = { mark: SpikeMark; from: number; to: number }

export type SpikeDay = {
  day: VirtualDay
  index: number
  daylight: DaylightSeg[]
  segments: DaySegment[]
  ticks: SpikeMark[]
}

export type SpikeModel = {
  days: SpikeDay[]
  marks: SpikeMark[]
  nowSlot: number
  nowDay: number
  now: Temporal.ZonedDateTime
}

export function buildModel(start: Temporal.PlainDate, count: number, policy: DstPolicy): SpikeModel {
  const days = Array.from({ length: count }, (_, i) =>
    virtualDay(start.add({ days: i }), TIME_ZONE, policy),
  )
  const entries = generate(start, count)
  const now = simulatedNow(start, count)
  const nowSlot = slotPosition(now)
  const nowDay = count - 1

  const marks: SpikeMark[] = []
  for (const e of entries) {
    const di = days.findIndex((d) => d.date.equals(e.start.toPlainDate()))
    if (di < 0) continue
    const s = di * 24 + slotPosition(e.start)
    const kind = e.ongoing ? MarkKind.Ongoing : e.endHours === 0 ? MarkKind.Instant : MarkKind.Interval
    const endSlot =
      kind === MarkKind.Ongoing ? di * 24 + nowSlot : kind === MarkKind.Instant ? s : s + e.endHours
    marks.push({
      trackId: e.trackId,
      color: trackColor.get(e.trackId) ?? '#888',
      kind,
      startSlot: s,
      endSlot,
      depth: 0,
    })
  }

  // Containment depth over grid spans -- deterministic and order-independent.
  const intervals = marks.filter((m) => m.kind !== MarkKind.Instant)
  for (const a of intervals) {
    a.depth = intervals.filter(
      (b) =>
        b !== a &&
        b.startSlot <= a.startSlot &&
        a.endSlot <= b.endSlot &&
        b.endSlot - b.startSlot > a.endSlot - a.startSlot,
    ).length
  }

  const dayModels: SpikeDay[] = days.map((day, index) => {
    const segments: DaySegment[] = []
    const ticks: SpikeMark[] = []
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
      daylight: daylightSegments(day.date, TIME_ZONE, LAT, LNG),
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

/** Which end of the radius the newest day occupies. */
export const RingOrder = {
  NewestOut: 'newest-out',
  NewestIn: 'newest-in',
} as const
export type RingOrder = (typeof RingOrder)[keyof typeof RingOrder]
