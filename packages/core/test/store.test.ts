import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { OpType } from '../src/model/enums.js'
import type { Op, Track } from '../src/model/types.js'
import { HlcClock, compareHlc, decodeHlc, encodeHlc } from '../src/store/hlc.js'
import { fold } from '../src/store/oplog.js'

const track = (id: string, name: string): Track => ({
  id,
  name,
  valueType: 'binary',
  tags: [],
  color: '#fff',
})

const op = (hlc: string, type: OpType, payload: unknown): Op => ({
  id: `${hlc}-${type}`,
  hlc,
  actor: 'a',
  type,
  payload,
})

describe('hybrid logical clock', () => {
  it('never issues the same timestamp twice, even within one millisecond', () => {
    const clock = new HlcClock('device-a', () => 1000)
    const stamps = Array.from({ length: 50 }, () => clock.next())
    expect(new Set(stamps).size).toBe(50)
  })

  it('is monotonic even if the wall clock jumps backwards', () => {
    // A backwards clock jump must not let a new op sort before an existing one.
    let now = 5000
    const clock = new HlcClock('device-a', () => now)
    const first = clock.next()
    now = 1000
    const second = clock.next()
    expect(compareHlc(second, first)).toBeGreaterThan(0)
  })

  it('encodes so that lexical string order matches logical order', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 40 }),
        fc.integer({ min: 0, max: 2 ** 40 }),
        (a, b) => {
          const x = encodeHlc({ millis: a, counter: 0, actor: 'z' })
          const y = encodeHlc({ millis: b, counter: 0, actor: 'z' })
          expect(compareHlc(x, y) < 0).toBe(a < b)
        },
      ),
    )
  })

  it('round-trips through decode', () => {
    const hlc = { millis: 1_700_000_000_000, counter: 42, actor: 'device-b' }
    expect(decodeHlc(encodeHlc(hlc))).toEqual(hlc)
  })

  it('observing a remote timestamp keeps later local ops sorting after it', () => {
    const clock = new HlcClock('local', () => 1000)
    const remote = encodeHlc({ millis: 9999, counter: 0, actor: 'remote' })
    clock.observe(remote)
    expect(compareHlc(clock.next(), remote)).toBeGreaterThan(0)
  })
})

describe('op log fold', () => {
  it('last writer wins by HLC', () => {
    const state = fold([
      op('000000000000001:00000:a', OpType.TrackUpsert, track('t1', 'first')),
      op('000000000000002:00000:a', OpType.TrackUpsert, track('t1', 'second')),
    ])
    expect(state.tracks.t1!.name).toBe('second')
  })

  it('is order-independent -- replaying a shuffled log gives identical state', () => {
    // This is what makes adding a sync relay later a no-op for the data model:
    // ops arriving out of order must converge.
    const ops = [
      op('000000000000001:00000:a', OpType.TrackUpsert, track('t1', 'first')),
      op('000000000000003:00000:a', OpType.TrackUpsert, track('t1', 'third')),
      op('000000000000002:00000:b', OpType.TrackUpsert, track('t1', 'second')),
      op('000000000000004:00000:b', OpType.TrackUpsert, track('t2', 'other')),
    ]
    fc.assert(
      fc.property(fc.shuffledSubarray(ops, { minLength: ops.length }), (shuffled) => {
        expect(fold(shuffled)).toEqual(fold(ops))
      }),
    )
    expect(fold(ops).tracks.t1!.name).toBe('third')
  })

  it('an older op arriving late cannot clobber a newer one', () => {
    const state = fold([
      op('000000000000009:00000:a', OpType.TrackUpsert, track('t1', 'newer')),
      op('000000000000001:00000:a', OpType.TrackUpsert, track('t1', 'stale')),
    ])
    expect(state.tracks.t1!.name).toBe('newer')
  })

  it('delete removes the record and accepts a bare id payload', () => {
    const state = fold([
      op('000000000000001:00000:a', OpType.TrackUpsert, track('t1', 'gone')),
      op('000000000000002:00000:a', OpType.TrackDelete, 't1'),
    ])
    expect(state.tracks.t1).toBeUndefined()
  })

  it('a delete that predates an upsert loses to it', () => {
    const state = fold([
      op('000000000000002:00000:a', OpType.TrackUpsert, track('t1', 'alive')),
      op('000000000000001:00000:a', OpType.TrackDelete, 't1'),
    ])
    expect(state.tracks.t1?.name).toBe('alive')
  })

  it('keeps record kinds in separate namespaces', () => {
    // A tag and a track may legitimately share an id.
    const state = fold([
      op('000000000000001:00000:a', OpType.TrackUpsert, track('x', 'the track')),
      op('000000000000002:00000:a', OpType.TagUpsert, { id: 'x', name: 'the tag' }),
    ])
    expect(state.tracks.x!.name).toBe('the track')
    expect(state.tags.x!.name).toBe('the tag')
  })

  it('folds onto an existing snapshot so periodic snapshots are safe', () => {
    const base = fold([op('000000000000001:00000:a', OpType.TrackUpsert, track('t1', 'base'))])
    const next = fold([op('000000000000005:00000:a', OpType.TrackUpsert, track('t2', 'added'))], base)
    expect(Object.keys(next.tracks).sort()).toEqual(['t1', 't2'])
  })
})
