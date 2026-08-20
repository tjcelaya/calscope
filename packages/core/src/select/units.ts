import type { Unit } from '../model/types.js'

/**
 * Summing across a selector that resolves to tracks in different units produces a
 * meaningless number (minutes + kilometres). Rather than silently adding garbage, a
 * goal declares its unit and non-convertible tracks are excluded AND reported.
 */
type Dimension = 'time' | 'length' | 'mass' | 'volume' | 'count'

/** Factor converts a value in this unit into the dimension's base unit. */
const UNITS: Record<string, { dimension: Dimension; factor: number }> = {
  ms: { dimension: 'time', factor: 1 / 60000 },
  s: { dimension: 'time', factor: 1 / 60 },
  sec: { dimension: 'time', factor: 1 / 60 },
  min: { dimension: 'time', factor: 1 },
  hr: { dimension: 'time', factor: 60 },
  h: { dimension: 'time', factor: 60 },
  day: { dimension: 'time', factor: 1440 },

  mm: { dimension: 'length', factor: 0.001 },
  cm: { dimension: 'length', factor: 0.01 },
  m: { dimension: 'length', factor: 1 },
  km: { dimension: 'length', factor: 1000 },
  mi: { dimension: 'length', factor: 1609.344 },
  ft: { dimension: 'length', factor: 0.3048 },

  mcg: { dimension: 'mass', factor: 0.001 },
  mg: { dimension: 'mass', factor: 1 },
  g: { dimension: 'mass', factor: 1000 },
  kg: { dimension: 'mass', factor: 1_000_000 },
  oz: { dimension: 'mass', factor: 28_349.5 },
  lb: { dimension: 'mass', factor: 453_592 },

  ml: { dimension: 'volume', factor: 1 },
  l: { dimension: 'volume', factor: 1000 },
  cup: { dimension: 'volume', factor: 236.588 },
  floz: { dimension: 'volume', factor: 29.5735 },

  count: { dimension: 'count', factor: 1 },
  x: { dimension: 'count', factor: 1 },
}

function lookup(unit: Unit) {
  return UNITS[unit.trim().toLowerCase()]
}

export function isKnownUnit(unit: Unit): boolean {
  return lookup(unit) !== undefined
}

export function areConvertible(a: Unit, b: Unit): boolean {
  const from = lookup(a)
  const to = lookup(b)
  // Unknown units are convertible only with themselves, so a user's custom unit still
  // works inside a goal that declares the same string.
  if (!from || !to) return a.trim().toLowerCase() === b.trim().toLowerCase()
  return from.dimension === to.dimension
}

/** Returns null when the units are not convertible, so callers must handle exclusion. */
export function convert(value: number, from: Unit, to: Unit): number | null {
  if (!areConvertible(from, to)) return null

  const f = lookup(from)
  const t = lookup(to)
  if (!f || !t) return value
  return (value * f.factor) / t.factor
}
