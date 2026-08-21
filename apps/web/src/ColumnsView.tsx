import { For, Show } from 'solid-js'
import { DayShape } from '@calscope/views'
import { Emphasis, MarkKind, dimmed, type SpikeModel } from './spike-model'

/**
 * Horizontal day-columns projection of the same day-model the radial view renders.
 * X = day, Y = time of day. Hour height is IDENTICAL across columns (locked zoom), so
 * times align horizontally; a DST anomaly is drawn as a stepped-out block (Long) or an
 * in-column hatched void (Short) -- the linear analog of the radial spur/void.
 */
const HOUR = 9
const COL_W = 46
const COL_GAP = 12
const TOP = 22
const LEFT = 30

const INSET_PER_DEPTH = 0.18
const MAX_INSET = 0.36
const MIN_INSET = 3

type Props = { model: SpikeModel; emphasis: Emphasis }

export function ColumnsView(props: Props) {
  const count = () => props.model.days.length
  const width = () => LEFT + count() * (COL_W + COL_GAP) + 24
  const height = () => TOP + 24 * HOUR + 18
  const colX = (i: number) => LEFT + i * (COL_W + COL_GAP)
  const slotY = (slot: number) => TOP + slot * HOUR

  const insetX = (depth: number) =>
    depth === 0 ? 0 : Math.min(Math.max(depth * INSET_PER_DEPTH * COL_W, MIN_INSET), MAX_INSET * COL_W)

  return (
    <div class="hscroll">
      <svg
        viewBox={`0 0 ${width()} ${height()}`}
        width={width()}
        role="img"
        aria-label="Day columns view"
      >
        <For each={[0, 6, 12, 18, 24]}>
          {(h) => (
            <g>
              <line x1={LEFT - 4} y1={slotY(h)} x2={width() - 12} y2={slotY(h)} class="tick" />
              <text x={2} y={slotY(h) + 3} class="axis-label">
                {h}
              </text>
            </g>
          )}
        </For>

        <For each={props.model.days}>
          {(sd, i) => {
            const x = () => colX(i())
            return (
              <g>
                <text x={x() + COL_W / 2} y={12} class="axis-label mid">
                  {sd.day.date.toString().slice(5)}
                </text>

                <For each={sd.daylight}>
                  {(seg) => (
                    <rect
                      x={x()}
                      y={slotY(seg.from)}
                      width={COL_W}
                      height={(seg.to - seg.from) * HOUR}
                      class={`ringbg bg-${seg.cls}`}
                    />
                  )}
                </For>

                <For each={sd.segments}>
                  {(seg) => (
                    <rect
                      x={x() + insetX(seg.mark.depth)}
                      y={slotY(seg.from)}
                      width={COL_W - 2 * insetX(seg.mark.depth)}
                      height={Math.max((seg.to - seg.from) * HOUR, 1.5)}
                      fill={seg.mark.color}
                      stroke={seg.mark.kind === MarkKind.Ongoing ? seg.mark.color : undefined}
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
                      x1={x() - 2.5}
                      x2={x() + COL_W + 2.5}
                      y1={slotY(m.startSlot - sd.index * 24)}
                      y2={slotY(m.startSlot - sd.index * 24)}
                      stroke={m.color}
                      vector-effect="non-scaling-stroke"
                      classList={{ 'instant-tick': true, dim: dimmed(MarkKind.Instant, props.emphasis) }}
                    />
                  )}
                </For>

                <Show when={sd.day.anomaly}>
                  {(anomaly) => {
                    const mag = () => Math.abs(anomaly().delta.total({ unit: 'hour' }))
                    // Day-end clamps so the block stays inside the day, same reasoning
                    // as the radial abutting midnight from the counter-clockwise side.
                    const slot = () => Math.min(anomaly().slotIndex, 24 - mag())
                    return sd.day.shape === DayShape.Long ? (
                      <rect
                        x={x() + COL_W + 1.5}
                        y={slotY(slot())}
                        width={COL_W * 0.35}
                        height={mag() * HOUR}
                        class="anomaly spur"
                      />
                    ) : (
                      <rect
                        x={x()}
                        y={slotY(slot())}
                        width={COL_W}
                        height={mag() * HOUR}
                        class="anomaly void"
                      />
                    )
                  }}
                </Show>
              </g>
            )
          }}
        </For>

        <line
          x1={colX(props.model.nowDay) - 4}
          x2={colX(props.model.nowDay) + COL_W + 4}
          y1={slotY(props.model.nowSlot)}
          y2={slotY(props.model.nowSlot)}
          vector-effect="non-scaling-stroke"
          classList={{
            'now-line': true,
            dim: props.emphasis === Emphasis.Instants || props.emphasis === Emphasis.Durations,
          }}
        />
      </svg>
    </div>
  )
}
