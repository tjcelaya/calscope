import { describe, expect, it } from 'vitest'
import { classify, Era, stripMarkerPrefix } from '../src/classify.js'
import { classifyEvents } from './fixtures.js'

function cluster(title: string) {
  const found = classify(classifyEvents).clusters.find((c) => c.title === title)
  if (found === undefined) throw new Error(`no cluster for ${title}`)
  return found
}

describe('stripMarkerPrefix', () => {
  it('strips the bracket era prefix and remembers the era', () => {
    expect(stripMarkerPrefix('[S] Coffee')).toEqual({ title: 'Coffee', era: Era.Bracket })
  })

  it('strips the dot era prefix (leading dot + space)', () => {
    expect(stripMarkerPrefix('. Meds')).toEqual({ title: 'Meds', era: Era.Dot })
  })

  it('leaves unmarked titles alone, including dots that are not the marker', () => {
    expect(stripMarkerPrefix('Coffee')).toEqual({ title: 'Coffee' })
    expect(stripMarkerPrefix('.hidden')).toEqual({ title: '.hidden' })
    expect(stripMarkerPrefix('v1.2 release')).toEqual({ title: 'v1.2 release' })
  })
})

describe('per-era counts and date ranges', () => {
  const result = classify(classifyEvents)

  it('counts the bracket era with its full date range -- no date cutoff applied', () => {
    expect(result.eras[Era.Bracket]).toEqual({
      count: 2,
      first: '2015-03-02T08:00:00-08:00',
      last: '2016-01-10T09:00:00-08:00',
    })
  })

  it('counts the dot era across titles', () => {
    expect(result.eras[Era.Dot]).toEqual({
      count: 3,
      first: '2019-05-04T07:30:00-07:00',
      last: '2020-02-03T21:00:00-08:00',
    })
  })

  it('counts the source-tag era from the description marker', () => {
    expect(result.eras[Era.SourceTag].count).toBe(1)
    expect(result.eras[Era.SourceTag].first).toBe('2024-11-20T08:15:00-08:00')
  })

  it('counts zero-duration corroborators', () => {
    expect(result.eras[Era.ZeroDuration].count).toBe(4)
  })

  it('counts colour-clustered events (all events of a repeated title share one colour)', () => {
    // Coffee (4 @ '5') + Read (2 @ '3') + Focus block (2 @ '9')
    expect(result.eras[Era.ColorCluster].count).toBe(8)
  })

  it('reports totals, cancelled stubs and genuinely unmarked events', () => {
    expect(result.total).toBe(classifyEvents.length)
    expect(result.cancelled).toBe(1)
    // Dentist + Vacation: no marker, no corroborator.
    expect(result.unmarked).toBe(2)
  })
})

describe('title clusters', () => {
  it('clusters on the STRIPPED title across all marking eras', () => {
    const coffee = cluster('Coffee')
    expect(coffee.count).toBe(4)
    expect(coffee.first).toBe('2015-03-02T08:00:00-08:00')
    expect(coffee.last).toBe('2024-11-20T08:15:00-08:00')
  })

  it('records the raw prefixed variants for Track.legacyTitles', () => {
    expect(cluster('Coffee').legacyTitles).toEqual(['. Coffee', '[S] Coffee'])
    expect(cluster('Read').legacyTitles).toEqual(['. Read'])
    expect(cluster('Focus block').legacyTitles).toEqual([])
  })

  it('lists every era found for a cluster, strongest first', () => {
    expect(cluster('Coffee').eras).toEqual([
      Era.Bracket,
      Era.Dot,
      Era.SourceTag,
      Era.ZeroDuration,
      Era.ColorCluster,
    ])
    expect(cluster('Read').eras).toEqual([Era.Dot, Era.ColorCluster])
  })

  it('a repeated unmarked title with one consistent colour gets ONLY the weak corroborator', () => {
    const focus = cluster('Focus block')
    expect(focus.eras).toEqual([Era.ColorCluster])
    expect(focus.colorIds).toEqual({ '9': 2 })
  })

  it('single events and mixed-colour clusters are not colour-clustered', () => {
    expect(cluster('Dentist').eras).toEqual([])
    expect(cluster('Vacation').eras).toEqual([])
    const mixed = classify([
      { id: 'm1', summary: 'Gym', start: { dateTime: '2026-01-01T10:00:00-08:00' }, end: { dateTime: '2026-01-01T11:00:00-08:00' }, colorId: '1' },
      { id: 'm2', summary: 'Gym', start: { dateTime: '2026-01-02T10:00:00-08:00' }, end: { dateTime: '2026-01-02T11:00:00-08:00' }, colorId: '2' },
    ])
    expect(mixed.clusters[0]?.eras).toEqual([])
    expect(mixed.unmarked).toBe(2)
  })

  it('sorts clusters by count descending, then title', () => {
    const titles = classify(classifyEvents).clusters.map((c) => c.title)
    expect(titles).toEqual(['Coffee', 'Focus block', 'Read', 'Dentist', 'Vacation'])
  })

  it('is idempotent: classifying the same events twice gives deep-equal reports', () => {
    expect(classify(classifyEvents)).toEqual(classify(classifyEvents))
  })
})
