import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { COLUMNS, assignLanes, columnsLayout, monthGrid } from '../view-layout'

describe('columnsLayout', () => {
  it('fills the container: content width tracks the container while unclamped', () => {
    const l = columnsLayout(700, 7)
    expect(l.colW).toBeGreaterThan(COLUMNS.minColW)
    expect(l.colW).toBeLessThan(COLUMNS.maxColW)
    expect(l.overflow).toBe(false)
    // Rounding to quarter-pixels can leave at most count * 0.25 slack.
    expect(Math.abs(l.contentW - 700)).toBeLessThanOrEqual(7 * 0.25 + 0.01)
  })

  it('below the minimum column width it keeps the minimum and reports overflow', () => {
    const l = columnsLayout(320, 14)
    expect(l.colW).toBe(COLUMNS.minColW)
    expect(l.contentW).toBeGreaterThan(320)
    expect(l.overflow).toBe(true)
  })

  it('above the maximum column width it caps (centering is CSS, content < container)', () => {
    const l = columnsLayout(2000, 2)
    expect(l.colW).toBe(COLUMNS.maxColW)
    expect(l.contentW).toBeLessThan(2000)
    expect(l.overflow).toBe(false)
  })

  it('hour height scales mildly with column width and stays clamped', () => {
    const narrow = columnsLayout(320, 14)
    const wide = columnsLayout(2000, 2)
    expect(wide.hour).toBeGreaterThan(narrow.hour)
    expect(narrow.hour).toBeGreaterThanOrEqual(COLUMNS.minHour)
    expect(wide.hour).toBeLessThanOrEqual(COLUMNS.maxHour)
  })

  it('is a function of container + day count only (same inputs, same layout)', () => {
    expect(columnsLayout(613, 5)).toEqual(columnsLayout(613, 5))
  })
})

describe('assignLanes', () => {
  it('disjoint spans share lane 0', () => {
    const { lanes, overflow } = assignLanes(
      [
        { from: 1, to: 2 },
        { from: 3, to: 4 },
        { from: 2, to: 3 },
      ],
      3,
    )
    expect(lanes).toEqual([0, 0, 0])
    expect(overflow).toBe(0)
  })

  it('overlapping spans stack onto distinct lanes', () => {
    const { lanes } = assignLanes(
      [
        { from: 9, to: 17 },
        { from: 10, to: 11 },
        { from: 10.5, to: 12 },
      ],
      3,
    )
    expect(new Set(lanes).size).toBe(3)
  })

  it('caps at maxLanes and counts the rest as overflow', () => {
    const spans = [0, 1, 2, 3, 4].map(() => ({ from: 8, to: 12 }))
    const { lanes, overflow } = assignLanes(spans, 3)
    expect(lanes.filter((l) => l >= 0)).toHaveLength(3)
    expect(overflow).toBe(2)
  })

  it('is order-independent: shuffled input packs the same spans into the same lanes', () => {
    const spans = [
      { from: 9, to: 17 },
      { from: 10, to: 11 },
      { from: 13, to: 15 },
      { from: 10.5, to: 12 },
    ]
    const a = assignLanes(spans, 3)
    const reversed = [...spans].reverse()
    const b = assignLanes(reversed, 3)
    const key = (s: { from: number; to: number }) => `${s.from}-${s.to}`
    const byKeyA = new Map(spans.map((s, i) => [key(s), a.lanes[i]]))
    const byKeyB = new Map(reversed.map((s, i) => [key(s), b.lanes[i]]))
    expect(byKeyA).toEqual(byKeyB)
    expect(a.overflow).toBe(b.overflow)
  })
})

describe('monthGrid', () => {
  const dates = (start: string, days: number) => {
    const s = Temporal.PlainDate.from(start)
    return Array.from({ length: days }, (_, i) => s.add({ days: i }))
  }

  it('pads leading blanks so column = weekday, Monday start', () => {
    // 2026-06-10 is a Wednesday: column 2, row 0.
    const g = monthGrid(dates('2026-06-10', 7))
    expect(g.cells[0]).toEqual({ col: 2, row: 0 })
    // The following Monday wraps to row 1, column 0.
    expect(g.cells[5]).toEqual({ col: 0, row: 1 })
    expect(g.rows).toBe(2)
  })

  it('a Monday start has no lead-in and fills the row', () => {
    // 2026-06-08 is a Monday.
    const g = monthGrid(dates('2026-06-08', 14))
    expect(g.cells[0]).toEqual({ col: 0, row: 0 })
    expect(g.cells[13]).toEqual({ col: 6, row: 1 })
    expect(g.rows).toBe(2)
  })

  it('labels the opening row and every row containing a month boundary', () => {
    const g = monthGrid(dates('2026-06-25', 10))
    expect(g.monthLabels.map((m) => m.label)).toEqual(['Jun', 'Jul'])
    const july = g.monthLabels[1]!
    // July 1st 2026 is a Wednesday, second row of a range opening Thursday the 25th.
    expect(july.row).toBe(g.cells[6]!.row)
  })

  it('when the range opens in the same row as a month boundary, the boundary wins', () => {
    // Opens Fri Jan 30 2026; Feb 1 lands in the same (first) week row.
    const g = monthGrid(dates('2026-01-30', 5))
    expect(g.monthLabels).toEqual([{ row: 0, label: 'Feb' }])
  })

  it('an empty range yields an empty grid', () => {
    expect(monthGrid([])).toEqual({ cells: [], rows: 0, monthLabels: [] })
  })
})
