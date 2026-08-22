import { describe, expect, it } from 'vitest'
import { buildDryRunReport, formatDryRunReport } from '../src/report.js'
import { Era } from '../src/classify.js'
import {
  classifyEvents,
  evCancelled,
  evSkippedHour,
  evTimedNoZone,
  evTimedWithZone,
  evUtcTimed,
  laCalendar,
  utcCalendar,
} from './fixtures.js'

const input = {
  calendars: [laCalendar, utcCalendar],
  eventsByCalendar: {
    'primary-la': [...classifyEvents, evTimedWithZone, evTimedNoZone, evSkippedHour, evCancelled],
    'ops-utc': [evUtcTimed],
  },
}

describe('buildDryRunReport', () => {
  it('combines per-calendar mapping outcomes with the era classification', () => {
    const report = buildDryRunReport(input)
    expect(report.calendars.map((c) => c.calendarId)).toEqual(['primary-la', 'ops-utc'])
    expect(report.calendars[0]?.timeZone).toBe('America/Los_Angeles')
    expect(report.calendars[1]?.timeZone).toBe('UTC')
    // classifyEvents: 11 events, 1 cancelled -> 10 entries; plus 2 mappable timed
    // events, 1 DST reject, and 1 more cancelled stub.
    expect(report.calendars[0]?.entryCount).toBe(12)
    expect(report.calendars[0]?.deletionCount).toBe(2)
    expect(report.calendars[0]?.rejects).toHaveLength(1)
    expect(report.calendars[1]?.entryCount).toBe(1)
    expect(report.totalEntries).toBe(13)
    expect(report.totalDeletions).toBe(2)
    expect(report.totalRejects).toBe(1)
  })

  it('carries mapper rejects verbatim so nothing is dropped silently', () => {
    const report = buildDryRunReport(input)
    expect(report.calendars[0]?.rejects[0]).toMatchObject({
      eventId: 'ev-skipped',
      raw: '2026-03-08T02:30:00-08:00',
    })
  })

  it('classifies across ALL calendars, cancelled stubs included', () => {
    const report = buildDryRunReport(input)
    expect(report.classification.total).toBe(15 + 1)
    expect(report.classification.cancelled).toBe(2)
    expect(report.classification.eras[Era.Bracket].count).toBe(3)
    expect(report.classification.eras[Era.Bracket].first).toBe('2015-03-02T08:00:00-08:00')
  })

  it('is pure and idempotent: same input, deep-equal report, input untouched', () => {
    const before = JSON.parse(JSON.stringify(input)) as unknown
    const a = buildDryRunReport(input)
    const b = buildDryRunReport(input)
    expect(a).toEqual(b)
    expect(JSON.parse(JSON.stringify(input))).toEqual(before)
  })

  it('a calendar with no fetched events reports zeros rather than failing', () => {
    const report = buildDryRunReport({ calendars: [utcCalendar], eventsByCalendar: {} })
    expect(report.calendars[0]).toMatchObject({ entryCount: 0, deletionCount: 0, rejects: [] })
  })
})

describe('formatDryRunReport', () => {
  it('renders eras, clusters, legacy titles and every skipped event', () => {
    const text = formatDryRunReport(buildDryRunReport(input))
    expect(text).toContain('dry-run (no data imported)')
    expect(text).toContain('TJ (personal) (primary-la) [tz: America/Los_Angeles]')
    expect(text).toContain('SKIPPED ev-skipped raw="2026-03-08T02:30:00-08:00"')
    expect(text).toContain('[S] prefix (oldest): 3')
    expect(text).toContain('legacy=[. Coffee, [S] Coffee]')
  })
})
