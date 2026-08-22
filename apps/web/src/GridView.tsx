import { For, Show, createMemo } from 'solid-js'
import { DayShape } from '@calscope/views'
import { Emphasis, MarkKind, dimmed, type DayModel, type ViewModel } from './model'
import { assignLanes, monthGrid } from './view-layout'

/**
 * Month-style excerpt of the same day-model: rows are real weeks (Monday start, leading
 * blanks pad so column = weekday), with a weekday header and a month label in the gutter
 * wherever the month changes. Each cell keeps a compressed 24h read of the day -- a thin
 * daylight strip, up to MAX_LANES mark lanes with a "+n" overflow hint, instant ticks --
 * still driven entirely by the shared model. At real day-granularity zoom these cells
 * collapse to goal-status marks; that needs the engine (M3).
 */
const CELL_W = 66
const CELL_H = 46
const GAP = 7
const GUTTER = 30
const HEADER = 16
const STRIP_H = 5
const LANE_H = 5
const LANE_GAP = 2
const MAX_LANES = 3

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

type Props = { model: ViewModel; emphasis: Emphasis }

export function GridView(props: Props) {
  const grid = createMemo(() => monthGrid(props.model.days.map((d) => d.day.date)))

  const width = () => GUTTER + 7 * (CELL_W + GAP) + GAP
  const height = () => HEADER + grid().rows * (CELL_H + GAP) + GAP
  const xOf = (col: number) => GUTTER + GAP + col * (CELL_W + GAP)
  const yOf = (row: number) => HEADER + GAP + row * (CELL_H + GAP)
  const slotX = (x: number, slot: number) => x + (slot / 24) * CELL_W
  const laneY = (y: number, lane: number) => y + CELL_H - 2 - LANE_H - lane * (LANE_H + LANE_GAP)

  return (
    <svg viewBox={`0 0 ${width()} ${height()}`} role="img" aria-label="Month grid view (excerpt)">
      <For each={WEEKDAYS}>
        {(wd, col) => (
          <text x={xOf(col()) + CELL_W / 2} y={11} class="axis-label mid">
            {wd}
          </text>
        )}
      </For>

      <For each={grid().monthLabels}>
        {(ml) => (
          <text x={2} y={yOf(ml.row) + 14} class="axis-label month-label">
            {ml.label}
          </text>
        )}
      </For>

      <For each={props.model.days}>
        {(sd, i) => {
          const cell = () => grid().cells[i()] ?? { col: 0, row: 0 }
          const x = () => xOf(cell().col)
          const y = () => yOf(cell().row)
          // Per-day lane packing is pure data derived from the (immutable) day model,
          // so it recomputes only when the day itself is replaced.
          const packed = createMemo(() => laneSegments(sd))
          return (
            <g>
              <For each={sd.daylight}>
                {(seg) => (
                  <rect
                    x={slotX(x(), seg.from)}
                    y={y() + 1}
                    width={((seg.to - seg.from) / 24) * CELL_W}
                    height={STRIP_H}
                    class={`ringbg bg-${seg.cls}`}
                  />
                )}
              </For>

              <For each={packed().placed}>
                {(p) => (
                  <rect
                    x={slotX(x(), p.seg.from)}
                    y={laneY(y(), p.lane)}
                    width={Math.max(((p.seg.to - p.seg.from) / 24) * CELL_W, 1.5)}
                    height={LANE_H}
                    fill={p.seg.mark.color}
                    vector-effect="non-scaling-stroke"
                    classList={{
                      mark: true,
                      ongoing: p.seg.mark.kind === MarkKind.Ongoing,
                      dim: dimmed(p.seg.mark.kind, props.emphasis),
                    }}
                  />
                )}
              </For>

              <For each={sd.ticks}>
                {(m) => (
                  <line
                    x1={slotX(x(), m.startSlot - sd.index * 24)}
                    x2={slotX(x(), m.startSlot - sd.index * 24)}
                    y1={y() + CELL_H - 2 - MAX_LANES * (LANE_H + LANE_GAP)}
                    y2={y() + CELL_H - 2}
                    stroke={m.color}
                    vector-effect="non-scaling-stroke"
                    classList={{ 'instant-tick': true, dim: dimmed(MarkKind.Instant, props.emphasis) }}
                  />
                )}
              </For>

              <Show when={sd.day.anomaly && sd.day.shape === DayShape.Short}>
                {(_) => (
                  <rect
                    x={slotX(x(), Math.min(sd.day.anomaly!.slotIndex, 23))}
                    y={y() + 1}
                    width={CELL_W / 24}
                    height={CELL_H - 2}
                    class="anomaly void"
                  />
                )}
              </Show>

              <rect
                x={x()}
                y={y()}
                width={CELL_W}
                height={CELL_H}
                classList={{ cell: true, 'cell-today': sd.index === props.model.nowDay }}
              />
              <text x={x() + 4} y={y() + 16} class="axis-label day-num">
                {sd.day.date.day}
              </text>
              <Show when={packed().overflow > 0}>
                <text x={x() + CELL_W - 3} y={y() + 16} class="axis-label overflow-hint">
                  +{packed().overflow}
                </text>
              </Show>
            </g>
          )
        }}
      </For>
    </svg>
  )
}

function laneSegments(sd: DayModel) {
  const { lanes, overflow } = assignLanes(
    sd.segments.map((s) => ({ from: s.from, to: s.to })),
    MAX_LANES,
  )
  const placed = sd.segments.flatMap((seg, i) => {
    const lane = lanes[i] ?? -1
    return lane >= 0 ? [{ seg, lane }] : []
  })
  return { placed, overflow }
}
