import { For, Show, createMemo } from 'solid-js'
import {
  angleForSlot,
  anomalyGeometry,
  hourTicks,
  insetRing,
  markFor,
  ringRadii,
  subBand,
  subBandForSlot,
  type RadialConfig,
} from '@calscope/views'
import { Emphasis, MarkKind, dimmed, type ViewModel } from './model'

/**
 * Small-multiples radial: one circle per day, day count driven by the same zoom as the
 * other views. Each circle is a single-day ring, so it reuses the whole radial mark
 * pipeline with a one-ring config -- in 12h mode a circle still gets AM/PM sub-bands and
 * (when enabled) the noon S-connector between them; the day boundary itself needs no
 * connector because each day is its own closed circle.
 */
type Props = {
  model: ViewModel
  mode: 24 | 12
  emphasis: Emphasis
  connect: boolean
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export function DayCirclesView(props: Props) {
  const config = createMemo<RadialConfig>(() => ({
    innerRadius: 15,
    ringThickness: 30,
    ringGap: 0,
    hoursPerRevolution: props.mode,
    spurHeight: 7,
  }))

  const circles = createMemo(() => {
    const cfg = config()
    const per = cfg.hoursPerRevolution
    const model = props.model
    const ring = ringRadii(cfg, 0)
    const ringOnly = (d: number) => (d === 0 ? ring : null)

    return model.days.map((sd) => {
      const bg = sd.daylight.flatMap((seg) =>
        markFor(cfg, ringOnly, seg.from, seg.to).map((p) => ({ path: p.path, cls: seg.cls })),
      )
      // DaySegments are already within-day, so slots feed markFor directly; the only
      // boundary a single circle can cross is noon in 12h mode.
      const arcs = sd.segments.flatMap((seg) => {
        const inset = (d: number) => (d === 0 ? insetRing(ring, seg.mark.depth) : null)
        return markFor(cfg, inset, seg.from, seg.to, { connect: props.connect }).map((p) => ({
          path: p.path,
          color: seg.mark.color,
          ongoing: seg.mark.kind === MarkKind.Ongoing,
        }))
      })
      const ticks = sd.ticks.map((m) => {
        const slot = m.startSlot - sd.index * 24
        const sb = subBand(ring, subBandForSlot(slot, per), per)
        return { angleDeg: (angleForSlot(slot, per) * 180) / Math.PI, r0: sb.r0, r1: sb.r1, color: m.color }
      })
      return { sd, bg, arcs, ticks, anomaly: anomalyGeometry(cfg, ring, sd.day) }
    })
  })

  const extent = createMemo(() => {
    const cfg = config()
    return cfg.innerRadius + cfg.ringThickness + cfg.spurHeight
  })
  const viewBox = createMemo(() => {
    const e = extent() + 4
    return `${-e} ${-e} ${e * 2} ${e * 2}`
  })

  const nowAngleDeg = () => (angleForSlot(props.model.nowSlot, config().hoursPerRevolution) * 180) / Math.PI
  const nowBand = createMemo(() => {
    const cfg = config()
    return subBand(ringRadii(cfg, 0), subBandForSlot(props.model.nowSlot, cfg.hoursPerRevolution), cfg.hoursPerRevolution)
  })

  return (
    <div class="day-circles">
      <For each={circles()}>
        {(c) => (
          <figure class="day-circle">
            <svg viewBox={viewBox()} role="img" aria-label={`Day ${c.sd.day.date.toString()}`}>
              <For each={hourTicks(config().hoursPerRevolution)}>
                {(angle, i) => (
                  <g transform={`rotate(${(angle * 180) / Math.PI})`}>
                    <line
                      y1={-config().innerRadius + 3}
                      y2={-extent() + 2}
                      class={i() % 6 === 0 ? 'tick major' : 'tick'}
                    />
                  </g>
                )}
              </For>
              <For each={c.bg}>{(seg) => <path d={seg.path} class={`ringbg bg-${seg.cls}`} />}</For>
              <For each={c.arcs}>
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
              <For each={c.ticks}>
                {(tick) => (
                  <g transform={`rotate(${tick.angleDeg})`}>
                    <line
                      y1={-(tick.r0 - 2)}
                      y2={-(tick.r1 + 2)}
                      stroke={tick.color}
                      vector-effect="non-scaling-stroke"
                      classList={{ 'instant-tick': true, dim: dimmed(MarkKind.Instant, props.emphasis) }}
                    />
                  </g>
                )}
              </For>
              <Show when={c.anomaly}>
                {(anomaly) => (
                  <path d={anomaly().path} class={anomaly().isSpur ? 'anomaly spur' : 'anomaly void'} />
                )}
              </Show>
              <Show when={c.sd.index === props.model.nowDay}>
                <g transform={`rotate(${nowAngleDeg()})`}>
                  <line
                    y1={-(nowBand().r0 - 3)}
                    y2={-(nowBand().r1 + 3)}
                    vector-effect="non-scaling-stroke"
                    classList={{
                      'now-line': true,
                      dim: props.emphasis === Emphasis.Instants || props.emphasis === Emphasis.Durations,
                    }}
                  />
                </g>
              </Show>
            </svg>
            <figcaption class="day-circle-label">
              {WEEKDAYS[c.sd.day.date.dayOfWeek - 1]} {c.sd.day.date.toString().slice(5)}
            </figcaption>
          </figure>
        )}
      </For>
    </div>
  )
}
