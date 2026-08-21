import { For, Show, createMemo } from 'solid-js'
import {
  angleForSlot,
  anomalyGeometry,
  defaultRadialConfig,
  hourTicks,
  markFor,
  radialExtent,
  ringRadii,
  subBand,
  subBandForSlot,
  type Ring,
} from '@calscope/views'
import {
  Emphasis,
  MarkKind,
  RingOrder,
  dimmed,
  type SpikeModel,
} from './spike-model'

/** Fraction of band thickness removed per containment level, with an absolute floor so
 * nesting stays visible on phones, capped so 3-deep survives. */
const INSET_PER_DEPTH = 0.18
const MAX_INSET = 0.36
const MIN_INSET = 2.5

type Props = {
  model: SpikeModel
  mode: 24 | 12
  emphasis: Emphasis
  order: RingOrder
}

export function RadialView(props: Props) {
  const count = () => props.model.days.length

  // Ring thickness is a function of ZOOM (ring count) -- fewer rings fill the same
  // target radius with thicker bands. This is what makes containment nesting legible on
  // a phone, and it is exactly the slotSize(zoom) shape the locked-zoom invariant
  // permits: geometry depends on zoom, never on any day's real length.
  const config = createMemo(() => {
    const inner = 52
    const gap = 6
    const target = 250
    const thickness = Math.max(14, Math.min(44, (target - inner) / count() - gap))
    return {
      ...defaultRadialConfig,
      innerRadius: inner,
      ringGap: gap,
      ringThickness: thickness,
      spurHeight: Math.max(6, thickness * 0.4),
      hoursPerRevolution: props.mode,
    }
  })

  // Day -> ring assignment is a pure permutation; everything downstream is unchanged.
  const ringIndexOf = (dayIndex: number) =>
    props.order === RingOrder.NewestIn ? count() - 1 - dayIndex : dayIndex

  const bands = createMemo(() => {
    const cfg = config()
    const per = cfg.hoursPerRevolution
    const model = props.model
    const ringAt = (d: number) => (d >= 0 && d < count() ? ringRadii(cfg, ringIndexOf(d)) : null)

    const insetRing = (ring: Ring, depth: number): Ring => {
      const t = ring.r1 - ring.r0
      const k = depth === 0 ? 0 : Math.min(Math.max(depth * INSET_PER_DEPTH * t, MIN_INSET), MAX_INSET * t)
      return { r0: ring.r0 + k, r1: ring.r1 - k }
    }

    type Arc = { path: string; color: string; ongoing: boolean }
    type Tick = { angleDeg: number; r0: number; r1: number; color: string }
    const arcsByDay = new Map<number, Arc[]>()

    for (const m of model.marks) {
      if (m.kind === MarkKind.Instant) continue
      const ringAtInset = (d: number) => {
        const ring = ringAt(d)
        return ring ? insetRing(ring, m.depth) : null
      }
      for (const piece of markFor(cfg, ringAtInset, m.startSlot, m.endSlot)) {
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
