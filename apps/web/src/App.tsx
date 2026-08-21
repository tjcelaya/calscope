import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { DstPolicy } from '@calscope/views'
import { Gesture } from '@use-gesture/vanilla'
import { SCENARIOS, tracks, type ScenarioKey } from './fake-data'
import { Emphasis, RingOrder, buildModel } from './spike-model'
import { RadialView } from './RadialView'
import { ColumnsView } from './ColumnsView'
import { GridView } from './GridView'

const MIN_RINGS = 2
const MAX_RINGS = 14

export function App() {
  // Raw UI state only -- everything derived is a pure function of these.
  const [rings, setRings] = createSignal(7)
  const [mode, setMode] = createSignal<24 | 12>(24)
  const [policy, setPolicy] = createSignal<DstPolicy>(DstPolicy.AtTransition)
  const [scenario, setScenario] = createSignal<ScenarioKey>('fallback')
  const [emphasis, setEmphasis] = createSignal<Emphasis>(Emphasis.All)
  const [order, setOrder] = createSignal<RingOrder>(RingOrder.NewestOut)

  let radialHost!: HTMLDivElement

  onMount(() => {
    const gesture = new Gesture(
      radialHost,
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
  const model = createMemo(() => buildModel(start(), rings(), policy()))
  const anomalousDays = createMemo(() => model().days.filter((d) => d.day.shape !== 'normal'))

  return (
    <div class="spike">
      {/* Shared defs, referenced by every view's svg in this document. */}
      <svg width="0" height="0" style="position:absolute">
        <defs>
          <pattern id="voidHatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" class="void-hatch-line" />
          </pattern>
        </defs>
      </svg>

      <header>
        <h1>calscope — view spikes</h1>
        <p class="sub">
          M0.5+. Fake data, no engine, no persistence. One shared day-model, three
          projections rendered side by side so cross-view consistency is checkable by eye:
          the same instant, meeting-inside-ongoing-workday, DST anomaly and daylight in
          each.
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
          Days (zoom) <b>{rings()}</b>
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
          <select value={mode()} onChange={(e) => setMode(Number(e.currentTarget.value) as 24 | 12)}>
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

        <label>
          Newest day
          <select value={order()} onChange={(e) => setOrder(e.currentTarget.value as RingOrder)}>
            <option value={RingOrder.NewestOut}>Outer edge</option>
            <option value={RingOrder.NewestIn}>Center</option>
          </select>
        </label>
      </div>

      <div class="views">
        <section class="panel panel-radial">
          <h2>Radial</h2>
          <div class="stage" ref={radialHost}>
            <RadialView model={model()} mode={mode()} emphasis={emphasis()} order={order()} />
          </div>
        </section>

        <section class="panel">
          <h2>Day columns</h2>
          <ColumnsView model={model()} emphasis={emphasis()} />
        </section>

        <section class="panel">
          <h2>Year grid (excerpt)</h2>
          <GridView model={model()} emphasis={emphasis()} />
          <p class="note small">
            At real day-granularity zoom these cells collapse to goal-status checkboxes —
            that needs the engine (M3). The micro-timelines exist for cross-view
            consistency checking.
          </p>
        </section>
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
          fallback={<p class="note">No DST transition in view — every day is 24 hours.</p>}
        >
          <p class="note">
            <For each={anomalousDays()}>
              {(d) => (
                <span>
                  {d.day.date.toString()} is {d.day.actualHours}h ({d.day.shape}).{' '}
                </span>
              )}
            </For>
            Hour geometry is identical everywhere — the difference is drawn, not scaled.
          </p>
        </Show>
      </footer>
    </div>
  )
}

function clamp(n: number): number {
  return Math.max(MIN_RINGS, Math.min(MAX_RINGS, n))
}
