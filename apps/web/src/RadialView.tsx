import { For, Show, createMemo } from 'solid-js'
import {
  angleForSlot,
  anomalyGeometry,
  hourTicks,
  insetRing,
  markFor,
  radialConfigForZoom,
  radialExtent,
  ringIndexFor,
  ringRadii,
  subBand,
  subBandForSlot,
  type RingOrder,
} from '@calscope/views'
import { Emphasis, MarkKind, dimmed, type ViewModel } from './model'

type Props = {
  model: ViewModel
  mode: 24 | 12
  emphasis: Emphasis
  order: RingOrder
}

export function RadialView(props: Props) {
  const count = () => props.model.days.length

  // Zoom-derived geometry and the order permutation both live in @calscope/views now --
  // the spike's local copies were promoted there and deleted here.
  const config = createMemo(() => radialConfigForZoom(count(), { hoursPerRevolution: props.mode }))
  const ringIndexOf = (dayIndex: number) => ringIndexFor(dayIndex, count(), props.order)

  const bands = createMemo(() => {
    const cfg = config()
    const per = cfg.hoursPerRevolution
    const model = props.model
    const ringAt = (d: number) => (d >= 0 && d < count() ? ringRadii(cfg, ringIndexOf(d)) : null)

    type Arc = { path: string; color: string; ongoing: boolean }
    type Tick = { angleDeg: number; r0: number; r1: number; color: string }
    const arcsByDay = new Map<number, Arc[]>()

    for (const m of model.marks) {
      if (m.kind === MarkKind.Instant) continue
      const ringAtInset = (d: number) => {
        const ring = ringAt(d)
        return ring ? insetRing(ring, m.depth) : null
      }
      // connect: crossings bridge to the next ring with an S-shaped band instead of
      // ending dead at midnight and reappearing unrelated one radius over.
      for (const piece of markFor(cfg, ringAtInset, m.startSlot, m.endSlot, { connect: true })) {
        const bucket = arcsByDay.get(piece.dayOffset) ?? []
        bucket.push({ path: piece.path, color: m.color, ongoing: m.kind === MarkKind.Ongoing })
        arcsByDay.set(piece.dayOffset, bucket)
      }
    }

    return model.days.map((sd) => {
      const ring = ringRadii(cfg, ringIndexOf(sd.index))
      const ringOnly = (d: number) => (d === sd.index ? ring : null)
      const bg = sd.daylight.flatMap((seg) =>
        markFor(cfg, ringOnly, sd.index * 24 + seg.from, sd.index * 24 + seg.to).map((p) => ({
          path: p.path,
          cls: seg.cls,
        })),
      )
      const ticks: Tick[] = sd.ticks.map((m) => {
        const slot = m.startSlot - sd.index * 24
        const sb = subBand(ring, subBandForSlot(slot, per), per)
        return {
          angleDeg: (angleForSlot(slot, per) * 180) / Math.PI,
          r0: sb.r0,
          r1: sb.r1,
          color: m.color,
        }
      })
      return {
        sd,
        ring,
        bg,
        ticks,
        arcs: arcsByDay.get(sd.index) ?? [],
        anomaly: anomalyGeometry(cfg, ring, sd.day),
      }
    })
  })

  const extent = createMemo(() => radialExtent(config(), count()))
  const viewBox = createMemo(() => {
    const e = extent() + 12
    return `${-e} ${-e} ${e * 2} ${e * 2}`
  })

  const nowAngleDeg = createMemo(
    () => (angleForSlot(props.model.nowSlot, config().hoursPerRevolution) * 180) / Math.PI,
  )
  const nowBand = createMemo(() => {
    const cfg = config()
    const ring = ringRadii(cfg, ringIndexOf(props.model.nowDay))
    return subBand(ring, subBandForSlot(props.model.nowSlot, cfg.hoursPerRevolution), cfg.hoursPerRevolution)
  })

  return (
    <svg viewBox={viewBox()} role="img" aria-label="Radial view">
      <For each={hourTicks(config().hoursPerRevolution)}>
        {(angle, i) => (
          <g transform={`rotate(${(angle * 180) / Math.PI})`}>
            <line
              x1={0}
              y1={-config().innerRadius + 8}
              x2={0}
              y2={-extent()}
              class={i() % 6 === 0 ? 'tick major' : 'tick'}
            />
          </g>
        )}
      </For>

      <For each={bands()}>
        {(band) => (
          <g>
            <For each={band.bg}>{(seg) => <path d={seg.path} class={`ringbg bg-${seg.cls}`} />}</For>
            <For each={band.arcs}>
              {(arc) => (
                <path
                  d={arc.path}
                  fill={arc.color}
                  stroke={arc.ongoing ? arc.color : undefined}
                  vector-effect="non-scaling-stroke"
                  classList={{
                    mark: true,
                    ongoing: arc.ongoing,
                    dim: dimmed(arc.ongoing ? MarkKind.Ongoing : MarkKind.Interval, props.emphasis),
                  }}
                />
              )}
            </For>
            <For each={band.ticks}>
              {(tick) => (
                <g transform={`rotate(${tick.angleDeg})`}>
                  <line
                    y1={-(tick.r0 - 2.5)}
                    y2={-(tick.r1 + 2.5)}
                    stroke={tick.color}
                    vector-effect="non-scaling-stroke"
                    classList={{ 'instant-tick': true, dim: dimmed(MarkKind.Instant, props.emphasis) }}
                  />
                </g>
              )}
            </For>
            <Show when={band.anomaly}>
              {(anomaly) => (
                <path d={anomaly().path} class={anomaly().isSpur ? 'anomaly spur' : 'anomaly void'} />
              )}
            </Show>
          </g>
        )}
      </For>

      <g transform={`rotate(${nowAngleDeg()})`}>
        <line
          y1={-(nowBand().r0 - 4)}
          y2={-(nowBand().r1 + 4)}
          vector-effect="non-scaling-stroke"
          classList={{
            'now-line': true,
            dim: props.emphasis === Emphasis.Instants || props.emphasis === Emphasis.Durations,
          }}
        />
      </g>

      <circle r={2.5} class="hub" />
    </svg>
  )
}
