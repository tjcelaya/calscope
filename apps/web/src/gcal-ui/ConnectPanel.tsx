import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { Temporal } from 'temporal-polyfill'
import {
  AuthError,
  Era,
  GOOGLE_EVENT_COLORS,
  GcalApiError,
  buildDryRunReport,
  createGcalClient,
  createTokenProvider,
  dominantColorId,
  hexForColorId,
  type GcalCalendarListEntry,
  type GcalClient,
  type GcalEvent,
} from '@calscope/gcal'
import type { Entry, Op, Track } from '../core'
import {
  ClusterTarget,
  buildImportOps,
  defaultDecision,
  type ClusterDecision,
} from './import-plan'
import { loadGis } from './gis'
import { applyPullOutcome, pullCalendar } from './pull'
import { clearSyncToken, loadClientId, loadSyncToken, saveClientId, saveSyncToken } from './prefs'

/**
 * M1.5 connect-and-import panel. READ-ONLY by design: no affordance here writes to
 * Google -- that is M6, gated behind this path running cleanly for a while.
 *
 * All state is session-local solid signals except the client id and per-calendar
 * syncTokens (see ./prefs). Every actual import is ops through props.onOps; the panel
 * never mutates the fold directly.
 */

type Props = {
  tracks: readonly Track[]
  entries: readonly Entry[]
  onOps: (ops: Op[]) => void
}

type Session = { client: GcalClient }

const DEFAULT_MONTHS_BACK = 12

const ERA_LABELS: Record<Era, string> = {
  [Era.Bracket]: '[S] prefix (oldest)',
  [Era.Dot]: '. prefix (middle)',
  [Era.SourceTag]: '[source:scribcal] (recent)',
  [Era.ZeroDuration]: 'zero-duration (corroborator)',
  [Era.ColorCluster]: 'color cluster (weak)',
}

/** Errors must render legibly -- in this sandbox every Google request fails. */
function describeError(error: unknown): string {
  if (error instanceof GcalApiError) return `${error.name}: ${error.message}`
  if (error instanceof AuthError) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : ''
    return `${error.name}: ${error.message}${cause}`
  }
  if (error instanceof Error) return error.message
  return String(error)
}

function calLabel(cal: GcalCalendarListEntry): string {
  return cal.summary ?? cal.id
}

export function ConnectPanel(props: Props) {
  const [open, setOpen] = createSignal(false)
  const [clientId, setClientId] = createSignal(loadClientId())
  const [busy, setBusy] = createSignal<'connect' | 'pull' | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [session, setSession] = createSignal<Session | null>(null)
  const [calendars, setCalendars] = createSignal<GcalCalendarListEntry[] | null>(null)
  const [selected, setSelected] = createSignal<Record<string, boolean>>({})
  const [monthsBack, setMonthsBack] = createSignal(DEFAULT_MONTHS_BACK)
  const [eventsByCalendar, setEventsByCalendar] = createSignal<Record<string, GcalEvent[]>>({})
  const [pullNotes, setPullNotes] = createSignal<string[]>([])
  const [decisions, setDecisions] = createSignal<Record<string, ClusterDecision>>({})
  const [importSummary, setImportSummary] = createSignal<string | null>(null)

  const pulledCalendars = createMemo(() => {
    const events = eventsByCalendar()
    return (calendars() ?? []).filter((c) => events[c.id] !== undefined)
  })

  // The dry run re-derives from accumulated events on every pull -- pure and free, per
  // the report module's contract, and NOTHING is imported by computing it.
  const report = createMemo(() => {
    const cals = pulledCalendars()
    if (cals.length === 0) return null
    return buildDryRunReport({ calendars: cals, eventsByCalendar: eventsByCalendar() })
  })

  const allRejects = createMemo(() =>
    (report()?.calendars ?? []).flatMap((c) =>
      c.rejects.map((r) => ({ calendarId: c.calendarId, ...r })),
    ),
  )

  // Seed defaults for clusters the user has not touched; never clobber a user's choice.
  createEffect(() => {
    const r = report()
    if (r === null) return
    setDecisions((prev) => {
      let changed = false
      const next = { ...prev }
      for (const cluster of r.classification.clusters) {
        if (next[cluster.title] === undefined) {
          next[cluster.title] = defaultDecision(cluster, props.tracks)
          changed = true
        }
      }
      return changed ? next : prev
    })
  })

  const connect = () => {
    void (async () => {
      setError(null)
      setBusy('connect')
      try {
        const id = clientId().trim()
        if (id === '') throw new Error('Enter a Google OAuth web-application client id first.')
        saveClientId(id)
        const gis = await loadGis()
        const provider = createTokenProvider(gis)
        // One token per Connect (implicit flow, ~1h lifetime, no refresh token). When it
        // expires, requests fail visibly and Connect runs the silent-renew dance again.
        const token = await provider.getToken(id)
        const client = createGcalClient({
          fetch: (url, init) => fetch(url, init),
          getToken: () => Promise.resolve(token),
        })
        const cals = await client.listCalendars()
        setSession({ client })
        setCalendars(cals)
        setSelected((prev) => {
          const next: Record<string, boolean> = {}
          for (const cal of cals) next[cal.id] = prev[cal.id] ?? cal.primary === true
          return next
        })
      } catch (e) {
        setError(describeError(e))
      } finally {
        setBusy(null)
      }
    })()
  }

  const pull = () => {
    const s = session()
    if (s === null) return
    void (async () => {
      setError(null)
      setBusy('pull')
      const notes: string[] = []
      try {
        const nowUtc = Temporal.Now.zonedDateTimeISO('UTC')
        const window = {
          timeMin: nowUtc.subtract({ months: monthsBack() }).toInstant().toString(),
          // A week ahead so already-scheduled near-future events are visible too.
          timeMax: nowUtc.add({ days: 7 }).toInstant().toString(),
        }
        for (const cal of calendars() ?? []) {
          if (selected()[cal.id] !== true) continue
          const stored = loadSyncToken(cal.id) ?? undefined
          const outcome = await pullCalendar(s.client, cal.id, window, stored)
          if (outcome.resynced) clearSyncToken(cal.id)
          if (outcome.nextSyncToken !== undefined) saveSyncToken(cal.id, outcome.nextSyncToken)
          // A resynced pull REPLACES the accumulated set (see applyPullOutcome): merging
          // it would resurrect events deleted from Google while the token was expired.
          setEventsByCalendar((prev) => ({
            ...prev,
            [cal.id]: applyPullOutcome(prev[cal.id] ?? [], outcome),
          }))
          const mode =
            stored === undefined ? 'full pull' : outcome.resynced ? 'token expired, full re-pull' : 'incremental'
          notes.push(`${calLabel(cal)}: ${outcome.events.length} events (${mode})`)
        }
        setPullNotes(notes)
        setImportSummary(null)
      } catch (e) {
        setError(describeError(e))
      } finally {
        setBusy(null)
      }
    })()
  }

  const runImport = () => {
    const r = report()
    if (r === null) return
    setError(null)
    try {
      const plan = buildImportOps({
        clusters: r.classification.clusters,
        decisions: decisions(),
        calendars: pulledCalendars(),
        eventsByCalendar: eventsByCalendar(),
        tracks: props.tracks,
        existingEntryIds: new Set(props.entries.map((e) => e.id)),
      })
      props.onOps(plan.ops)
      setImportSummary(
        `Imported ${plan.entryCount} entries (${plan.trackCount} new tracks, ` +
          `${plan.deletionCount} deletions, ${plan.skippedTitles.length} clusters skipped, ` +
          `${plan.rejects.length} events rejected). Re-importing is a no-op: entry ids ` +
          `derive from Google event ids.`,
      )
    } catch (e) {
      setError(describeError(e))
    }
  }

  const setDecision = (title: string, decision: ClusterDecision) => {
    setDecisions((prev) => ({ ...prev, [title]: decision }))
  }

  const decisionValue = (title: string): string => {
    const d = decisions()[title]
    if (d === undefined) return ClusterTarget.Skip
    return d.target === ClusterTarget.Existing ? `existing:${d.trackId}` : d.target
  }

  const onDecisionChange = (title: string, value: string) => {
    if (value === ClusterTarget.NewTrack) {
      setDecision(title, { target: ClusterTarget.NewTrack, name: title })
    } else if (value === ClusterTarget.Skip) {
      setDecision(title, { target: ClusterTarget.Skip })
    } else if (value.startsWith('existing:')) {
      setDecision(title, { target: ClusterTarget.Existing, trackId: value.slice('existing:'.length) })
    }
  }

  const range = (first?: string, last?: string) =>
    first !== undefined && last !== undefined ? `${first.slice(0, 10)} → ${last.slice(0, 10)}` : '—'

  return (
    <section class="panel gcal">
      <style>{PANEL_CSS}</style>
      <button class="gcal-header" onClick={() => setOpen((o) => !o)} aria-expanded={open()}>
        <h2>
          {open() ? '▾' : '▸'} Google Calendar <span class="gcal-ro">read-only</span>
        </h2>
      </button>

      <Show when={open()}>
        <p class="note small">
          Imports events from your calendars into local tracks. calscope never writes to
          Google Calendar from this panel — the write path is a later, separately opted-in
          milestone.
        </p>

        <div class="gcal-connect">
          <input
            type="text"
            placeholder="Google OAuth client id (….apps.googleusercontent.com)"
            value={clientId()}
            onInput={(ev) => setClientId(ev.currentTarget.value)}
          />
          <button onClick={connect} disabled={busy() !== null || clientId().trim() === ''}>
            {busy() === 'connect' ? 'Connecting…' : session() !== null ? 'Reconnect' : 'Connect'}
          </button>
        </div>

        <Show when={error()}>
          {(msg) => (
            <div class="gcal-error" role="alert">
              <b>Google Calendar error.</b> {msg()}
            </div>
          )}
        </Show>

        <Show when={calendars()}>
          {(cals) => (
            <div class="gcal-cals">
              <h3>Calendars</h3>
              <For each={cals()}>
                {(cal) => (
                  <label class="gcal-cal">
                    <input
                      type="checkbox"
                      checked={selected()[cal.id] === true}
                      onChange={(ev) =>
                        setSelected((prev) => ({ ...prev, [cal.id]: ev.currentTarget.checked }))
                      }
                    />
                    {calLabel(cal)}
                    <span class="gcal-dim"> tz: {cal.timeZone ?? 'MISSING'}</span>
                    <Show when={loadSyncToken(cal.id) !== null}>
                      <span class="gcal-dim"> · incremental</span>
                    </Show>
                  </label>
                )}
              </For>
              <div class="gcal-pull">
                <label>
                  Months back
                  <input
                    type="number"
                    min="1"
                    max="240"
                    value={monthsBack()}
                    onInput={(ev) => {
                      const n = Number(ev.currentTarget.value)
                      if (Number.isFinite(n) && n >= 1) setMonthsBack(Math.floor(n))
                    }}
                  />
                </label>
                <button onClick={pull} disabled={busy() !== null}>
                  {busy() === 'pull' ? 'Pulling…' : 'Pull'}
                </button>
              </div>
              <Show when={pullNotes().length > 0}>
                <ul class="gcal-notes">
                  <For each={pullNotes()}>{(n) => <li>{n}</li>}</For>
                </ul>
              </Show>
            </div>
          )}
        </Show>

        <Show when={report()}>
          {(r) => (
            <div class="gcal-report">
              <h3>Dry run — nothing imported yet</h3>
              <p class="note small">
                {r().classification.total} events seen · {r().classification.cancelled} cancelled ·{' '}
                {r().classification.unmarked} unmarked · {r().totalRejects} rejected by the mapper
              </p>

              <div class="gcal-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Era</th>
                      <th>Count</th>
                      <th>Date range</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={Object.values(Era)}>
                      {(era) => {
                        const stats = () => r().classification.eras[era]
                        return (
                          <tr>
                            <td>{ERA_LABELS[era]}</td>
                            <td>{stats().count}</td>
                            <td>{range(stats().first, stats().last)}</td>
                          </tr>
                        )
                      }}
                    </For>
                  </tbody>
                </table>
              </div>

              <h3>Title clusters</h3>
              <div class="gcal-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Count</th>
                      <th>Date range</th>
                      <th>Eras</th>
                      <th>Legacy titles</th>
                      <th>Import as</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={r().classification.clusters}>
                      {(cluster) => {
                        const decision = () => decisions()[cluster.title]
                        // The color a "new track" decision would inherit -- the same
                        // dominant-colorId rule the import plan applies.
                        const colorId = dominantColorId(cluster.colorIds)
                        const hex = hexForColorId(colorId)
                        return (
                          <tr>
                            <td>
                              <Show when={hex !== undefined}>
                                <i
                                  class="cluster-swatch"
                                  style={{ background: hex }}
                                  title={colorId !== undefined ? GOOGLE_EVENT_COLORS[colorId]?.name : undefined}
                                />
                              </Show>
                              {cluster.title}
                            </td>
                            <td>{cluster.count}</td>
                            <td>{range(cluster.first, cluster.last)}</td>
                            <td>{cluster.eras.join(', ') || '—'}</td>
                            <td>{cluster.legacyTitles.join(', ') || '—'}</td>
                            <td>
                              <select
                                value={decisionValue(cluster.title)}
                                onChange={(ev) => onDecisionChange(cluster.title, ev.currentTarget.value)}
                              >
                                <option value={ClusterTarget.NewTrack}>New track</option>
                                <For each={props.tracks}>
                                  {(t) => <option value={`existing:${t.id}`}>Track: {t.name}</option>}
                                </For>
                                <option value={ClusterTarget.Skip}>Skip</option>
                              </select>
                              <Show
                                when={(() => {
                                  const d = decision()
                                  return d !== undefined && d.target === ClusterTarget.NewTrack ? d : undefined
                                })()}
                              >
                                {(d) => (
                                  <input
                                    type="text"
                                    class="gcal-name"
                                    value={d().name}
                                    aria-label="New track name"
                                    onInput={(ev) =>
                                      setDecision(cluster.title, {
                                        target: ClusterTarget.NewTrack,
                                        name: ev.currentTarget.value,
                                      })
                                    }
                                  />
                                )}
                              </Show>
                            </td>
                          </tr>
                        )
                      }}
                    </For>
                  </tbody>
                </table>
              </div>

              <Show when={allRejects().length > 0}>
                <h3>Rejected by the mapper</h3>
                <p class="note small">
                  Skipped, never silently dropped — typically a wall time inside a DST-skipped
                  hour or an unresolvable time zone.
                </p>
                <div class="gcal-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Calendar</th>
                        <th>Event id</th>
                        <th>Raw value</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={allRejects()}>
                        {(reject) => (
                          <tr>
                            <td>{reject.calendarId}</td>
                            <td>{reject.eventId}</td>
                            <td>{reject.raw}</td>
                            <td>{reject.reason}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </Show>

              <div class="gcal-import">
                <button onClick={runImport} disabled={busy() !== null}>
                  Import mapped clusters
                </button>
                <Show when={importSummary()}>{(s) => <p class="note small">{s()}</p>}</Show>
              </div>
            </div>
          )}
        </Show>
      </Show>
    </section>
  )
}

const PANEL_CSS = `
.gcal-header { background: none; border: none; padding: 0; cursor: pointer; text-align: left; color: inherit; width: 100%; }
.gcal-header h2 { margin: 0; }
.gcal-ro { font-size: 0.7rem; opacity: 0.65; border: 1px solid currentColor; border-radius: 4px; padding: 1px 6px; margin-left: 8px; vertical-align: middle; }
.gcal-connect { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.gcal-connect input[type='text'] { flex: 1; min-width: 220px; }
.gcal-error { margin-top: 10px; padding: 8px 10px; border: 1px solid #c2557a; border-radius: 6px; background: rgba(194, 85, 122, 0.12); font-size: 0.85rem; overflow-wrap: anywhere; }
.gcal-cals, .gcal-report { margin-top: 12px; }
.gcal h3 { font-size: 0.85rem; margin: 12px 0 6px; opacity: 0.85; }
.gcal-cal { display: block; font-size: 0.85rem; padding: 2px 0; }
.gcal-dim { opacity: 0.55; font-size: 0.78rem; }
.gcal-pull { display: flex; gap: 10px; align-items: end; margin-top: 8px; }
.gcal-pull label { display: flex; flex-direction: column; font-size: 0.78rem; gap: 2px; }
.gcal-pull input { width: 70px; }
.gcal-notes { margin: 6px 0 0; padding-left: 18px; font-size: 0.78rem; opacity: 0.8; }
.gcal-scroll { overflow-x: auto; }
.gcal table { border-collapse: collapse; font-size: 0.8rem; width: 100%; }
.gcal th, .gcal td { text-align: left; padding: 4px 8px; border-bottom: 1px solid rgba(128, 128, 128, 0.25); vertical-align: top; }
.gcal th { opacity: 0.65; font-weight: 600; }
.gcal-name { margin-top: 4px; display: block; width: 100%; }
.gcal-import { margin-top: 12px; }
`
