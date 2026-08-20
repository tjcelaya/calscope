import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { SelectorKind, ValueType } from '../src/model/enums.js'
import type { Tag, TrackSelector } from '../src/model/types.js'
import { descendantTags, resolve } from '../src/select/resolve.js'
import { areConvertible, convert, isKnownUnit } from '../src/select/units.js'
import { tags, tracks } from './fixture.js'

const ids = (s: TrackSelector) => resolve(s, tracks, tags).map((t) => t.id)

describe('track selectors', () => {
  it('selects by explicit id', () => {
    expect(ids({ t: SelectorKind.Track, ids: ['run', 'lift'] })).toEqual(['run', 'lift'])
  })

  it('selects by tag', () => {
    expect(ids({ t: SelectorKind.Tag, tags: ['caffeine'], match: 'any' })).toEqual([
      'espresso',
      'tea',
      'cola',
      'coffee-cups',
    ])
  })

  it('transitive tag selection reaches descendants', () => {
    // This is what makes "sum of this TYPE of thing" hold up as new tracks appear.
    expect(ids({ t: SelectorKind.Tag, tags: ['exercise'], match: 'any' })).toEqual([])
    expect(
      ids({ t: SelectorKind.Tag, tags: ['exercise'], match: 'any', transitive: true }),
    ).toEqual(['run', 'lift'])
  })

  it('picks up a newly added track without editing the selector', () => {
    const withNewTrack = [
      ...tracks,
      { id: 'yerba', name: 'Yerba mate', valueType: ValueType.Quantity, tags: ['caffeine'], unit: 'mg', color: '#7c9' },
    ]
    const selector: TrackSelector = { t: SelectorKind.Tag, tags: ['caffeine'], match: 'any' }
    expect(resolve(selector, withNewTrack, tags).map((t) => t.id)).toContain('yerba')
  })

  it('match:all requires every tag', () => {
    const both: TrackSelector = { t: SelectorKind.Tag, tags: ['caffeine', 'meds'], match: 'all' }
    expect(ids(both)).toEqual([])
  })

  it('composes union, intersect and except', () => {
    expect(
      ids({
        t: SelectorKind.Union,
        of: [
          { t: SelectorKind.Track, ids: ['run'] },
          { t: SelectorKind.Track, ids: ['tea'] },
        ],
      }),
    ).toEqual(['tea', 'run'])

    expect(
      ids({
        t: SelectorKind.Except,
        from: { t: SelectorKind.Tag, tags: ['caffeine'], match: 'any' },
        minus: { t: SelectorKind.Track, ids: ['coffee-cups'] },
      }),
    ).toEqual(['espresso', 'tea', 'cola'])

    expect(
      ids({
        t: SelectorKind.Intersect,
        of: [
          { t: SelectorKind.Tag, tags: ['caffeine'], match: 'any' },
          { t: SelectorKind.ValueType, valueTypes: [ValueType.Quantity] },
        ],
      })).toEqual(['espresso', 'tea', 'cola', 'coffee-cups'])
  })

  it('an empty intersect selects nothing rather than everything', () => {
    expect(ids({ t: SelectorKind.Intersect, of: [] })).toEqual([])
  })

  it('output order follows track order and is stable under input reordering', () => {
    const selector: TrackSelector = { t: SelectorKind.Tag, tags: ['caffeine'], match: 'any' }
    fc.assert(
      fc.property(fc.shuffledSubarray(tracks, { minLength: tracks.length }), (shuffled) => {
        const out = resolve(selector, shuffled, tags).map((t) => t.id)
        // Same set every time, ordered by whatever the caller's track order is.
        expect([...out].sort()).toEqual(['coffee-cups', 'cola', 'espresso', 'tea'])
      }),
    )
  })

  it('transitive selection terminates on a cyclic parent chain', () => {
    // Corrupt data must not hang the app.
    const cyclic: Tag[] = [
      { id: 'a', name: 'a', parentId: 'c' },
      { id: 'b', name: 'b', parentId: 'a' },
      { id: 'c', name: 'c', parentId: 'b' },
    ]
    expect([...descendantTags(['a'], cyclic)].sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('unit conversion', () => {
  it('converts within a dimension', () => {
    expect(convert(1, 'g', 'mg')).toBe(1000)
    expect(convert(90, 'min', 'hr')).toBe(1.5)
    expect(convert(1, 'km', 'm')).toBe(1000)
  })

  it('refuses to convert across dimensions', () => {
    expect(areConvertible('min', 'km')).toBe(false)
    expect(convert(5, 'min', 'km')).toBeNull()
    expect(convert(5, 'cup', 'mg')).toBeNull()
  })

  it('treats an unknown unit as convertible only with itself', () => {
    expect(isKnownUnit('sneezes')).toBe(false)
    expect(areConvertible('sneezes', 'sneezes')).toBe(true)
    expect(areConvertible('sneezes', 'mg')).toBe(false)
    expect(convert(3, 'sneezes', 'sneezes')).toBe(3)
  })

  it('round-trips without drift', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), (value) => {
        const there = convert(value, 'mg', 'kg')!
        expect(convert(there, 'kg', 'mg')!).toBeCloseTo(value, 6)
      }),
    )
  })
})
