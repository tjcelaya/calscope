import type { Temporal } from 'temporal-polyfill'

/**
 * Pure layout math for ColumnsView and GridView, kept out of the .tsx files so it can
 * be unit-tested (the test runner has no Solid JSX transform). Nothing here may depend
 * on a day's real length -- locked zoom: geometry is a function of zoom (day count) and
 * container size only.
 */

export const COLUMNS = {
  /** Below this a column cannot carry an inset nested interval; keep it and scroll. */
  minColW: 34,
  /** Above this columns read as slabs; cap and center instead. */
  maxColW: 86,
  gap: 12,
  /** Hour-axis gutter. */
  left: 30,
  right: 24,
  minHour: 8,
  maxHour: 13,
} as const

export type ColumnsLayout = {
  colW: number
  /** Height of one hour slot. Identical across every column (locked zoom). */
  hour: number
  contentW: number
  /** Content wider than the container: columns hold minColW and .hscroll takes over. */
  overflow: boolean
}

/**
 * Fill the container with `dayCount` columns. Column width is derived from the
 * container, clamped to [minColW, maxColW]; hour height scales mildly with column
 * width (clamped) so wide desktop columns do not look sparse -- both are functions of
 * zoom + container, never of any particular day.
 */
export function columnsLayout(containerW: number, dayCount: number): ColumnsLayout {
  const count = Math.max(1, dayCount)
  const chrome = COLUMNS.left + COLUMNS.right
  const ideal = (containerW - chrome) / count - COLUMNS.gap
  const colW = round2(clamp(ideal, COLUMNS.minColW, COLUMNS.maxColW))
  const hour = round2(clamp(6 + colW * 0.08, COLUMNS.minHour, COLUMNS.maxHour))
  const contentW = chrome + count * (colW + COLUMNS.gap)
  // Half-pixel slack so rounding never triggers a one-frame scrollbar.
  return { colW, hour, contentW, overflow: contentW > containerW + 0.5 }
}

export type Span = { from: number; to: number }

export type LaneAssignment = {
  /** Lane per input span, -1 when the span overflowed past maxLanes. */
  lanes: number[]
  /** How many spans did not fit -- the "+n" hint. */
  overflow: number
}

/**
 * Greedy first-fit lane packing for the grid cell's mark lanes. Deterministic and
 * order-independent: spans are processed by start time (longer first on ties), so the
 * same day model always packs identically regardless of input order.
 */
export function assignLanes(spans: readonly Span[], maxLanes: number): LaneAssignment {
  const order = spans
    .map((_, i) => i)
    .sort((a, b) => {
      const sa = spans[a]!
      const sb = spans[b]!
      return sa.from - sb.from || sb.to - sb.from - (sa.to - sa.from)
    })
  const laneEnds: number[] = []
  const lanes = new Array<number>(spans.length).fill(-1)
  let overflow = 0
  for (const i of order) {
    const s = spans[i]!
    let lane = laneEnds.findIndex((end) => end <= s.from)
    if (lane === -1) {
      if (laneEnds.length >= maxLanes) {
        overflow++
        continue
      }
      lane = laneEnds.length
    }
    laneEnds[lane] = s.to
    lanes[i] = lane
  }
  return { lanes, overflow }
}

export type GridCell = { col: number; row: number }
export type MonthLabel = { row: number; label: string }
export type MonthGrid = { cells: GridCell[]; rows: number; monthLabels: MonthLabel[] }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/**
 * Real-week alignment for the grid: column = ISO weekday (Monday start), rows pad with
 * leading blanks like any month calendar. The month label sits on the row where the
 * range opens and on every row containing a 1st; when both land on one row the month
 * boundary wins -- it is the more informative of the two.
 */
export function monthGrid(dates: readonly Temporal.PlainDate[]): MonthGrid {
  const first = dates[0]
  if (first === undefined) return { cells: [], rows: 0, monthLabels: [] }
  // Temporal: Monday is dayOfWeek 1, so the lead-in blank count is dayOfWeek - 1.
  const lead = first.dayOfWeek - 1
  const cells = dates.map((_, i) => ({ col: (lead + i) % 7, row: Math.floor((lead + i) / 7) }))
  const rows = cells[cells.length - 1]!.row + 1
  const monthLabels: MonthLabel[] = []
  dates.forEach((d, i) => {
    if (i !== 0 && d.day !== 1) return
    const row = cells[i]!.row
    const label = MONTHS[d.month - 1] ?? ''
    const prev = monthLabels[monthLabels.length - 1]
    if (prev !== undefined && prev.row === row) prev.label = label
    else monthLabels.push({ row, label })
  })
  return { cells, rows, monthLabels }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function round2(n: number): number {
  return Math.round(n * 4) / 4
}
