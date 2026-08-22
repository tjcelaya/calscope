import { Temporal } from 'temporal-polyfill'
import type { GcalEvent } from './types.js'
import { GcalEventStatus } from './types.js'

/**
 * Back-catalogue era classifier. Scribcal-written events live in the primary calendar
 * mixed with real appointments, across several marking eras; this reports what is
 * actually found so the user can decide what to import. Deliberately NO date cutoffs --
 * era boundaries are the user's call, not ours.
 */

export const Era = {
  /** Oldest era: `[S] EVENTNAME` title prefix. */
  Bracket: 'bracket-prefix',
  /** Middle era: `. EVENTNAME` title prefix (leading dot + space). */
  Dot: 'dot-prefix',
  /** Recent era: `[source:scribcal]` line in the description. */
  SourceTag: 'source-tag',
  /** Corroborator: DTSTART == DTEND. Normal events are essentially never zero-length. */
  ZeroDuration: 'zero-duration',
  /** Weak corroborator: every event sharing a title also shares one colour. */
  ColorCluster: 'color-cluster',
} as const
export type Era = (typeof Era)[keyof typeof Era]

/** Emission order for `eras[]` -- strongest marker first, deterministic for callers. */
const ERA_ORDER: Era[] = [Era.Bracket, Era.Dot, Era.SourceTag, Era.ZeroDuration, Era.ColorCluster]

export const BRACKET_PREFIX = '[S] '
export const DOT_PREFIX = '. '
export const SCRIBCAL_SOURCE_TAG = '[source:scribcal]'

export type StrippedTitle = {
  title: string
  era?: typeof Era.Bracket | typeof Era.Dot
}

/**
 * Strip one era prefix, remembering which. The raw form is what goes into
 * `Track.legacyTitles`, so a re-import matches the historic titles and stays idempotent.
 */
export function stripMarkerPrefix(rawTitle: string): StrippedTitle {
  if (rawTitle.startsWith(BRACKET_PREFIX)) {
    return { title: rawTitle.slice(BRACKET_PREFIX.length), era: Era.Bracket }
  }
  if (rawTitle.startsWith(DOT_PREFIX)) {
    return { title: rawTitle.slice(DOT_PREFIX.length), era: Era.Dot }
  }
  return { title: rawTitle }
}

export type EraStats = {
  count: number
  /** Raw `start` values (date or dateTime) of the earliest/latest matching event. */
  first?: string
  last?: string
}

export type TitleCluster = {
  /** Prefix-stripped title -- the cluster key. */
  title: string
  count: number
  first?: string
  last?: string
  eras: Era[]
  /** Raw title variants that differ from the stripped title -- Track.legacyTitles input. */
  legacyTitles: string[]
  /** colorId -> occurrence count; the colour-cluster corroborator's evidence. */
  colorIds: Record<string, number>
}

export type Classification = {
  eras: Record<Era, EraStats>
  clusters: TitleCluster[]
  /** All events seen, including cancelled stubs. */
  total: number
  cancelled: number
  /** Events matching no marker and no corroborator -- presumably real appointments. */
  unmarked: number
}

type ClusterAcc = {
  title: string
  count: number
  eraless: number
  first?: string
  last?: string
  firstKey?: number
  lastKey?: number
  eras: Set<Era>
  legacyTitles: Set<string>
  colorIds: Map<string, number>
  withColor: number
}

type EraAcc = EraStats & { firstKey?: number; lastKey?: number }

/** Approximate ordering key for date ranges in the report; all-day sorts at UTC midnight. */
function sortKey(event: GcalEvent): { raw: string; key: number } | undefined {
  const s = event.start
  if (s === undefined) return undefined
  if ('dateTime' in s) {
    try {
      return { raw: s.dateTime, key: Temporal.Instant.from(s.dateTime).epochMilliseconds }
    } catch {
      return undefined
    }
  }
  try {
    const pd = Temporal.PlainDate.from(s.date)
    return { raw: s.date, key: Date.UTC(pd.year, pd.month - 1, pd.day) }
  } catch {
    return undefined
  }
}

function isZeroDuration(event: GcalEvent): boolean {
  const s = event.start
  const e = event.end
  if (s === undefined || e === undefined || !('dateTime' in s) || !('dateTime' in e)) return false
  if (s.dateTime === e.dateTime) return true
  try {
    return Temporal.Instant.from(s.dateTime).equals(Temporal.Instant.from(e.dateTime))
  } catch {
    return false
  }
}

export function classify(events: GcalEvent[]): Classification {
  const eraAcc: Record<Era, EraAcc> = {
    [Era.Bracket]: { count: 0 },
    [Era.Dot]: { count: 0 },
    [Era.SourceTag]: { count: 0 },
    [Era.ZeroDuration]: { count: 0 },
    [Era.ColorCluster]: { count: 0 },
  }
  const clusters = new Map<string, ClusterAcc>()
  let cancelled = 0

  const touch = (acc: EraAcc | ClusterAcc, at: { raw: string; key: number } | undefined) => {
    if (at === undefined) return
    if (acc.firstKey === undefined || at.key < acc.firstKey) {
      acc.firstKey = at.key
      acc.first = at.raw
    }
    if (acc.lastKey === undefined || at.key > acc.lastKey) {
      acc.lastKey = at.key
      acc.last = at.raw
    }
  }

  for (const event of events) {
    if (event.status === GcalEventStatus.Cancelled) {
      cancelled += 1
      continue
    }
    const rawTitle = event.summary ?? '(untitled)'
    const stripped = stripMarkerPrefix(rawTitle)
    const at = sortKey(event)

    const eventEras = new Set<Era>()
    if (stripped.era !== undefined) eventEras.add(stripped.era)
    if (event.description !== undefined && event.description.includes(SCRIBCAL_SOURCE_TAG)) {
      eventEras.add(Era.SourceTag)
    }
    if (isZeroDuration(event)) eventEras.add(Era.ZeroDuration)

    for (const era of eventEras) {
      const acc = eraAcc[era]
      acc.count += 1
      touch(acc, at)
    }

    let cluster = clusters.get(stripped.title)
    if (cluster === undefined) {
      cluster = {
        title: stripped.title,
        count: 0,
        eraless: 0,
        eras: new Set(),
        legacyTitles: new Set(),
        colorIds: new Map(),
        withColor: 0,
      }
      clusters.set(stripped.title, cluster)
    }
    cluster.count += 1
    if (eventEras.size === 0) cluster.eraless += 1
    for (const era of eventEras) cluster.eras.add(era)
    if (rawTitle !== stripped.title) cluster.legacyTitles.add(rawTitle)
    if (event.colorId !== undefined) {
      cluster.colorIds.set(event.colorId, (cluster.colorIds.get(event.colorId) ?? 0) + 1)
      cluster.withColor += 1
    }
    touch(cluster, at)
  }

  // Colour clustering is a property of the whole cluster, so it needs a second pass: a
  // cluster corroborates only when >=2 events ALL share one colour.
  let unmarked = 0
  for (const cluster of clusters.values()) {
    const colorClustered =
      cluster.count >= 2 && cluster.colorIds.size === 1 && cluster.withColor === cluster.count
    if (colorClustered) {
      cluster.eras.add(Era.ColorCluster)
      const acc = eraAcc[Era.ColorCluster]
      acc.count += cluster.count
      if (cluster.first !== undefined && cluster.firstKey !== undefined) {
        touch(acc, { raw: cluster.first, key: cluster.firstKey })
      }
      if (cluster.last !== undefined && cluster.lastKey !== undefined) {
        touch(acc, { raw: cluster.last, key: cluster.lastKey })
      }
    } else {
      unmarked += cluster.eraless
    }
  }

  const emitEra = (acc: EraAcc): EraStats => {
    const out: EraStats = { count: acc.count }
    if (acc.first !== undefined) out.first = acc.first
    if (acc.last !== undefined) out.last = acc.last
    return out
  }

  const emittedClusters: TitleCluster[] = [...clusters.values()]
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .map((c) => {
      const out: TitleCluster = {
        title: c.title,
        count: c.count,
        eras: ERA_ORDER.filter((era) => c.eras.has(era)),
        legacyTitles: [...c.legacyTitles].sort(),
        colorIds: Object.fromEntries(c.colorIds),
      }
      if (c.first !== undefined) out.first = c.first
      if (c.last !== undefined) out.last = c.last
      return out
    })

  return {
    eras: {
      [Era.Bracket]: emitEra(eraAcc[Era.Bracket]),
      [Era.Dot]: emitEra(eraAcc[Era.Dot]),
      [Era.SourceTag]: emitEra(eraAcc[Era.SourceTag]),
      [Era.ZeroDuration]: emitEra(eraAcc[Era.ZeroDuration]),
      [Era.ColorCluster]: emitEra(eraAcc[Era.ColorCluster]),
    },
    clusters: emittedClusters,
    total: events.length,
    cancelled,
    unmarked,
  }
}
