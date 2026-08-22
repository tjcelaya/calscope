import { For, Show, createSignal } from 'solid-js'
import { Temporal } from 'temporal-polyfill'
import { ValueType, type Entry, type Op, type Track } from './core'
import { upsertEntry, upsertTrack } from './persist'

/**
 * Minimal capture, so "My data" is real: create a track, then log against it. Every
 * write is an op through the persist layer -- the panel never mutates state directly;
 * the views re-render from the next fold.
 *
 * Reading the clock HERE is fine: capture is an App-boundary action recording when the
 * user pressed the button. The invariant forbids clock reads in views/geometry, where
 * they would make rendering impure -- not in event handlers.
 */
type Props = {
  tracks: readonly Track[]
  entries: readonly Entry[]
  tz: string
  onOps: (ops: Op[]) => void
  /** Wipe the local op log + gcal sync tokens, then reload. Prototype testing aid. */
  onReset: () => void
}

/**
 * Capture-level kinds map onto the model's value SHAPES: a moment logged now is a
 * Binary entry (start only), a started/stopped span is an Interval entry. Quantity and
 * Duration capture need value input UI -- that is M5's editor, not this panel.
 */
const CAPTURE_KINDS = [
  { valueType: ValueType.Binary, label: 'Instant (log a moment)' },
  { valueType: ValueType.Interval, label: 'Interval (start / stop)' },
] as const

const DEFAULT_COLORS = ['#6c7bff', '#d98b45', '#3fa7a0', '#8faa4b', '#c2557a', '#8f6cc4']

export function CapturePanel(props: Props) {
  const [name, setName] = createSignal('')
  const [valueType, setValueType] = createSignal<Track['valueType']>(ValueType.Binary)
  const [color, setColor] = createSignal(DEFAULT_COLORS[0]!)

  const nowIso = () => Temporal.Now.zonedDateTimeISO(props.tz).toString()

  const createTrack = () => {
    const trimmed = name().trim()
    if (trimmed === '') return
    props.onOps([
      upsertTrack({ name: trimmed, valueType: valueType(), tags: [], color: color() }),
    ])
    setName('')
    setColor(DEFAULT_COLORS[(props.tracks.length + 1) % DEFAULT_COLORS.length]!)
  }

  /** The still-running entry for a track: started (an Interval entry) but no end yet. */
  const ongoingOf = (trackId: string): Entry | undefined =>
    props.entries.find((e) => e.trackId === trackId && e.end === undefined)

  const logNow = (track: Track) => {
    props.onOps([upsertEntry({ trackId: track.id, start: nowIso() })])
  }

  const start = (track: Track) => {
    props.onOps([upsertEntry({ trackId: track.id, start: nowIso() })])
  }

  const stop = (entry: Entry) => {
    // Same entry id, end filled in: the fold's LWW replaces the open entry.
    props.onOps([upsertEntry({ ...entry, end: nowIso() })])
  }

  const toggleGapFill = (track: Track) => {
    const next: Track = { ...track }
    if (track.fillsGapBefore === true) delete next.fillsGapBefore
    else next.fillsGapBefore = true
    props.onOps([upsertTrack(next)])
  }

  return (
    <section class="panel capture">
      <h2>Capture</h2>

      <div class="capture-tracks">
        <Show
          when={props.tracks.length > 0}
          fallback={<p class="note small">No tracks yet — create one below to start logging.</p>}
        >
          <For each={props.tracks}>
            {(track) => {
              const ongoing = () => ongoingOf(track.id)
              return (
                <div class="capture-row">
                  <span class="chip">
                    <i style={{ background: track.color }} />
                    {track.name}
                  </span>
                  <label
                    class="gapfill-toggle"
                    title="Entries claim the span back to the previous event's end — e.g. a sleep instant logged at wake-up becomes the whole night."
                  >
                    <input
                      type="checkbox"
                      checked={track.fillsGapBefore === true}
                      onChange={() => toggleGapFill(track)}
                    />
                    fills gap
                  </label>
                  <Show
                    when={track.valueType === ValueType.Interval}
                    fallback={<button onClick={() => logNow(track)}>Log now</button>}
                  >
                    <Show
                      when={ongoing()}
                      fallback={<button onClick={() => start(track)}>Start</button>}
                    >
                      {(entry) => (
                        <button class="running" onClick={() => stop(entry())}>
                          Stop
                        </button>
                      )}
                    </Show>
                  </Show>
                </div>
              )
            }}
          </For>
        </Show>
      </div>

      <form
        class="capture-new"
        onSubmit={(ev) => {
          ev.preventDefault()
          createTrack()
        }}
      >
        <input
          type="text"
          placeholder="New track name"
          value={name()}
          onInput={(ev) => setName(ev.currentTarget.value)}
        />
        <select
          value={valueType()}
          onChange={(ev) => setValueType(ev.currentTarget.value as Track['valueType'])}
        >
          <For each={CAPTURE_KINDS}>
            {(kind) => <option value={kind.valueType}>{kind.label}</option>}
          </For>
        </select>
        <input
          type="color"
          value={color()}
          onInput={(ev) => setColor(ev.currentTarget.value)}
          aria-label="Track color"
        />
        <button type="submit" disabled={name().trim() === ''}>
          Add track
        </button>
      </form>

      <div class="capture-danger">
        <button
          class="danger"
          onClick={() => {
            if (
              globalThis.confirm(
                'Delete ALL local data — every track, entry, and the op log — plus the Google ' +
                  'sync tokens, then reload?\n\nGoogle Calendar itself is untouched; re-import ' +
                  'from the Google Calendar panel afterwards.',
              )
            ) {
              props.onReset()
            }
          }}
        >
          Wipe local data…
        </button>
        <span class="note small">
          Testing aid while the import heuristics are settling: dump everything local and pull
          again fresh.
        </span>
      </div>
    </section>
  )
}
