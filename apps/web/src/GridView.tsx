import { For, Show } from 'solid-js'
import { DayShape } from '@calscope/views'
import { Emphasis, MarkKind, dimmed, type SpikeModel } from './spike-model'

/**
 * Vertical year-grid projection (Giertz-grid excerpt) of the same day-model. Each cell
 * carries a 24h micro-timeline -- same marks, linearly compressed -- so the three views
 * can be compared for consistency at a glance. At real day-granularity zoom this cell
 * would collapse to a goal-status checkbox; that needs the engine (M3).
 */
const CELL_W = 66
const CELL_H = 42
const GAP = 7
const PER_ROW = 7

type Props = { model: SpikeModel; emphasis: Emphasis }

export function GridView(props: Props) {
  const rows = () => Math.ceil(props.model.days.length / PER_ROW)
  const width = () => PER_ROW * (CELL_W + GAP) + GAP
  const height = () => rows() * (CELL_H + GAP) + GAP
  const xOf = (i: number) => GAP + (i % PER_ROW) * (CELL_W + GAP)
  const yOf = (i: number) => GAP + Math.floor(i / PER_ROW) * (CELL_H + GAP)
  const slotX = (i: number, slot: number) => xOf(i) + (slot / 24) * CELL_W

  return (
    <svg viewBox={`0 0 ${width()} ${height()}`} role="img" aria-label="Year grid view (excerpt)">
      <For each={props.model.days}>
        {(sd, i) => (
          <g>
            <For each={sd.daylight}>
              {(seg) => (
                <rect
                  x={slotX(i(), seg.from)}
                  y={yOf(i())}
                  width={((seg.to - seg.from) / 24) * CELL_W}
                  height={CELL_H}
                  class={`ringbg bg-${seg.cls}`}
                />
              )}
            </For>

            <For each={sd.segments}>
              {(seg) => (
                <rect
                  x={slotX(i(), seg.from)}
                  y={yOf(i()) + CELL_H - 10 - seg.mark.depth * 8}
                  width={Math.max(((seg.to - seg.from) / 24) * CELL_W, 1.5)}
                  height={6}
                  fill={seg.mark.color}
                  vector-effect="non-scaling-stroke"
                  classList={{
                    mark: true,
                    ongoing: seg.mark.kind === MarkKind.Ongoing,
                    dim: dimmed(seg.mark.kind, props.emphasis),
                  }}
                />
              )}
            </For>

            <For each={sd.ticks}>
              {(m) => (
                <line
                  x1={slotX(i(), m.startSlot - sd.index * 24)}
                  x2={slotX(i(), m.startSlot - sd.index * 24)}
                  y1={yOf(i()) + CELL_H - 18}
                  y2={yOf(i()) + CELL_H - 2}
                  stroke={m.color}
                  vector-effect="non-scaling-stroke"
                  classList={{ 'instant-tick': true, dim: dimmed(MarkKind.Instant, props.emphasis) }}
                />
              )}
            </For>

            <Show when={sd.day.anomaly && sd.day.shape === DayShape.Short}>
              {(_) => (
                <rect
                  x={slotX(i(), Math.min(sd.day.anomaly!.slotIndex, 23))}
                  y={yOf(i())}
                  width={CELL_W / 24}
                  height={CELL_H}
                  class="anomaly void"
                />
              )}
            </Show>

            <rect
              x={xOf(i())}
              y={yOf(i())}
              width={CELL_W}
              height={CELL_H}
              classList={{ cell: true, 'cell-today': sd.index === props.model.nowDay }}
            />
            <text x={xOf(i()) + 4} y={yOf(i()) + 11} class="axis-label">
              {sd.day.date.toString().slice(5)}
            </text>
          </g>
        )}
      </For>
    </svg>
  )
}
