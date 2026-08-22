import { Temporal } from 'temporal-polyfill'
import { ValueType } from './enums.js'
import type { Entry, Track } from './types.js'

/**
 * Gap-fill derivation for tracks with `fillsGapBefore` (the sleep pattern): an entry on
 * such a track claims the span from the previous event's end up to its own moment, so a
 * single instant logged at wake-up becomes the whole night.
 *
 * A DERIVATION, deliberately: the stored entry stays the captured instant, and the
 * expansion is recomputed here from whatever entries currently exist. Rewriting the
 * stored start instead would bake one neighbour-set into the op log and go stale the
 * moment an earlier event is imported, edited, or deleted.
 *
 * "Previous event's end" is the latest occupied moment across ALL tracks at or before
 * the entry's start: a completed interval's end, or an instant's moment. Ongoing entries
 * (Interval track, no end yet) are skipped -- their end is unknowable. When nothing
 * precedes the entry, or the previous end already touches or overlaps it, the entry is
 * returned unchanged.
 */
export function expandGapFill(entries: readonly Entry[], tracks: readonly Track[]): Entry[] {
  const fills = new Set(tracks.filter((t) => t.fillsGapBefore === true).map((t) => t.id))
  if (fills.size === 0) return [...entries]
  const typeOf = new Map(tracks.map((t) => [t.id, t.valueType]))

  const parse = (iso: string): Temporal.ZonedDateTime | undefined => {
    // Invariant 7: same offset:'reject' reading as every other consumer of Entry.start.
    try {
      return Temporal.ZonedDateTime.from(iso, { offset: 'reject' })
    } catch {
      return undefined
    }
  }

  /** The literal moment an entry stops occupying time, or undefined for ongoing/unparseable. */
  const occupiedEnd = (e: Entry): Temporal.ZonedDateTime | undefined => {
    if (e.end !== undefined) return parse(e.end)
    if (typeOf.get(e.trackId) === ValueType.Interval) return undefined
    return parse(e.start)
  }

  return entries.map((entry) => {
    if (!fills.has(entry.trackId)) return entry
    const at = parse(entry.start)
    if (at === undefined) return entry

    let prevEnd: Temporal.ZonedDateTime | undefined
    for (const other of entries) {
      if (other.id === entry.id) continue
      // Predecessors are judged by their LITERAL times, gap-fill entries included --
      // expansion only ever grows an entry backward, so ends are stable under it.
      const end = occupiedEnd(other)
      if (end === undefined) continue
      if (Temporal.ZonedDateTime.compare(end, at) >= 0) continue
      if (prevEnd === undefined || Temporal.ZonedDateTime.compare(end, prevEnd) > 0) prevEnd = end
    }
    if (prevEnd === undefined) return entry

    // The derived span is expressed in the entry's own zone so day attribution follows
    // the capture context, not whichever zone the predecessor was recorded in.
    const expanded: Entry = { ...entry, start: prevEnd.withTimeZone(at.timeZoneId).toString() }
    // An instant closes at its captured moment; an ongoing interval keeps running.
    if (entry.end === undefined && typeOf.get(entry.trackId) !== ValueType.Interval) {
      expanded.end = entry.start
    }
    return expanded
  })
}
