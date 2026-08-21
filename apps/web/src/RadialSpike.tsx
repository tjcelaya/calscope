import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { Temporal } from 'temporal-polyfill'
import {
  DstPolicy,
  anomalyGeometry,
  defaultRadialConfig,
  hourTicks,
  markFor,
  radialExtent,
  ringRadii,
  slotPosition,
  virtualDay,
} from '@calscope/views'
import { Gesture } from '@use-gesture/vanilla'
import { SCENARIOS, TIME_ZONE, generate, tracks, type ScenarioKey } from './fake-data'

const MIN_RINGS = 2
const MAX_RINGS = 14
const trackColor = new Map(tracks.map((t) => [t.id, t.color]))

export function RadialSpike() {
  // Raw UI state only -- everything derived below is a pure function of these.
  const [rings, setRings] = createSignal(7)
  const [hoursPerRevolution, setHours] = createSignal<24 | 12>(24)
  const [policy, setPolicy] = createSignal<DstPolicy>(DstPolicy.AtTransition)
  const [scenario, setScenario] = createSignal<ScenarioKey>('fallback')

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

  const bands = createMemo(() => {
    const cfg = config()
    const dayList = days()
    const ringAt = (i: number) => (i >= 0 && i < dayList.length ? ringRadii(cfg, i) : null)

    // Marks are collected per ring rather than per entry, because an event that crosses
    // midnight contributes geometry to two different rings.
    const marksByDay = new Map<number, Array<{ path: string; color: string }>>()
    for (const entry of entries()) {
      const dayIndex = dayList.findIndex((d) => d.date.equals(entry.start.toPlainDate()))
      if (dayIndex < 0) continue

      const startSlot = dayIndex * 24 + slotPosition(entry.start)
      const color = trackColor.get(entry.trackId) ?? '#888'

      for (const mark of markFor(cfg, ringAt, startSlot, startSlot + entry.endHours)) {
        const bucket = marksByDay.get(mark.dayOffset) ?? []
        bucket.push({ path: mark.path, color })
        marksByDay.set(mark.dayOffset, bucket)
      }
    }

    return dayList.map((day, dayIndex) => {
      const ring = ringRadii(cfg, dayIndex)
      return {
        day,
        ring,
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

  const anomalousDays = createMemo(() => days().filter((d) => d.shape !== 'normal'))

  return (
    <div class="spike">
      <header>
        <h1>calscope — radial spike</h1>
        <p class="sub">
          M0.5. Fake data, no engine, no persistence. Exists to answer two questions: does a ring
          stay legible past ~7 days, and does the spur read as information or as a rendering bug?
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
      </div>

      <div class="stage" ref={host}>
        <svg viewBox={viewBox()} role="img" aria-label="Radial calendar spike">
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
                <path
                  d={ringTrack(band.ring)}
                  class="band"
                  fill="none"
                  stroke-width={band.ring.r1 - band.ring.r0}
                />
                <For each={band.marks}>
                  {(mark) => <path d={mark.path} fill={mark.color} class="mark" />}
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
          <span class="chip"><i class="swatch-spur" />repeated hour (spur)</span>
          <span class="chip"><i class="swatch-void" />skipped hour (void)</span>
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

/** Centre-line circle of a band, stroked to its full thickness as the empty-day backdrop. */
function ringTrack(ring: { r0: number; r1: number }): string {
  const r = (ring.r0 + ring.r1) / 2
  return `M 0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${r} ${r} 0 1 1 0 ${-r}`
}

export type { Temporal }
