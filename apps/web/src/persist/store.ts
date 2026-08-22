import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { compareHlc, emptySnapshot, fold } from './core'
import type { HlcClock, Op, Snapshot } from './core'

const DB_NAME = 'calscope'
const DB_VERSION = 1
const OPS = 'ops'

interface OpLogDb extends DBSchema {
  ops: { key: string; value: Op; indexes: { hlc: string } }
}

let persistenceRequested = false

/**
 * Best-effort request to exempt the origin from storage eviction. Fire-and-forget:
 * denial just means the browser may evict under pressure, and non-browser environments
 * (tests, a future CLI) have no `navigator.storage` at all.
 */
function requestDurablePersistence(): void {
  if (persistenceRequested) return
  persistenceRequested = true
  try {
    if (typeof navigator !== 'undefined') {
      void navigator.storage?.persist?.().catch(() => undefined)
    }
  } catch {
    // Non-browser environment; nothing to request.
  }
}

/**
 * `HlcClock.observe` folds in both the millis and the counter, so observe() alone is
 * sufficient; the loop is belt-and-braces that PROVES the next stamp sorts after `hlc`
 * rather than trusting it, guarding replay order against any future clock regression.
 * The consumed timestamps are simply never used; uniqueness and monotonicity are what
 * matter.
 */
function advanceClockPast(clock: HlcClock, hlc: string): void {
  clock.observe(hlc)
  while (compareHlc(clock.next(), hlc) <= 0) {
    // keep ticking; terminates because the counter strictly increases
  }
}

/**
 * Append-only op log over IndexedDB, plus a cached fold of it.
 *
 * The store never interprets ops beyond their `id` and `hlc`; all semantics live in
 * core's `fold`. `appendMany` uses `put`, not `add`: ops are immutable and keyed by id,
 * so re-appending one (an import replayed, a sync batch seen twice) is a no-op rather
 * than an error -- the same idempotence contract the fold's LWW gives per record.
 */
export class OpStore {
  private snapshot: Snapshot | null = null

  private constructor(
    private readonly db: IDBPDatabase<OpLogDb>,
    private readonly clock: HlcClock | undefined,
  ) {}

  static async open(opts: { dbName?: string; clock?: HlcClock } = {}): Promise<OpStore> {
    requestDurablePersistence()
    const db = await openDB<OpLogDb>(opts.dbName ?? DB_NAME, DB_VERSION, {
      upgrade(database) {
        const ops = database.createObjectStore(OPS, { keyPath: 'id' })
        ops.createIndex('hlc', 'hlc')
      },
    })
    const store = new OpStore(db, opts.clock)
    if (opts.clock) {
      // Without this, a device whose wall clock regressed between sessions would stamp
      // new ops before everything it already persisted.
      const last = await store.lastHlc()
      if (last !== null) advanceClockPast(opts.clock, last)
    }
    return store
  }

  async append(op: Op): Promise<void> {
    await this.appendMany([op])
  }

  async appendMany(ops: readonly Op[]): Promise<void> {
    if (ops.length === 0) return
    const tx = this.db.transaction(OPS, 'readwrite')
    for (const op of ops) void tx.store.put(op)
    await tx.done
    this.snapshot = null
    if (this.clock) {
      // Imported/synced ops may carry a remote clock ahead of ours; fold the batch
      // maximum in so subsequent local ops sort after everything now in the log.
      const max = ops.reduce((a, b) => (compareHlc(a.hlc, b.hlc) >= 0 ? a : b))
      advanceClockPast(this.clock, max.hlc)
    }
  }

  /** All ops, sorted by hlc (the index order), so exports are deterministic. */
  async loadAll(): Promise<Op[]> {
    return this.db.getAllFromIndex(OPS, 'hlc')
  }

  /**
   * The folded snapshot, cached until the next append. Treat it as immutable -- callers
   * share one object between invalidations.
   */
  async getState(): Promise<Snapshot> {
    if (this.snapshot === null) {
      const ops = await this.loadAll()
      this.snapshot = ops.length === 0 ? emptySnapshot() : fold(ops)
    }
    return this.snapshot
  }

  /**
   * Testing aid: drop every op so the next getState() folds an empty log. The clock is
   * left alone -- it only ever moves forward, so post-wipe ops still sort after the
   * wiped history if an export of it ever comes back.
   */
  async wipe(): Promise<void> {
    const tx = this.db.transaction(OPS, 'readwrite')
    await tx.store.clear()
    await tx.done
    this.snapshot = null
  }

  close(): void {
    this.db.close()
  }

  private async lastHlc(): Promise<string | null> {
    const cursor = await this.db.transaction(OPS).store.index('hlc').openCursor(null, 'prev')
    return cursor?.value.hlc ?? null
  }
}
