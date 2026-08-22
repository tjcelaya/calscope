import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { HlcClock, OpType, compareHlc, decodeHlc, fold } from '../core'
import type { Entry, Op, Snapshot, Track } from '../core'
import { actorClock, actorId } from '../actor'
import { exportDocument, importDocument } from '../export'
import {
  deleteEntry,
  upsertEntry,
  upsertGoal,
  upsertTag,
  upsertTrack,
  type OpStamp,
} from '../ops'
import { OpStore } from '../store'

// fake-indexeddb persists per-name within the process; a fresh name per test gives
// isolation, while reusing one name across OpStore instances simulates a reload.
let dbCounter = 0
const freshDbName = () => `calscope-test-${++dbCounter}`

const stampFor = (actor: string, nowMs = 1_000): OpStamp => ({
  clock: new HlcClock(actor, () => nowMs),
  actor,
})

function seedOps(stamp: OpStamp): { ops: Op[]; entryId: string } {
  const tagOp = upsertTag({ id: 'tag-caffeine', name: 'caffeine' }, stamp)
  const trackOp = upsertTrack(
    {
      id: 'track-espresso',
      name: 'espresso',
      valueType: 'quantity',
      unit: 'mg',
      tags: ['tag-caffeine'],
      color: '#a52',
    },
    stamp,
  )
  const entryOp = upsertEntry(
    {
      id: 'entry-1',
      trackId: 'track-espresso',
      start: '2026-01-05T09:00:00-05:00[America/New_York]',
      value: 80,
    },
    stamp,
  )
  const goalOp = upsertGoal(
    {
      id: 'goal-caffeine',
      name: 'caffeine under 400mg/day',
      what: { t: 'tag', tags: ['tag-caffeine'], match: 'any', transitive: true },
      when: { t: 'calendar', unit: 'day', tz: 'America/New_York' },
      aggregate: 'sum',
      compare: '<=',
      target: 400,
      unit: 'mg',
    },
    stamp,
  )
  return { ops: [tagOp, trackOp, entryOp, goalOp], entryId: 'entry-1' }
}

describe('OpStore', () => {
  it('appends, reloads from a fresh instance, and folds to identical state', async () => {
    const dbName = freshDbName()
    const stamp = stampFor('actor-a')
    const { ops } = seedOps(stamp)

    const first = await OpStore.open({ dbName })
    await first.append(ops[0]!)
    await first.appendMany(ops.slice(1))
    const before = await first.getState()
    expect(Object.keys(before.tracks)).toEqual(['track-espresso'])
    first.close()

    const second = await OpStore.open({ dbName })
    const reloaded = await second.loadAll()
    expect(reloaded).toHaveLength(ops.length)
    expect(fold(reloaded)).toEqual(before)
    expect(await second.getState()).toEqual(before)
    second.close()
  })

  it('caches the fold and invalidates it on append', async () => {
    const stamp = stampFor('actor-a')
    const store = await OpStore.open({ dbName: freshDbName() })
    await store.appendMany(seedOps(stamp).ops)

    const one = await store.getState()
    const two = await store.getState()
    expect(two).toBe(one)

    await store.append(deleteEntry('entry-1', stamp))
    const three = await store.getState()
    expect(three).not.toBe(one)
    expect(three.entries['entry-1']).toBeUndefined()
    expect(one.entries['entry-1']).toBeDefined()
    store.close()
  })

  it('absorbs a re-appended op instead of erroring, leaving one copy', async () => {
    const stamp = stampFor('actor-a')
    const store = await OpStore.open({ dbName: freshDbName() })
    const { ops } = seedOps(stamp)
    await store.appendMany(ops)
    await store.appendMany(ops)
    expect(await store.loadAll()).toHaveLength(ops.length)
    store.close()
  })

  it('lets last-writer-wins resolve a late-arriving older op (no pre-filtering)', async () => {
    const stamp = stampFor('actor-a')
    const store = await OpStore.open({ dbName: freshDbName() })
    const { ops } = seedOps(stamp)
    await store.appendMany(ops)
    await store.append(deleteEntry('entry-1', stamp))

    // An older upsert for the deleted entry arrives afterwards (a sync replay).
    const stale = ops.find((op) => op.type === OpType.EntryUpsert)!
    await store.append({ ...stale, id: 'replayed-op' })
    const state = await store.getState()
    expect(state.entries['entry-1']).toBeUndefined()
    store.close()
  })
})

describe('export / import', () => {
  it('round-trips through JSON into an empty store with identical folded state', async () => {
    const stamp = stampFor('actor-a')
    const source = await OpStore.open({ dbName: freshDbName() })
    await source.appendMany(seedOps(stamp).ops)
    const before = await source.getState()

    const doc = await exportDocument(source)
    expect(doc.version).toBe(1)
    const json: unknown = JSON.parse(JSON.stringify(doc))

    const target = await OpStore.open({ dbName: freshDbName() })
    const count = await importDocument(target, json)
    expect(count).toBe(doc.ops.length)
    expect(await target.getState()).toEqual(before)

    // Importing the same document again must not duplicate anything.
    await importDocument(target, json)
    expect(await target.loadAll()).toHaveLength(doc.ops.length)
    expect(await target.getState()).toEqual(before)
    source.close()
    target.close()
  })

  it('rejects a document that fails the schema, without touching the store', async () => {
    const store = await OpStore.open({ dbName: freshDbName() })
    await expect(importDocument(store, { version: 2, ops: [] })).rejects.toThrow()
    await expect(importDocument(store, { version: 1 })).rejects.toThrow()
    expect(await store.loadAll()).toHaveLength(0)
    store.close()
  })
})

describe('wipe', () => {
  it('drops every op, and the store keeps working afterwards', async () => {
    const dbName = freshDbName()
    const stamp = stampFor('actor-a')
    const store = await OpStore.open({ dbName })
    await store.appendMany(seedOps(stamp).ops)
    expect(Object.keys((await store.getState()).tracks)).toHaveLength(1)

    await store.wipe()
    const empty = await store.getState()
    expect(empty.tracks).toEqual({})
    expect(empty.entries).toEqual({})
    expect(await store.loadAll()).toEqual([])

    // Post-wipe writes fold from scratch -- the store is not poisoned.
    await store.append(upsertTrack({ id: 't2', name: 'fresh', valueType: 'binary', tags: [], color: '#fff' }, stamp))
    expect(Object.keys((await store.getState()).tracks)).toEqual(['t2'])
    store.close()
  })
})

describe('HLC continuity across store restarts', () => {
  it('a restarted clock with a regressed wall clock still stamps after the log head', async () => {
    const dbName = freshDbName()
    const clockA = new HlcClock('actor-a', () => 5_000)
    const stamp: OpStamp = { clock: clockA, actor: 'actor-a' }
    const store = await OpStore.open({ dbName, clock: clockA })
    // Several ops in one millisecond, so the log head carries a nonzero counter --
    // the case that exercises counter folding, not just millis folding.
    await store.appendMany(seedOps(stamp).ops)
    const head = (await store.loadAll()).at(-1)!.hlc
    expect(decodeHlc(head).counter).toBeGreaterThan(0)
    store.close()

    const clockB = new HlcClock('actor-a', () => 1_000)
    const reopened = await OpStore.open({ dbName, clock: clockB })
    expect(compareHlc(clockB.next(), head)).toBeGreaterThan(0)
    reopened.close()
  })

  it('appendMany of remote ops advances a bound clock past the batch maximum', async () => {
    const local = new HlcClock('actor-local', () => 1_000)
    const store = await OpStore.open({ dbName: freshDbName(), clock: local })
    const remote = stampFor('actor-remote', 9_000)
    await store.appendMany(seedOps(remote).ops)
    const max = (await store.loadAll()).at(-1)!.hlc
    expect(compareHlc(local.next(), max)).toBeGreaterThan(0)
    store.close()
  })
})

describe('op creators', () => {
  it('keeps a provided payload id and generates one otherwise', () => {
    const stamp = stampFor('actor-a')
    const kept = upsertEntry(
      { id: 'entry-x', trackId: 't', start: '2026-01-05T09:00:00-05:00[America/New_York]' },
      stamp,
    )
    expect((kept.payload as Entry).id).toBe('entry-x')

    const generated = upsertTrack(
      { name: 'tea', valueType: 'quantity', unit: 'mg', tags: [], color: '#4a4' },
      stamp,
    )
    const payload = generated.payload as Track
    expect(payload.id).toMatch(/^[0-9a-f-]{36}$/)
    // The op's own id is always fresh, never the record's.
    expect(generated.id).not.toBe(payload.id)
  })

  it('stamps hlc and actor from the given clock, and delete payloads are bare ids', () => {
    const stamp = stampFor('actor-z', 42)
    const op = deleteEntry('entry-x', stamp)
    expect(op.type).toBe(OpType.EntryDelete)
    expect(op.payload).toBe('entry-x')
    expect(op.actor).toBe('actor-z')
    expect(decodeHlc(op.hlc)).toMatchObject({ millis: 42, actor: 'actor-z' })
  })

  it('creator output folds into the expected snapshot', () => {
    const stamp = stampFor('actor-a')
    const { ops } = seedOps(stamp)
    const state: Snapshot = fold(ops)
    expect(Object.keys(state.tags)).toEqual(['tag-caffeine'])
    expect(Object.keys(state.goals)).toEqual(['goal-caffeine'])
    expect(state.entries['entry-1']?.value).toBe(80)
  })
})

describe('actor identity', () => {
  it('is stable across calls and shared with the lazy clock', () => {
    const a = actorId()
    expect(actorId()).toBe(a)
    const clock = actorClock()
    expect(actorClock()).toBe(clock)
    expect(decodeHlc(clock.next()).actor).toBe(a)
  })
})
