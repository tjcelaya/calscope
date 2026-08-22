import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { ValueType } from '../src/model/enums.js'
import type { Entry, Track } from '../src/model/types.js'
import { expandGapFill } from '../src/model/gapfill.js'

const sleep: Track = {
  id: 'sleep',
  name: 'Sleep',
  valueType: ValueType.Binary,
  tags: [],
  color: '#6c7bff',
  fillsGapBefore: true,
}
const read: Track = { id: 'read', name: 'Read', valueType: ValueType.Interval, tags: [], color: '#c2557a' }
const coffee: Track = { id: 'coffee', name: 'Coffee', valueType: ValueType.Binary, tags: [], color: '#d98b45' }
const tracks = [sleep, read, coffee]

const NY = 'America/New_York'
const zdt = (iso: string) => `${iso}[${NY}]`

describe('expandGapFill', () => {
  it('a sleep instant logged at wake-up claims the span back to the previous interval end', () => {
    const entries: Entry[] = [
      { id: 'e-read', trackId: 'read', start: zdt('2026-01-05T22:00:00-05:00'), end: zdt('2026-01-05T23:30:00-05:00') },
      { id: 'e-sleep', trackId: 'sleep', start: zdt('2026-01-06T07:00:00-05:00') },
    ]
    const [, expanded] = expandGapFill(entries, tracks)
    expect(expanded!.start).toBe(zdt('2026-01-05T23:30:00-05:00'))
    expect(expanded!.end).toBe(zdt('2026-01-06T07:00:00-05:00'))
  })

  it('an instant on another track counts as a predecessor at its own moment', () => {
    const entries: Entry[] = [
      { id: 'e-coffee', trackId: 'coffee', start: zdt('2026-01-06T06:00:00-05:00') },
      { id: 'e-sleep', trackId: 'sleep', start: zdt('2026-01-06T08:00:00-05:00') },
    ]
    const [, expanded] = expandGapFill(entries, tracks)
    expect(expanded!.start).toBe(zdt('2026-01-06T06:00:00-05:00'))
  })

  it('the LATEST preceding end wins, and ongoing entries are never predecessors', () => {
    const entries: Entry[] = [
      { id: 'e-old', trackId: 'read', start: zdt('2026-01-05T20:00:00-05:00'), end: zdt('2026-01-05T21:00:00-05:00') },
      { id: 'e-late', trackId: 'read', start: zdt('2026-01-05T22:00:00-05:00'), end: zdt('2026-01-05T23:00:00-05:00') },
      // Ongoing (Interval track, no end): its end is unknowable, so it must be skipped.
      { id: 'e-open', trackId: 'read', start: zdt('2026-01-06T01:00:00-05:00') },
      { id: 'e-sleep', trackId: 'sleep', start: zdt('2026-01-06T07:00:00-05:00') },
    ]
    const out = expandGapFill(entries, tracks)
    expect(out.find((e) => e.id === 'e-sleep')!.start).toBe(zdt('2026-01-05T23:00:00-05:00'))
  })

  it('with no predecessor, or a predecessor that touches/overlaps, the entry is unchanged', () => {
    const alone: Entry[] = [{ id: 'e-sleep', trackId: 'sleep', start: zdt('2026-01-06T07:00:00-05:00') }]
    expect(expandGapFill(alone, tracks)[0]).toEqual(alone[0])

    const touching: Entry[] = [
      { id: 'e-read', trackId: 'read', start: zdt('2026-01-06T06:00:00-05:00'), end: zdt('2026-01-06T07:00:00-05:00') },
      { id: 'e-sleep', trackId: 'sleep', start: zdt('2026-01-06T07:00:00-05:00') },
    ]
    expect(expandGapFill(touching, tracks)[1]).toEqual(touching[1])
  })

  it('consecutive gap-fill entries chain off each other’s literal moments', () => {
    const entries: Entry[] = [
      { id: 'nap', trackId: 'sleep', start: zdt('2026-01-06T14:00:00-05:00') },
      { id: 'night', trackId: 'sleep', start: zdt('2026-01-07T07:00:00-05:00') },
    ]
    const out = expandGapFill(entries, tracks)
    expect(out.find((e) => e.id === 'night')!.start).toBe(zdt('2026-01-06T14:00:00-05:00'))
  })

  it('an ongoing entry on a gap-fill Interval track moves its start but stays ongoing', () => {
    const sleepSpan: Track = { ...sleep, id: 'sleep-span', valueType: ValueType.Interval }
    const entries: Entry[] = [
      { id: 'e-read', trackId: 'read', start: zdt('2026-01-05T22:00:00-05:00'), end: zdt('2026-01-05T23:00:00-05:00') },
      { id: 'e-open', trackId: 'sleep-span', start: zdt('2026-01-06T00:30:00-05:00') },
    ]
    const out = expandGapFill(entries, [...tracks, sleepSpan])
    const open = out.find((e) => e.id === 'e-open')!
    expect(open.start).toBe(zdt('2026-01-05T23:00:00-05:00'))
    expect(open.end).toBeUndefined()
  })

  it('a cross-zone predecessor lands in the entry’s own zone at the same instant', () => {
    const entries: Entry[] = [
      { id: 'e-read', trackId: 'read', start: '2026-01-05T19:00:00-08:00[America/Los_Angeles]', end: '2026-01-05T20:30:00-08:00[America/Los_Angeles]' },
      { id: 'e-sleep', trackId: 'sleep', start: zdt('2026-01-06T07:00:00-05:00') },
    ]
    const [, expanded] = expandGapFill(entries, tracks)
    // 20:30 LA == 23:30 NY, expressed in the sleep entry's zone.
    expect(expanded!.start).toBe(zdt('2026-01-05T23:30:00-05:00'))
    expect(Temporal.ZonedDateTime.from(expanded!.start).timeZoneId).toBe(NY)
  })

  it('is the identity when no track fills gaps, and never touches other tracks', () => {
    const plain = tracks.map((t) => {
      const { fillsGapBefore: _drop, ...rest } = t
      return rest
    })
    const entries: Entry[] = [
      { id: 'e-read', trackId: 'read', start: zdt('2026-01-05T22:00:00-05:00'), end: zdt('2026-01-05T23:30:00-05:00') },
      { id: 'e-sleep', trackId: 'sleep', start: zdt('2026-01-06T07:00:00-05:00') },
    ]
    expect(expandGapFill(entries, plain)).toEqual(entries)
    const out = expandGapFill(entries, tracks)
    expect(out.find((e) => e.id === 'e-read')).toEqual(entries[0])
  })
})
