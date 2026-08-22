import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { DayShape } from '@calscope/views'
import { Emphasis, MarkKind, dimmed, type ViewModel } from './model'
import { COLUMNS, columnsLayout } from './view-layout'

/**
 * Horizontal day-columns projection of the same day-model the radial view renders.
 * X = day, Y = time of day. Hour height is IDENTICAL across columns (locked zoom), so
 * times align horizontally; a DST anomaly is drawn as a stepped-out block (Long) or an
 * in-column hatched void (Short) -- the linear analog of the radial spur/void.
 *
 * Width-aware per the plan's zoom semantics: the day count is the zoom, and column
 * width is derived from the measured container so N columns FILL it -- clamped between
 * a minimum (below which .hscroll takes over sideways) and a maximum (above which the
 * content caps and centers). Geometry stays a function of zoom + container, never of
 * any day's real length.
 */
const TOP = 22
const BOTTOM = 18

const INSET_PER_DEPTH = 0.18
const MAX_INSET = 0.36
const MIN_INSET = 3

type Props = { model: ViewModel; emphasis: Emphasis }

export function ColumnsView(props: Props) {
  let host!: HTMLDivElement
  // 640 is only the pre-measure fallback (first synchronous render, test DOMs without
  // ResizeObserver); the observer replaces it before paint in a real browser.
  const [containerW, setContainerW] = createSignal(640)

  onMount(() => {
    const measure = () => {
      const w = host.clientWidth
      if (w > 0) setContainerW(w)
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure)
      ro.observe(host)
      onCleanup(() => ro.disconnect())
    }
  })

  const count = () => props.model.days.length
  const layout = createMemo(() => columnsLayout(containerW(), count()))
  const colW = () => layout().colW
  const hour = () => layout().hour

  const width = () => layout().contentW
  const height = () => TOP + 24 * hour() + BOTTOM
  const colX = (i: number) => COLUMNS.left + i * (colW() + COLUMNS.gap)
  const slotY = (slot: number) => TOP + slot * hour()

  const insetX = (depth: number) =>
    depth === 0
      ? 0
      : Math.min(Math.max(depth * INSET_PER_DEPTH * colW(), MIN_INSET), MAX_INSET * colW())

  return (
    <div class="hscroll" ref={host}>
      <svg
        viewBox={`0 0 ${width()} ${height()}`}
        width={width()}
        height={height()}
        role="img"
        aria-label="Day columns view"
      >
        <For each={[0, 6, 12, 18, 24]}>
          {(h) => (
            <g>
              <line
                x1={COLUMNS.left - 4}
                y1={slotY(h)}
                x2={width() - 12}
                y2={slotY(h)}
                class="tick"
              />
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
                <text x={x() + colW() / 2} y={12} class="axis-label mid">
                  {sd.day.date.toString().slice(5)}
                </text>

                <For each={sd.daylight}>
                  {(seg) => (
                    <rect
                      x={x()}
                      y={slotY(seg.from)}
                      width={colW()}
                      height={(seg.to - seg.from) * hour()}
                      class={`ringbg bg-${seg.cls}`}
                    />
                  )}
                </For>

                <For each={sd.segments}>
                  {(seg) => (
                    <rect
                      x={x() + insetX(seg.mark.depth)}
                      y={slotY(seg.from)}
                      width={colW() - 2 * insetX(seg.mark.depth)}
                      height={Math.max((seg.to - seg.from) * hour(), 1.5)}
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
                      x2={x() + colW() + 2.5}
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
                        x={x() + colW() + 1.5}
                        y={slotY(slot())}
                        width={colW() * 0.35}
                        height={mag() * hour()}
                        class="anomaly spur"
                      />
                    ) : (
                      <rect
                        x={x()}
                        y={slotY(slot())}
                        width={colW()}
                        height={mag() * hour()}
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
          x2={colX(props.model.nowDay) + colW() + 4}
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
