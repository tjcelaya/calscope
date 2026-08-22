import {
  Era,
  GcalEventStatus,
  dominantColorId,
  hexForColorId,
  mapEvents,
  stripMarkerPrefix,
  type GcalCalendarListEntry,
  type GcalEvent,
  type MapReject,
  type TitleCluster,
} from '@calscope/gcal'
import { ValueType, type Op, type Track } from '../core'
import { upsertEntry, upsertTrack, deleteEntry, type OpStamp } from '../persist'

/**
 * Pure glue between the dry-run classification and the op log: per-cluster mapping
 * decisions in, Track/Entry upsert ops out. No solid-js here -- this is the module the
 * vitest covers, and the component is a thin shell over it.
 */

export const ClusterTarget = {
  /** Create (or LWW-refresh) a track derived from the cluster. The default. */
  NewTrack: 'new',
  Existing: 'existing',
  Skip: 'skip',
} as const
export type ClusterTarget = (typeof ClusterTarget)[keyof typeof ClusterTarget]

export type ClusterDecision =
  | { target: typeof ClusterTarget.NewTrack; name: string }
  | { target: typeof ClusterTarget.Existing; trackId: string }
  | { target: typeof ClusterTarget.Skip }

/**
 * Must mirror classify()'s clustering key exactly, or a decision made on the report
 * would not apply to the event it described. (mapEvents' own strippedTitle defaults the
 * missing summary to '' -- a different convention -- so routing recomputes from here.)
 */
export function clusterKeyFor(event: GcalEvent): string {
  return stripMarkerPrefix(event.summary ?? '(untitled)').title
}

/**
 * Deterministic track id from the cluster key, so a re-import that picks "new track"
 * again upserts the SAME track under LWW instead of minting a duplicate -- the same
 * dedupe shape as `entryIdForEvent` gives entries.
 */
export function newTrackId(clusterTitle: string): string {
  return `gcal:track:${clusterTitle}`
}

/**
 * Default mapping for a cluster: an existing track that already claims the title (by
 * name or legacyTitles) wins; otherwise era-marked clusters default to a new track and
 * unmarked ones -- presumably real appointments -- default to Skip. The user overrides
 * per row; nothing imports until they press the button.
 */
export function defaultDecision(cluster: TitleCluster, tracks: readonly Track[]): ClusterDecision {
  for (const track of tracks) {
    const legacy = track.legacyTitles ?? []
    const claims =
      track.name === cluster.title ||
      legacy.includes(cluster.title) ||
      cluster.legacyTitles.some((raw) => legacy.includes(raw))
    if (claims) return { target: ClusterTarget.Existing, trackId: track.id }
  }
  if (cluster.eras.length > 0) return { target: ClusterTarget.NewTrack, name: cluster.title }
  return { target: ClusterTarget.Skip }
}

/** Same palette family as the capture panel; hashed so a re-import keeps its color. */
const TRACK_COLORS = ['#6c7bff', '#d98b45', '#3fa7a0', '#8faa4b', '#c2557a', '#8f6cc4']

/**
 * The color the user actually gave the events wins: the cluster's dominant Google
 * colorId, translated through the same 1-11 index scribcal wrote with. Only clusters
 * with no colored events fall back to the hash palette.
 */
function colorFor(cluster: TitleCluster): string {
  const fromGcal = hexForColorId(dominantColorId(cluster.colorIds))
  if (fromGcal !== undefined) return fromGcal
  let hash = 0
  for (let i = 0; i < cluster.title.length; i++) hash = (hash * 31 + cluster.title.charCodeAt(i)) | 0
  return TRACK_COLORS[Math.abs(hash) % TRACK_COLORS.length]!
}

export type ImportPlanInput = {
  clusters: readonly TitleCluster[]
  decisions: Readonly<Record<string, ClusterDecision>>
  calendars: readonly GcalCalendarListEntry[]
  eventsByCalendar: Readonly<Record<string, readonly GcalEvent[]>>
  tracks: readonly Track[]
  /**
   * Ids of entries currently in the fold. Cancelled events only produce delete ops for
   * entries that actually exist locally -- tombstoning never-imported ids would bloat
   * the log for nothing.
   */
  existingEntryIds: ReadonlySet<string>
  /** Explicit clock/actor for tests; app code omits it (see persist/ops). */
  stamp?: OpStamp
}

export type ImportPlan = {
  /** Track upserts first, then entry upserts, then deletes. */
  ops: Op[]
  trackCount: number
  entryCount: number
  deletionCount: number
  skippedTitles: string[]
  /** Mapper rejects for the events actually selected for import. */
  rejects: MapReject[]
}

/**
 * Turn decisions into ops. Entry ids derive from gcal event ids inside mapEvents, so
 * running the result through the op log twice converges to the same folded state.
 */
export function buildImportOps(input: ImportPlanInput): ImportPlan {
  const trackIdByTitle = new Map<string, string>()
  const skippedTitles: string[] = []
  const ops: Op[] = []
  let trackCount = 0

  for (const cluster of input.clusters) {
    const decision = input.decisions[cluster.title] ?? { target: ClusterTarget.Skip }
    switch (decision.target) {
      case ClusterTarget.Skip:
        skippedTitles.push(cluster.title)
        break
      case ClusterTarget.NewTrack: {
        const id = newTrackId(cluster.title)
        const name = decision.name.trim() === '' ? cluster.title : decision.name.trim()
        // Zero-duration is the strong "this is a logged moment, not an appointment"
        // signal, and the acceptance criteria demand it lands as Binary.
        const valueType = cluster.eras.includes(Era.ZeroDuration)
          ? ValueType.Binary
          : ValueType.Interval
        const track: Track = {
          id,
          name,
          valueType,
          tags: [],
          color: colorFor(cluster),
        }
        if (cluster.legacyTitles.length > 0) track.legacyTitles = [...cluster.legacyTitles]
        ops.push(upsertTrack(track, input.stamp))
        trackCount += 1
        trackIdByTitle.set(cluster.title, id)
        break
      }
      case ClusterTarget.Existing: {
        const track = input.tracks.find((t) => t.id === decision.trackId)
        if (track === undefined) {
          // A stale dropdown selection (track deleted between render and import) must
          // not silently import onto a dangling id.
          skippedTitles.push(cluster.title)
          break
        }
        // Fold the cluster's raw title variants into legacyTitles so the NEXT re-import
        // defaults this cluster onto the same track; only write when something changed.
        const legacy = new Set(track.legacyTitles ?? [])
        const before = legacy.size
        for (const raw of cluster.legacyTitles) legacy.add(raw)
        if (track.name !== cluster.title) legacy.add(cluster.title)
        if (legacy.size !== before) {
          ops.push(upsertTrack({ ...track, legacyTitles: [...legacy].sort() }, input.stamp))
        }
        trackIdByTitle.set(cluster.title, track.id)
        break
      }
    }
  }

  let entryCount = 0
  let deletionCount = 0
  const rejects: MapReject[] = []

  for (const calendar of input.calendars) {
    const events = input.eventsByCalendar[calendar.id] ?? []
    // Cancelled stubs pass through: they carry no usable title, and mapEvents turns
    // them into deletions keyed purely by event id.
    const selected = events.filter(
      (e) => e.status === GcalEventStatus.Cancelled || trackIdByTitle.has(clusterKeyFor(e)),
    )
    const mapped = mapEvents(selected, calendar, {
      trackIdFor: (event) => trackIdByTitle.get(clusterKeyFor(event))!,
    })
    for (const entry of mapped.entries) {
      ops.push(upsertEntry(entry, input.stamp))
      entryCount += 1
    }
    for (const id of mapped.deletions) {
      if (input.existingEntryIds.has(id)) {
        ops.push(deleteEntry(id, input.stamp))
        deletionCount += 1
      }
    }
    rejects.push(...mapped.rejects)
  }

  return { ops, trackCount, entryCount, deletionCount, skippedTitles, rejects }
}
