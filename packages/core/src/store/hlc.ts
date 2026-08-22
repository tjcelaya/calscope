import type { ActorId } from '../model/types.js'

/**
 * Hybrid logical clock. Physical millis keep timestamps human-meaningful; the counter
 * breaks ties within a millisecond; the actor id makes the total order deterministic
 * across devices. Encoded fixed-width so plain string comparison sorts correctly.
 */
export type Hlc = { millis: number; counter: number; actor: ActorId }

export function encodeHlc(hlc: Hlc): string {
  const millis = hlc.millis.toString().padStart(15, '0')
  const counter = hlc.counter.toString(16).padStart(5, '0')
  return `${millis}:${counter}:${hlc.actor}`
}

export function decodeHlc(encoded: string): Hlc {
  const [millis, counter, ...actor] = encoded.split(':')
  return {
    millis: Number(millis),
    counter: parseInt(counter ?? '0', 16),
    actor: actor.join(':'),
  }
}

export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Monotonic per-actor clock; never emits the same timestamp twice. */
export class HlcClock {
  private lastMillis = 0
  private counter = 0

  constructor(
    private readonly actor: ActorId,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  next(): string {
    const now = this.nowMs()
    // A clock that jumps backwards must not produce a lower timestamp than one already
    // issued, or ops would reorder on replay.
    if (now > this.lastMillis) {
      this.lastMillis = now
      this.counter = 0
    } else {
      this.counter += 1
    }
    return encodeHlc({ millis: this.lastMillis, counter: this.counter, actor: this.actor })
  }

  /** Fold a remote timestamp in so locally-issued ops sort after what we have seen. */
  observe(remote: string): void {
    const { millis, counter } = decodeHlc(remote)
    // The counter folds in too: dropping it would let the next local stamp within the
    // same millisecond tie with or sort before the remote one.
    if (millis > this.lastMillis) {
      this.lastMillis = millis
      this.counter = counter
    } else if (millis === this.lastMillis && counter > this.counter) {
      this.counter = counter
    }
  }
}
