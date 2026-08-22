import type { GcalCalendarListEntry, GcalEvent } from './types.js'
import { classify, Era, type Classification } from './classify.js'
import { mapEvents, type MapOptions, type MapReject } from './map.js'

/**
 * Dry-run report: what WOULD an import do. Pure -- runs the classifier and the mapper
 * over already-fetched events and writes nothing, so it can run before any import and be
 * re-run for free. Mapper rejects surface here; a dropped event the user never saw is the
 * failure mode this exists to prevent.
 */

export type CalendarDryRun = {
  calendarId: string
  summary?: string
  timeZone?: string
  entryCount: number
  deletionCount: number
  rejects: MapReject[]
}

export type DryRunReport = {
  calendars: CalendarDryRun[]
  classification: Classification
  totalEntries: number
  totalDeletions: number
  totalRejects: number
}

export type DryRunInput = {
  calendars: GcalCalendarListEntry[]
  eventsByCalendar: Record<string, GcalEvent[]>
  mapOptions?: MapOptions
}

export function buildDryRunReport(input: DryRunInput): DryRunReport {
  const perCalendar: CalendarDryRun[] = []
  const allEvents: GcalEvent[] = []

  for (const calendar of input.calendars) {
    const events = input.eventsByCalendar[calendar.id] ?? []
    allEvents.push(...events)
    const mapped = mapEvents(events, calendar, input.mapOptions ?? {})
    const row: CalendarDryRun = {
      calendarId: calendar.id,
      entryCount: mapped.entries.length,
      deletionCount: mapped.deletions.length,
      rejects: mapped.rejects,
    }
    if (calendar.summary !== undefined) row.summary = calendar.summary
    if (calendar.timeZone !== undefined) row.timeZone = calendar.timeZone
    perCalendar.push(row)
  }

  return {
    calendars: perCalendar,
    classification: classify(allEvents),
    totalEntries: perCalendar.reduce((n, c) => n + c.entryCount, 0),
    totalDeletions: perCalendar.reduce((n, c) => n + c.deletionCount, 0),
    totalRejects: perCalendar.reduce((n, c) => n + c.rejects.length, 0),
  }
}

const ERA_LABELS: Record<Era, string> = {
  [Era.Bracket]: '[S] prefix (oldest)',
  [Era.Dot]: '. prefix (middle)',
  [Era.SourceTag]: '[source:scribcal] (recent)',
  [Era.ZeroDuration]: 'zero-duration (corroborator)',
  [Era.ColorCluster]: 'color cluster (weak corroborator)',
}

/** Human-readable rendering of the same data; contains nothing the structure does not. */
export function formatDryRunReport(report: DryRunReport): string {
  const lines: string[] = []
  lines.push('Google Calendar dry-run (no data imported)')
  lines.push('')
  for (const cal of report.calendars) {
    const name = cal.summary !== undefined ? `${cal.summary} (${cal.calendarId})` : cal.calendarId
    lines.push(`Calendar ${name} [tz: ${cal.timeZone ?? 'MISSING'}]`)
    lines.push(
      `  would import ${cal.entryCount} entries, delete ${cal.deletionCount}, ` +
        `skip ${cal.rejects.length}`,
    )
    for (const reject of cal.rejects) {
      lines.push(`  SKIPPED ${reject.eventId} raw=${JSON.stringify(reject.raw)}: ${reject.reason}`)
    }
  }
  lines.push('')
  const c = report.classification
  lines.push(`Eras (${c.total} events seen, ${c.cancelled} cancelled, ${c.unmarked} unmarked):`)
  for (const era of Object.values(Era)) {
    const stats = c.eras[era]
    const range =
      stats.first !== undefined && stats.last !== undefined
        ? ` (${stats.first} .. ${stats.last})`
        : ''
    lines.push(`  ${ERA_LABELS[era]}: ${stats.count}${range}`)
  }
  lines.push('')
  lines.push('Title clusters:')
  for (const cluster of c.clusters) {
    const range =
      cluster.first !== undefined && cluster.last !== undefined
        ? ` (${cluster.first} .. ${cluster.last})`
        : ''
    const eras = cluster.eras.length > 0 ? ` eras=[${cluster.eras.join(', ')}]` : ''
    const legacy =
      cluster.legacyTitles.length > 0 ? ` legacy=[${cluster.legacyTitles.join(', ')}]` : ''
    lines.push(`  ${cluster.title}: ${cluster.count}${range}${eras}${legacy}`)
  }
  return lines.join('\n')
}
