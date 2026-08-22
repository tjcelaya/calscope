import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import { Temporal } from 'temporal-polyfill'
import { DstPolicy, RingOrder } from '@calscope/views'
import { Gesture } from '@use-gesture/vanilla'
import type { Op, Track } from './core'
import { OpStore, actorClock } from './persist'
import { LAT, LNG, SCENARIOS, TIME_ZONE, demoTracks, generateEntries, simulatedNow, type ScenarioKey } from './fake-data'
import { Emphasis, buildModel } from './model'
import { CapturePanel } from './CapturePanel'
import { ConnectPanel } from './gcal-ui/ConnectPanel'
import { RadialView } from './RadialView'
import { DayCirclesView } from './DayCirclesView'
import { ColumnsView } from './ColumnsView'
import { GridView } from './GridView'

const MIN_RINGS = 2
const MAX_RINGS = 14

/** Where the entries and tracks come from; both feed the same buildModel. */
const DataSource = {
  Demo: 'demo',
  Mine: 'mine',
} as const
type DataSource = (typeof DataSource)[keyof typeof DataSource]

/**
 * Persisted UI prefs. localStorage is guarded -- private windows and disabled storage
 * throw, and then prefs are simply session-local. Values are validated against the
 * closed set on read, so a stale or hand-edited value degrades to the default.
 */
const PREF = {
  dataSource: 'calscope.ui.dataSource',
  mode: 'calscope.ui.mode',
  policy: 'calscope.ui.policy',
  emphasis: 'calscope.ui.emphasis',
  ringOrder: 'calscope.ui.ringOrder',
  connect: 'calscope.ui.connect',
} as const

function loadPref<T extends string>(key: string, valid: readonly T[]): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key) ?? null
    return raw !== null && (valid as readonly string[]).includes(raw) ? (raw as T) : null
  } catch {
    return null
  }
}

function savePref(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // Best-effort; see loadPref.
  }
}

/** How often the real clock re-enters the app. 30s keeps ongoing marks honest without
 * re-deriving geometry every frame. */
const CLOCK_TICK_MS = 30_000

export function App() {
  // The ONE place the real clock is read for rendering: a signal at the App boundary,
  // passed down as a parameter. Views and geometry never read the clock (invariant).
  const deviceTz = Temporal.Now.timeZoneId()
  const [clockNow, setClockNow] = createSignal(Temporal.Now.zonedDateTimeISO(deviceTz))

  // Raw UI state only -- everything derived is a pure function of these.
  const storedSource = loadPref<DataSource>(PREF.dataSource, Object.values(DataSource))
  const [dataSource, setDataSource] = createSignal<DataSource>(storedSource ?? DataSource.Demo)
  const [rings, setRings] = createSignal(7)
  const [mode, setMode] = createSignal<24 | 12>(loadPref(PREF.mode, ['24', '12']) === '12' ? 12 : 24)
  const [policy, setPolicy] = createSignal<DstPolicy>(
    loadPref<DstPolicy>(PREF.policy, Object.values(DstPolicy)) ?? DstPolicy.AtTransition,
  )
  const [scenario, setScenario] = createSignal<ScenarioKey>('fallback')
  const [emphasis, setEmphasis] = createSignal<Emphasis>(
    loadPref<Emphasis>(PREF.emphasis, Object.values(Emphasis)) ?? Emphasis.All,
  )
  const [order, setOrder] = createSignal<RingOrder>(
    loadPref<RingOrder>(PREF.ringOrder, Object.values(RingOrder)) ?? RingOrder.NewestOut,
  )
  const [connect, setConnect] = createSignal(loadPref(PREF.connect, ['on', 'off']) !== 'off')

  // The op-log store: opened once, folded state exposed as a resource re-fetched after
  // every write. All semantics live in persist/core's fold; the app only appends ops.
  const storePromise = OpStore.open({ clock: actorClock() })
  const [writeCount, setWriteCount] = createSignal(0)
  const [snapshot] = createResource(writeCount, async () => (await storePromise).getState())

  const appendOps = (ops: Op[]) => {
    void (async () => {
      const store = await storePromise
      await store.appendMany(ops)
      // A capture should be visible immediately -- refresh the clock alongside the fold
      // so a just-started entry's ongoing mark reaches the current minute.
      setClockNow(Temporal.Now.zonedDateTimeISO(deviceTz))
      setWriteCount((n) => n + 1)
    })()
  }

  // Demo is the default only while the store is empty: returning users with data (and
  // no explicit choice saved) land on their own data. Runs once; a user choice below
  // persists and takes precedence on the next load.
  let sourceResolved = storedSource !== null
  createEffect(() => {
    const snap = snapshot()
    if (!snap || sourceResolved) return
    sourceResolved = true
    if (Object.keys(snap.tracks).length > 0 || Object.keys(snap.entries).length > 0) {
      setDataSource(DataSource.Mine)
    }
  })

  onMount(() => {
    const timer = setInterval(
      () => setClockNow(Temporal.Now.zonedDateTimeISO(deviceTz)),
      CLOCK_TICK_MS,
    )
    onCleanup(() => clearInterval(timer))
  })

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

  const myTracks = createMemo<Track[]>(() => {
    const snap = snapshot()
    if (!snap) return []
    return Object.values(snap.tracks).sort((a, b) => a.name.localeCompare(b.name))
  })
  const myEntries = createMemo(() => Object.values(snapshot()?.entries ?? {}))

  const model = createMemo(() => {
    const count = rings()
    if (dataSource() === DataSource.Demo) {
      const start = SCENARIOS.find((s) => s.key === scenario())!.start
      return buildModel(
        generateEntries(start, count),
        demoTracks,
        { start, days: count, tz: TIME_ZONE, lat: LAT, lng: LNG },
        policy(),
        // The demo's clock stays simulated so the fixture is deterministic; still an
        // input parameter, same as the real one.
        simulatedNow(start, count),
      )
    }
    const now = clockNow()
    const start = now.toPlainDate().subtract({ days: count - 1 })
    return buildModel(
      myEntries(),
      myTracks(),
      // Daylight coords are still spike-fidelity NYC values; deriving them from the
      // device zone via zone1970.tab is M2 work.
      { start, days: count, tz: deviceTz, lat: LAT, lng: LNG },
      policy(),
      now,
    )
  })

  const legendTracks = createMemo<readonly Track[]>(() =>
    dataSource() === DataSource.Demo ? demoTracks : myTracks(),
  )
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
        <h1>calscope</h1>
        <p class="sub">
          Three projections of one shared day-model, fed either by the deterministic demo
          fixture or by your own op-log data. Capture a track, log against it, and the
          same instant ticks, nested intervals, ongoing-to-now and DST anomalies appear
          in every view.
        </p>
      </header>

      <div class="controls">
        <label>
          Data
          <select
            value={dataSource()}
            onChange={(e) => {
              const v = e.currentTarget.value as DataSource
              sourceResolved = true
              setDataSource(v)
              savePref(PREF.dataSource, v)
            }}
          >
            <option value={DataSource.Demo}>Demo data</option>
            <option value={DataSource.Mine}>My data</option>
          </select>
        </label>

        <Show when={dataSource() === DataSource.Demo}>
          <label>
            Scenario
            <select value={scenario()} onChange={(e) => setScenario(e.currentTarget.value as ScenarioKey)}>
              <For each={SCENARIOS}>{(s) => <option value={s.key}>{s.label}</option>}</For>
            </select>
          </label>
        </Show>

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
          <select
            value={mode()}
            onChange={(e) => {
              const v = Number(e.currentTarget.value) as 24 | 12
              setMode(v)
              savePref(PREF.mode, String(v))
            }}
          >
            <option value={24}>24h — one revolution</option>
            <option value={12}>12h — AM/PM bands</option>
          </select>
        </label>

        <label>
          DST placement
          <select
            value={policy()}
            onChange={(e) => {
              const v = e.currentTarget.value as DstPolicy
              setPolicy(v)
              savePref(PREF.policy, v)
            }}
          >
            <option value={DstPolicy.AtTransition}>At transition</option>
            <option value={DstPolicy.AtDayEnd}>At day end</option>
          </select>
        </label>

        <label>
          Emphasize
          <select
            value={emphasis()}
            onChange={(e) => {
              const v = e.currentTarget.value as Emphasis
              setEmphasis(v)
              savePref(PREF.emphasis, v)
            }}
          >
            <option value={Emphasis.All}>Everything</option>
            <option value={Emphasis.Now}>Happening now</option>
            <option value={Emphasis.Instants}>Instants</option>
            <option value={Emphasis.Durations}>Finished durations</option>
          </select>
        </label>

        <label>
          Newest day
          <select
            value={order()}
            onChange={(e) => {
              const v = e.currentTarget.value as RingOrder
              setOrder(v)
              savePref(PREF.ringOrder, v)
            }}
          >
            <option value={RingOrder.NewestOut}>Outer edge</option>
            <option value={RingOrder.NewestIn}>Center</option>
          </select>
        </label>

        <label class="check">
          <input
            type="checkbox"
            checked={connect()}
            onChange={(e) => {
              const v = e.currentTarget.checked
              setConnect(v)
              savePref(PREF.connect, v ? 'on' : 'off')
            }}
          />
          Connected crossings
        </label>
      </div>

      <Show when={dataSource() === DataSource.Mine}>
        <CapturePanel tracks={myTracks()} entries={myEntries()} tz={deviceTz} onOps={appendOps} />
      </Show>

      {/* Always mounted (collapsed by default): viewer-only mode over a calendar with
          zero local entries is a stated M1.5 requirement, so it must not hide behind
          the "My data" source switch. */}
      <ConnectPanel tracks={myTracks()} entries={myEntries()} onOps={appendOps} />


      <div class="views">
        <section class="panel panel-radial">
          <h2>Radial</h2>
          <div class="stage" ref={radialHost}>
            <RadialView
              model={model()}
              mode={mode()}
              emphasis={emphasis()}
              order={order()}
              connect={connect()}
            />
          </div>
        </section>

        <section class="panel">
          <h2>Day circles</h2>
          <DayCirclesView model={model()} mode={mode()} emphasis={emphasis()} connect={connect()} />
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
            that needs the engine wiring of M3. The micro-timelines exist for cross-view
            consistency checking.
          </p>
        </section>
      </div>

      <footer>
        <div class="legend">
          <For each={legendTracks()}>
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
