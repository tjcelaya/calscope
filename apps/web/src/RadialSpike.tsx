import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { Temporal } from 'temporal-polyfill'
import {
  DstPolicy,
  angleForSlot,
  anomalyGeometry,
  defaultRadialConfig,
  hourTicks,
  markFor,
  radialExtent,
  ringRadii,
  slotPosition,
  subBand,
  subBandForSlot,
  virtualDay,
  type Ring,
} from '@calscope/views'
import { Gesture } from '@use-gesture/vanilla'
import { daylightSegments, type DaylightClass } from './daylight'
import {
  LAT,
  LNG,
  SCENARIOS,
  TIME_ZONE,
  generate,
  simulatedNow,
  tracks,
  type ScenarioKey,
} from './fake-data'

const MIN_RINGS = 2
const MAX_RINGS = 14
const trackColor = new Map(tracks.map((t) => [t.id, t.color]))

/** Which facet the view emphasizes; everything else dims but never disappears. */
const Emphasis = {
  All: 'all',
  Now: 'now',
  Instants: 'instants',
  Durations: 'durations',
} as const
type Emphasis = (typeof Emphasis)[keyof typeof Emphasis]

/**
 * The spike's mark encoding, prototyping the channel split the real views must commit to:
 * fill = track identity; SHAPE = kind (instant -> radial tick, interval -> arc, ongoing ->
 * arc to `now` with a dashed leading edge); stroke/pattern = state (hatched void); and
 * RADIAL INSET = containment, so "meeting inside work" nests instead of overpainting.
 */
type RenderMark =
  | { kind: 'arc'; path: string; color: string; ongoing: boolean }
  | { kind: 'tick'; angleDeg: number; r0: number; r1: number; color: string }

type RenderBg = { path: string; cls: DaylightClass }

/** Fraction of band thickness removed per containment level, capped so 3-deep stays visible. */
const INSET_PER_DEPTH = 0.18
const MAX_INSET = 0.36

export function RadialSpike() {
  // Raw UI state only -- everything derived below is a pure function of these.
  const [rings, setRings] = createSignal(7)
  const [hoursPerRevolution, setHours] = createSignal<24 | 12>(24)
  const [policy, setPolicy] = createSignal<DstPolicy>(DstPolicy.AtTransition)
  const [scenario, setScenario] = createSignal<ScenarioKey>('fallback')
  const [emphasis, setEmphasis] = createSignal<Emphasis>(Emphasis.All)

  let host!: HTMLDivElement

  onMount(() => {
    // Vanilla gesture core -- no framework adapter, so this survives a framework swap.
    const gesture = new Gesture(
      host,
      {
        onWheel: ({ direction: [, dy], event }) => {
          event.preventDefault()
          if (dy !== 0) setRings((r) => clamp(r + (dy > 0 ? 1 : -1)))
        },
        onPinch: ({ offset: [scale] }) => setRings(() => clamp(Math.round(scale * 7))),
      },
      { wheel: { eventOptions: { passive: false } }, pinch: { scaleBounds: { min: 0.3, max: 2 } } },
    )
    onCleanup(() => gesture.destroy())
  })

  const start = createMemo(() => SCENARIOS.find((s) => s.key === scenario())!.start)

  const config = createMemo(() => ({ ...defaultRadialConfig, hoursPerRevolution: hoursPerRevolution() }))

  const days = createMemo(() =>
    Array.from({ length: rings() }, (_, i) => virtualDay(start().add({ days: i }), TIME_ZONE, policy())),
  )

  const entries = createMemo(() => generate(start(), rings()))

  // The clock is an input, never a read -- same rule as evaluateGoal's injectable `now`.
  const now = createMemo(() => simulatedNow(start(), rings()))
  const nowSlot = createMemo(() => slotPosition(now()))

  const bands = createMemo(() => {
    const cfg = config()
    const per = cfg.hoursPerRevolution
    const dayList = days()
    const ringAt = (i: number) => (i >= 0 && i < dayList.length ? ringRadii(cfg, i) : null)

    // --- Containment depth: how many strictly-longer intervals fully contain this one.
    // Drives the radial inset, so "meeting inside work" reads as nesting, with the
    // container visible on both radial sides, rather than as overpainting.
    type Span = { idx: number; s: number; e: number }
    const spans: Span[] = []
    entries().forEach((entry, idx) => {
      const dayIndex = dayList.findIndex((d) => d.date.equals(entry.start.toPlainDate()))
      if (dayIndex < 0) return
      if (!entry.ongoing && entry.endHours === 0) return
      const s = dayIndex * 24 + slotPosition(entry.start)
      const e = entry.ongoing ? dayIndex * 24 + nowSlot() : s + entry.endHours
      spans.push({ idx, s, e })
    })
    const depthOf = new Map<number, number>()
    for (const a of spans) {
      const depth = spans.filter(
        (b) => b.idx !== a.idx && b.s <= a.s && a.e <= b.e && b.e - b.s > a.e - a.s,
      ).length
      depthOf.set(a.idx, depth)
    }
    const insetRing = (ring: Ring, depth: number): Ring => {
      const t = ring.r1 - ring.r0
      const k = Math.min(depth * INSET_PER_DEPTH, MAX_INSET) * t
      return { r0: ring.r0 + k, r1: ring.r1 - k }
    }

    // Marks are collected per ring rather than per entry, because an event that crosses
    // midnight contributes geometry to two different rings.
    const marksByDay = new Map<number, RenderMark[]>()
    const push = (dayIndex: number, mark: RenderMark) => {
      const bucket = marksByDay.get(dayIndex) ?? []
      bucket.push(mark)
      marksByDay.set(dayIndex, bucket)
    }

    entries().forEach((entry, idx) => {
      const dayIndex = dayList.findIndex((d) => d.date.equals(entry.start.toPlainDate()))
      if (dayIndex < 0) return

      const color = trackColor.get(entry.trackId) ?? '#888'
      const startSlot = dayIndex * 24 + slotPosition(entry.start)

      // Instants are radial TICKS, not micro-arcs: a shape channel, so a point-in-time
      // stays visible inside any interval that contains it. Placed in its 12h sub-band.
      if (!entry.ongoing && entry.endHours === 0) {
        const ring = ringAt(dayIndex)!
        const sb = subBand(ring, subBandForSlot(slotPosition(entry.start), per), per)
        push(dayIndex, {
          kind: 'tick',
          angleDeg: (angleForSlot(slotPosition(entry.start), per) * 180) / Math.PI,
          r0: sb.r0,
          r1: sb.r1,
          color,
        })
        return
      }

      const endSlot = entry.ongoing ? dayIndex * 24 + nowSlot() : startSlot + entry.endHours
      const depth = depthOf.get(idx) ?? 0
      const ringAtInset = (i: number) => {
        const ring = ringAt(i)
        return ring ? insetRing(ring, depth) : null
      }

      // Slots are measured from the grid origin (day 0 midnight), so markFor's
      // dayOffset already IS the absolute ring index -- do not add dayIndex again.
      for (const mark of markFor(cfg, ringAtInset, startSlot, endSlot)) {
        push(mark.dayOffset, {
          kind: 'arc',
          path: mark.path,
          color,
          ongoing: entry.ongoing === true,
        })
      }
    })

    return dayList.map((day, dayIndex) => {
      const ring = ringRadii(cfg, dayIndex)
      // Ring background = the day's actual light: night / twilight / daylight, computed
      // locally. Doubles as the AM/PM affordance in 12h mode -- the AM sub-band shows
      // night-into-morning, the PM sub-band afternoon-into-night, at the same angles.
      const ringOnly = (i: number) => (i === dayIndex ? ring : null)
      const bg: RenderBg[] = daylightSegments(day.date, TIME_ZONE, LAT, LNG).flatMap((seg) =>
        markFor(cfg, ringOnly, dayIndex * 24 + seg.from, dayIndex * 24 + seg.to).map((m) => ({
          path: m.path,
          cls: seg.cls,
        })),
      )
      return {
        day,
        ring,
        bg,
        anomaly: anomalyGeometry(cfg, ring, day),
        marks: marksByDay.get(dayIndex) ?? [],
      }
    })
  })

  const extent = createMemo(() => radialExtent(config(), rings()))
  const viewBox = createMemo(() => {
    const e = extent() + 12
    return `${-e} ${-e} ${e * 2} ${e * 2}`
  })

  const nowAngleDeg = createMemo(
    () => (angleForSlot(nowSlot(), config().hoursPerRevolution) * 180) / Math.PI,
  )
  const nowBand = createMemo(() => {
    const cfg = config()
    const ring = ringRadii(cfg, rings() - 1)
    return subBand(ring, subBandForSlot(nowSlot(), cfg.hoursPerRevolution), cfg.hoursPerRevolution)
  })

  const anomalousDays = createMemo(() => days().filter((d) => d.shape !== 'normal'))

  const dimArc = (ongoing: boolean) => {
    const e = emphasis()
    if (e === Emphasis.All) return false
    if (e === Emphasis.Now) return !ongoing
    return e !== Emphasis.Durations || ongoing
  }
  const dimTick = () => emphasis() !== Emphasis.All && emphasis() !== Emphasis.Instants

  return (
    <div class="spike">
      <header>
        <h1>calscope — radial spike</h1>
        <p class="sub">
          M0.5. Fake data, no engine, no persistence. Three questions: does a ring stay legible
          past ~7 days, does the spur read as information or as a rendering bug, and does
          concurrency survive — an instant inside a meeting inside an ongoing workday?
        </p>
      </header>

      <div class="controls">
        <label>
          Scenario
          <select value={scenario()} onChange={(e) => setScenario(e.currentTarget.value as ScenarioKey)}>
            <For each={SCENARIOS}>{(s) => <option value={s.key}>{s.label}</option>}</For>
          </select>
        </label>

        <label>
          Rings (zoom) <b>{rings()}</b>
          <input
            type="range"
            min={MIN_RINGS}
            max={MAX_RINGS}
            value={rings()}
            onInput={(e) => setRings(Number(e.currentTarget.value))}
          />
        </label>

        <label>
          Mode
          <select value={hoursPerRevolution()} onChange={(e) => setHours(Number(e.currentTarget.value) as 24 | 12)}>
            <option value={24}>24h — one revolution</option>
            <option value={12}>12h — AM/PM bands</option>
          </select>
        </label>

        <label>
          DST placement
          <select value={policy()} onChange={(e) => setPolicy(e.currentTarget.value as DstPolicy)}>
            <option value={DstPolicy.AtTransition}>At transition</option>
            <option value={DstPolicy.AtDayEnd}>At day end</option>
          </select>
        </label>

        <label>
          Emphasize
          <select value={emphasis()} onChange={(e) => setEmphasis(e.currentTarget.value as Emphasis)}>
            <option value={Emphasis.All}>Everything</option>
            <option value={Emphasis.Now}>Happening now</option>
            <option value={Emphasis.Instants}>Instants</option>
            <option value={Emphasis.Durations}>Finished durations</option>
          </select>
        </label>
      </div>

      <div class="stage" ref={host}>
        <svg viewBox={viewBox()} role="img" aria-label="Radial calendar spike">
          <defs>
            <pattern
              id="voidHatch"
              width="4"
              height="4"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="4" class="void-hatch-line" />
            </pattern>
          </defs>

          <For each={hourTicks(hoursPerRevolution())}>
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
                <For each={band.bg}>
                  {(seg) => <path d={seg.path} class={`ringbg bg-${seg.cls}`} />}
                </For>
                <For each={band.marks}>
                  {(mark) =>
                    mark.kind === 'arc' ? (
                      <path
                        d={mark.path}
                        fill={mark.color}
                        stroke={mark.ongoing ? mark.color : undefined}
                        classList={{ mark: true, ongoing: mark.ongoing, dim: dimArc(mark.ongoing) }}
                      />
                    ) : (
                      <g transform={`rotate(${mark.angleDeg})`}>
                        <line
                          y1={-(mark.r0 - 2.5)}
                          y2={-(mark.r1 + 2.5)}
                          stroke={mark.color}
                          classList={{ 'instant-tick': true, dim: dimTick() }}
                        />
                      </g>
                    )
                  }
                </For>
                <Show when={band.anomaly}>
                  {(anomaly) => (
                    <path
                      d={anomaly().path}
                      class={anomaly().isSpur ? 'anomaly spur' : 'anomaly void'}
                    />
                  )}
                </Show>
              </g>
            )}
          </For>

          {/* "Now" on the most recent ring -- doubles as the ongoing arc's leading edge. */}
          <g transform={`rotate(${nowAngleDeg()})`}>
            <line
              y1={-(nowBand().r0 - 4)}
              y2={-(nowBand().r1 + 4)}
              classList={{ 'now-line': true, dim: emphasis() === Emphasis.Instants || emphasis() === Emphasis.Durations }}
            />
          </g>

          <circle r={2.5} class="hub" />
        </svg>
      </div>

      <footer>
        <div class="legend">
          <For each={tracks}>
            {(t) => (
              <span class="chip">
                <i style={{ background: t.color }} />
                {t.name}
              </span>
            )}
          </For>
          <span class="chip"><i class="swatch-instant" />instant (tick)</span>
          <span class="chip"><i class="swatch-ongoing" />ongoing → now</span>
          <span class="chip"><i class="swatch-spur" />repeated hour (spur)</span>
          <span class="chip"><i class="swatch-void" />skipped hour (void)</span>
          <span class="chip"><i class="swatch-day" />daylight</span>
          <span class="chip"><i class="swatch-twilight" />twilight</span>
          <span class="chip"><i class="swatch-night" />night</span>
        </div>

        <Show
          when={anomalousDays().length > 0}
          fallback={<p class="note">No DST transition in view — every ring is a 24-hour day.</p>}
        >
          <p class="note">
            <For each={anomalousDays()}>
              {(d) => (
                <span>
                  {d.date.toString()} is {d.actualHours}h ({d.shape}).{' '}
                </span>
              )}
            </For>
            Hour geometry is identical to every other ring — the difference is drawn, not scaled.
          </p>
        </Show>
      </footer>
    </div>
  )
}

function clamp(n: number): number {
  return Math.max(MIN_RINGS, Math.min(MAX_RINGS, n))
}

export type { Temporal }
