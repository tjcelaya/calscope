# timeslife

A local-first tool for **goals, events, and routines** on one composable model, rendered
through three quite different calendar views.

It is an installable PWA served as static files — self-hostable by anyone, no accounts, no
database to run. Google Calendar is a **peer store**: timeslife reads and writes it, but is
no more canonical than it is.

---

## 1. What it is for

Most habit trackers can express "did I do this today" and nothing else. timeslife exists to
express the things that actually describe a life:

- **Did this occur — or deliberately *not* occur — inside a window?**
  ("Took my meds today." "Didn't drink this week.")
- **Was the sum of this *type* of thing above or below a target?**
  ("Total caffeine under 400mg/day", where caffeine means espresso *and* tea *and* whatever
  you start logging next March.)
- …where the **window itself may be on its own complex schedule**
  ("weekday mornings excluding holidays", "the hour before whenever I actually went to bed").

Three requirements fall out of that, and they drive the whole design:

1. **Windows need an algebra**, not a recurrence string. A single RRULE cannot say
   "weekday mornings, excluding holidays, plus any day after a long run."
2. **Goals need a selector**, not a list of track ids. A hardcoded list silently stops being
   correct the moment you add a new source of the thing you are measuring.
3. **Time must be modelled honestly.** A day is 23, 24, or 25 hours. Two different instants
   can both be "1:30am". Getting this wrong is invisible until twice a year, when it is wrong
   everywhere at once.

### The three views

| View | Layout | Zoom means |
|---|---|---|
| **Radial** | Concentric rings of days. Arc start/end = event start/end; ring distance from centre = day offset. 24h mode = one revolution per day, 12h mode = two (AM/PM bands). | Number of rings |
| **Vertical scroll** | Year/month/week stacked vertically. The Simone Giertz "did I do this" checkbox grid lives here. | Day / week / month granularity |
| **Horizontal columns** | N vertical day columns, scrolling sideways. X = day, Y = time of day. | Number of columns |

All three are custom SVG over a **single shared geometry contract**. Zoom is one number,
interpreted per view, so switching views preserves your sense of scale.

### Relationship to `scribcal-android`

[`tjcelaya/scribcal-android`](https://github.com/tjcelaya/scribcal-android) is an existing
Kotlin app that captures events and writes them to Google Calendar, and holds real event
history that timeslife must visualise. Its Room schema is timeslife's model in embryo
(`EventType`→`Track`, `Cadence`→`ValueType`, and an `Event` with the identical
instant/ongoing/completed states), so nothing needs redesigning to accept that history.

**Division of labour:** scribcal stays a capture client for the one thing a PWA genuinely
cannot do — hold a persistent silent notification you can stop a running timer from.
timeslife owns the model, goals, and views. Google Calendar is the bus between them, and
scribcal needs no new integration code.

---

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | The algebras are where types earn their keep |
| UI | **Solid** + Vite | Fine-grained reactivity: a zoom frame updates only changed attributes across hundreds of SVG arcs, no VDOM diff. Small, stable API surface |
| PWA | `vite-plugin-pwa` | Service worker + manifest |
| Dates | **`temporal-polyfill`** | `Date` cannot do DST-correct day math. Temporal is ES2026 but Safari has not shipped it |
| Recurrence | `rrule` as one *leaf* of the schedule algebra | Calendar interop; not expressive enough alone |
| Geometry | `d3-shape` / `d3-scale` — **math only** | `d3.arc()` generates the radial arcs. Solid owns the DOM; d3 never touches it |
| Virtualization | `@tanstack/solid-virtual` *(planned, not yet installed)* | Headless — returns indices and offsets, renders nothing, which is what lets it drive SVG cells. Framework-agnostic core with per-framework adapters |
| Gestures | `@use-gesture/vanilla` | No framework adapter needed |
| App state | Solid signals — **no state library** | Only raw UI state is reactive (~5 values); everything derived is a pure function |
| Validation | `valibot` | ~2KB; schemas derive from the same enum constants |
| Tests | `vitest` + `fast-check` | Property tests on the interval and selector algebras and the op-log fold. **Gap: the `Schedule` evaluator has example-based tests only** — worth closing |

Deliberately **not** using an off-the-shelf calendar library (FullCalendar, Schedule-X, …).
None do radial layout or these zoom semantics; all would be fought rather than used.

### Repo layout

```
packages/core/     zero-DOM: model, time, schedule algebra, selectors, goals, op log
  src/model/         enums.ts (as-const unions), types.ts, schemas.ts (valibot)
  src/time/          interval algebra, DST-correct calendar windows
  src/schedule/      Schedule evaluator
  src/select/        TrackSelector resolver + unit conversion
  src/goals/         goal + routine evaluation
  src/store/         HLC clock, append-only op log, fold
  bin/eval.ts        CLI: print GoalResult tables from a JSON fixture
packages/views/    pure geometry: TimeScale implementations, no framework
packages/gcal/     (not yet created) Calendar REST client, OAuth, import heuristics
packages/ui/       (not yet created) Solid components
apps/web/          Vite + Solid + PWA
```

---

## 3. Core model

Two **orthogonal** axes on a track, which it is tempting and wrong to collapse into one:

- **`valueType`** — what *shape* the data is: `Binary | Quantity | Duration | Interval`.
- **`tags`** — what *kind of thing* it is: caffeine, exercise, meds. Hierarchical
  (`cardio` under `exercise`); selection is transitive.

```ts
type Track = {
  id: TrackId
  name: string
  valueType: ValueType
  tags: TagId[]
  unit?: Unit                // required when valueType is Quantity
  polarity?: Polarity
  color: string
  calendarId?: string        // routes writes to a specific Google calendar
  legacyTitles?: string[]    // historic title forms, for idempotent re-import
}

type Entry = {
  id: EntryId
  trackId: TrackId
  start: string              // ISO ZonedDateTime WITH offset
  end?: string
  value?: number
  tags?: TagId[]
  gcalEventId?: string
  gcalUpdated?: string       // Google's timestamp; wins for gcal-backed entries
}
```

A Giertz checkbox is an `Entry` on a `Binary` track. A calendar event is an `Entry` on an
`Interval` track. No special cases.

### Two algebras, deliberately the same shape

`Schedule` answers **when**. `TrackSelector` answers **what**. Both are composable,
serializable, and evaluated by pure, exhaustively-switched functions.

```ts
type Schedule =
  | { t: Calendar;   unit: CalendarUnit; tz: string; weekStart?: number }
  | { t: Rrule;      rrule: string; duration?: IsoDuration; tz: string }
  | { t: Dates;      dates: string[]; duration?: IsoDuration; tz: string }
  | { t: Span;       start: string; end: string }
  | { t: Union;      of: Schedule[] }
  | { t: Intersect;  of: Schedule[] }
  | { t: Difference; from: Schedule; minus: Schedule }
  | { t: Shift;      of: Schedule; by: IsoDuration; tz: string }
  | { t: Clip;       of: Schedule; to: Schedule }
  | { t: Filter;     of: Schedule; pred: PredicateRef; tz: string }
  | { t: Derived;    fromTrack: TrackId; before?: IsoDuration; after?: IsoDuration }

type TrackSelector =
  | { t: Track; ids: TrackId[] }
  | { t: Tag;   tags: TagId[]; match: 'any' | 'all'; transitive?: boolean }
  | { t: ValueType; valueTypes: ValueType[] }
  | { t: All }
  | { t: Union | Intersect; of: TrackSelector[] }
  | { t: Except; from: TrackSelector; minus: TrackSelector }
```

`occurrences(schedule, range, ctx)` → normalized `Interval[]`.
`resolve(selector, tracks, tags)` → `Track[]`.

### Goals read as one sentence

**`what`** measured by **`aggregate`** within each **`when`** window, compared to **`target`**.

```ts
type Goal = {
  what: TrackSelector
  when: Schedule
  aggregate: AggregateFn   // Count | Sum | Duration | Max | Min | Exists | DistinctDays
  compare: Comparator      // >= <= > < == !=
  target: number
  unit?: Unit              // REQUIRED when aggregate is Sum
  grace?: number           // DECLARED, NOT YET EVALUATED -- see below
  rollup?: Schedule        // DECLARED, NOT YET EVALUATED -- see below
}
```

> **`Goal.grace`, `Goal.rollup` and `Routine.ordered` are declared but not implemented.**
> They are typed, valibot-validated, stored and folded — and then read by nothing. A goal
> authored with `grace: 1` validates cleanly and is silently ignored, which is the worst
> possible failure mode because the data round-trips and nothing looks broken. Do not author
> goals using them until M5 implements them.

| Goal in English | Encoding |
|---|---|
| Total caffeine under 400mg/day | `Tag('caffeine')`, `Sum`, `<=`, 400, unit `mg` |
| 150 min exercise per week | `Tag('exercise', transitive)`, `Duration`, `>=`, 150, weekly |
| Did I take my meds today | `Tag('meds')`, `Exists`, `>`, 0 |
| Did I **not** drink this week | `Track('alcohol')`, `Exists`, `==`, 0, weekly |
| Gym on 3 distinct days a week | `Tag('gym')`, `DistinctDays`, `>=`, 3, weekly |
| No screens 1h before bedtime | `Tag('screens')`, `Exists`, `==`, 0, `when: Derived(bedtime, before 1h)` |

`evaluateGoal()` returns `GoalResult[]` — **one function feeds every view**. Cell colours in
the year grid, arc fills in the radial view, and streak counts all read the same thing.

A **Routine** is `{ when: Schedule, goals: GoalId[] }` — a named bundle whose status is the
weakest of its members. No new evaluation machinery.

### Storage: append-only op log

State is a fold over an append-only log of `Op`s carrying hybrid-logical-clock timestamps,
with last-writer-wins per record. The fold is **order-independent** (property-tested), which
is the entire point: adding a sync relay later becomes "ship the ops" with **no data
migration**.

---

## 4. Invariants — do not break these

These are load-bearing. Each was arrived at by getting it wrong first.

1. **Locked zoom.** Slot geometry is a function of zoom *alone*, never of a day's real
   length: `slotSize(zoom)`, never `slotSize(zoom, dayHours)`. If a 25-hour day squeezed 25
   slots into a normal day's sweep, 3pm would sit at a different angle on adjacent days and
   the views would stop being comparable. DST is drawn as an **extra mark**, never a rescale.

2. **Windows are a partition, not a point set.** `normalize()` merges *touching* intervals —
   correct for set algebra, but it collapses seven tiling daily windows into one blob. Use
   `normalizeWindows()` (merges only *strictly overlapping*) for generators and union; full
   `normalize()` only for the mask side of intersect/difference.

3. **Generators return whole windows**, not windows clipped to the query range. A weekly
   goal viewed on a Wednesday must evaluate the *whole* week — clipping would total one day
   against a weekly target and report `Missed`.

4. **`intersect` is deliberately asymmetric.** The left operand supplies window structure;
   the right is only a mask. `intersect(daily, workHours)` gives one window per day.
   Commutativity holds on the covered *point set*, not the subdivision.

5. **Shift happens in ZonedDateTime space.** `Instant.add` rejects calendar units outright,
   and rightly so — "the day after" is 23 or 25 hours across a transition.

6. **Day boundaries come from `PlainDate → startOfDay`**, never `start + 24h`.

7. **Entry timestamps parse with `offset: 'reject'`.** This — not `disambiguation` — is what
   rejects 02:30 on a spring-forward morning, and what keeps the two 1:30ams of a fall-back
   night as **distinct instants** (05:30Z and 06:30Z).

8. **`Pending` vs `Missed` vs `Scheduled` are distinct.** A window that has not closed cannot
   be missed; a future window is merely scheduled. Collapsing them makes the UI lie every
   morning.

9. **Unit coherence is enforced, never assumed.** A `Sum` goal must declare a unit;
   convertible tracks are converted, non-convertible ones are **excluded and reported** via
   `GoalResult.excludedTrackIds` — never silently summed into garbage.

10. **No store is canonical.** For any entry with a `gcalEventId`, Google's `updated` wins on
    conflict. Local deletion does not imply remote deletion (or vice versa). Viewer-only
    mode — useful over a calendar with zero local entries — must keep working; it is the
    regression test for this whole framing.

11. **The framework boundary is lint-enforced.** `solid-js` may not be imported from
    `core`, `views`, or `gcal`. That rule *is* the framework hedge — do not wrap Solid's
    reactivity in a portability layer, and do not disable the rule.

12. **Enums are `as const` objects**, never TS `enum` (reverse mappings, `const enum` banned
    under `isolatedModules`, members not assignable from plain strings — which would break
    op-log deserialization). Valibot schemas derive from the same constants so they cannot
    drift.

---

## 5. Status

**Done: M0, M0.5, M1.** 103 tests; lint, typecheck and build clean.

| Package | State |
|---|---|
| `packages/core` | Complete for M1: enums, valibot schemas, interval algebra, calendar windows, schedule evaluator, selector resolver, unit conversion, goal + routine evaluation, HLC, op log, `pnpm eval` CLI |
| `packages/views` | `virtualDay()` + radial geometry only (from the spike). No `TimeScale` interface yet |
| `apps/web` | Radial **spike** only — fake data, no engine, no persistence. Throwaway UI; the geometry it proved is the seed of `packages/views` |

### Spike findings (M0.5)

- **Rings stay legible to ~14 days.** The binding constraint is the *inner* radius, not ring
  count — the innermost bands cramp badly. Raise `innerRadius` relative to `ringThickness`,
  and consider a minimum-arc-length floor. Unexpected upside: at 14 rings, day-to-day drift
  in a routine reads as a diagonal texture the vertical grid cannot give.
- **The spur reads as information at ≤7 rings**, weakening toward "stray mark" at 14.
  `spurHeight` should scale with ring pitch rather than being constant.
- **12h mode needs more than a radial split.** A gap between AM/PM sub-bands helps and is
  implemented, but the mode still needs an explicit affordance — labels, differing opacity,
  or a day-separator spoke. **Open.**
- **Overlapping marks need z-order rules.** A long event painted after a short one hides it
  entirely. Needs explicit ordering or lane insetting. **Open.**

### CI and hosting

`.github/workflows/ci.yml` runs lint → typecheck → test → build on every push and PR, then
deploys to **Cloudflare Pages** from the default branch. Deploy is a step in the same job as
the tests, so the bytes published are exactly the bytes just built and tested.

**Not GitHub Pages:** it only publishes from public repositories on the Free plan. Cloudflare
Pages is free with private repos, and it is where the project is heading anyway — the sync
relay below is specced as a Cloudflare Worker + Durable Object, and the optional OAuth token
broker is the same shape.

Requires two repo secrets, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and a Pages
project named `timeslife` created as **Direct Upload** — CI pushes the build itself, so
Cloudflare never needs repository access.

**Base path.** Cloudflare Pages serves from the root of its own subdomain, so `BASE_PATH` is
unset and the bundle is root-relative. The mechanism is kept for self-hosters: serving under
a subpath needs the prefix in both Vite's `base` *and* the PWA manifest's `start_url` and
`scope`, because a service worker cannot control pages outside its scope — a `/` scope on a
`/timeslife/` deployment silently disables offline support with nothing failing loudly.

**This origin matters for M1.5:** `https://timeslife.pages.dev` must be an authorized
JavaScript origin on the Google OAuth web client.

An updated `ci.yml` may sit in `.github/workflows-pending/` when a session lacked GitHub's
`workflow` scope and could not write it directly. Activate with:

```sh
mkdir -p .github/workflows
git mv -f .github/workflows-pending/ci.yml .github/workflows/ci.yml
rm -rf .github/workflows-pending
git add -A && git commit -m 'Update CI workflow' && git push
```

---

## 6. Remaining milestones

Each lists **acceptance criteria** — treat them as the definition of done.

### M1.5 — Google Calendar read path

Pulled ahead of the views deliberately: real history makes the views worth building, and
building them against real data beats building them against fixtures.

Create `packages/gcal` (framework-free, no `packages/ui` dependency).

- OAuth via Google Identity Services, **new "Web application" client** in the existing GCP
  project (the current client is type *Android*; consent screen and `calendar` scope carry
  over). App stays in testing mode with the owner as test user, which avoids verification.
- Read via `events.list` with `singleEvents=true` (server-side recurrence expansion — do
  **not** reimplement RRULE for read) and `syncToken` for incremental pulls.
- Map events → `Entry`, fold into the op log.
- **Read-only. No writes in this milestone.**

**Timestamp mapping — read this before writing the mapper.** Google returns
`start.dateTime` as a bare RFC3339 offset string (`2026-01-05T09:00:00-05:00`) or, for
all-day events, `start.date` (`2026-01-05`). **Neither validates**: `Entry.start` must
satisfy `ZonedIsoSchema`, which parses with `offset: 'reject'` and therefore requires a
bracketed IANA zone. The mapper must attach one. Rules:

1. **Zone resolution order:** `event.start.timeZone` → the owning calendar's `timeZone`
   (from `calendarList.list`) → hard error. Never fall back to the device zone; that
   silently rewrites history when you travel.
2. **`calendarList.list` is therefore part of the M1.5 read path**, not deferred to M6 —
   the calendar `timeZone` is required to map an event at all.
3. **All-day events:** `PlainDate.toZonedDateTime({ timeZone: calendarTz, plainTime: '00:00' })`,
   with `end` = the next day's start. All-day is a `Binary` or `Interval` track, never a
   zero-length instant.
4. **Rejected timestamps** (invariant 7 rejects a wall-clock time in a DST-skipped hour):
   skip the event, and **report it in the dry-run** with its id and raw value. Never
   silently drop, never snap to a neighbouring instant.

**Back-catalogue import.** Events live in the owner's *primary* calendar mixed with real
appointments, across several marking eras:

| Era | Marker |
|---|---|
| Oldest | `[S] EVENTNAME` title prefix |
| Middle | `. EVENTNAME` title prefix (leading dot + space) |
| Recent | `[source:scribcal]` line in the description |
| Any | Zero-duration (`DTSTART == DTEND`) — strong corroborator; normal events are essentially never zero-length |
| Any | Colour-key clustering by title — weak corroborator |

Do **not** encode a date cutoff; report what is actually found per era and let the user
decide. Title prefixes are stripped on import into `Track.legacyTitles` so re-import is
idempotent.

**Acceptance criteria**
- [ ] Dry-run classification report runs *before* any import: per-era counts, date ranges,
      clustered by distinct title.
- [ ] Review UI maps title clusters onto `Track`s; prefixes strip into `legacyTitles`.
- [ ] Re-running the import produces **no duplicates**.
- [ ] Recorded (scrubbed) API-response fixtures; `packages/gcal` tested offline against them:
      `syncToken` continuation, `410 Gone` → full resync, recurring expansion, all-day vs
      timed events.
- [ ] A zero-duration event imports as `Binary`, not a zero-length `Interval`.
- [ ] **Viewer-only mode works**: app is useful over the calendar with zero local entries.

### M2 — Radial view, for real

Promote the spike into `packages/views` behind a shared contract.

- Define the `TimeScale` interface: `units`, `project(t) → Point`, `markFor(interval, lane) → MarkGeometry`,
  `virtualDay(date) → VirtualDay`, `anomalyGeometry(vd) → MarkGeometry | null`.
- Implement `RadialScale` against it, fed by the real engine and imported history.
- First view with time-of-day detail, so **`VirtualDay`, locked zoom, `snapViewport`, and
  both `DstPolicy` values land here** — including spur/void rendering.
- `snapViewport(range, days)`: snaps to day boundaries when a non-`Normal` day is in range so
  a spur is never half-clipped. Zoom *control* stays live throughout — "locked" describes the
  layout mode, never a disabled input.
- `DstPolicy` is a user setting: `AtTransition` (default) or `AtDayEnd`. It changes only
  `anomaly.slotIndex`, so it costs one branch per renderer.

**Acceptance criteria**
- [ ] Dev fixture permanently contains a spring-forward and a fall-back week.
- [ ] Property test: `slotSize` byte-identical for any two dates in any zone at the same zoom.
      Generate across awkward zones — Lord Howe (30-min shift), Tehran, Chatham, Santiago.
- [ ] A ring's arcs sum to exactly 360° on `Long`, `Short` and `Normal` days alike.
- [ ] Every entry lands in exactly one slot-or-spur; both 1:30ams of a fall-back night
      resolve to *different* marks.
- [ ] `snapViewport` is idempotent, widens by at most one day, no-ops when all days are `Normal`.
- [ ] Both `DstPolicy` values produce the **same set** of marks — only positions differ.
      Placement never drops or duplicates an entry.
- [ ] Geometry snapshot tests on SVG path strings at several zoom levels.
- [ ] Spike findings addressed: `innerRadius` ratio, `spurHeight` scaling with ring pitch.
- [ ] **Overlap rule implemented.** For N mutually overlapping entries on one day, every
      entry yields a visible mark — N distinct non-empty paths, none fully covered by
      another. Lane assignment (the `lane` parameter on `markFor`) is deterministic and
      stable across re-renders, so the layout does not shuffle as data arrives.
- [ ] **12h mode has an explicit AM/PM affordance** beyond the sub-band gap — labels,
      differing opacity, or a day-separator spoke. Record the choice in section 5 and strike
      the open question.

### M3 — Vertical year/month scroll

`LinearVerticalScale` + tick-to-complete, wired to the op log. The radial view is the
*interesting* one; this is the **useful** one — it is the Giertz grid and what makes daily
logging a habit. **Do not let it slip far behind M2.** DST is invisible at day granularity,
so this is mostly reuse of the M2 contract.

**On virtualization:** build this *without* `@tanstack/solid-virtual` first. A year as a
single SVG of cheap `<rect>`s may well be fast enough — the cost is DOM node count, which one
SVG tree handles far better than thousands of separate components. Profile, then add the
dependency only if scrolling actually stutters. Do not pre-empt a performance problem you
have not measured.

**Acceptance criteria**
- [ ] Scrolling a decade stays smooth. Virtualize only if profiling says so, and say what the
      profile showed.
- [ ] Tick-to-complete writes an `Entry` through the op log and survives reload.
- [ ] Cell colour derives from `GoalResult.status` — no parallel status logic.
- [ ] Today's incomplete goal reads `Pending`, never `Missed`.

### M4 — Horizontal day columns

Third implementation of the same `TimeScale` interface, plus the shared zoom control.

**Acceptance criteria**
- [ ] Should be the **cheapest** of the three. If it is not, the abstraction is wrong — say so
      rather than working around it.
- [ ] Hour height identical across columns; a `Long` day's column is one slot taller, a
      `Short` day's one shorter with a hatched void.
- [ ] Zoom preserved across view switches.

### M5 — Track/tag manager + goal & routine editor

A UI over both algebras. The hard design problem is exposing composition **without exposing a
syntax tree**.

- Schedule presets: daily / weekdays / N-per-week / custom RRULE, plus an "advanced" escape hatch.
- Selector presets: this track / anything tagged X / everything except Y, same escape hatch.

**Acceptance criteria**
- [ ] Selector editor shows a **live preview of which tracks currently match**, including
      unit-excluded ones. Without this the abstraction is unusable.
- [ ] A `Sum` goal cannot be saved without a unit (schema already enforces; surface it).
- [ ] Untagged tracks are surfaced in the manager — tag discipline decays, and selectors are
      only as good as the tags.
- [ ] **Schedule editor previews the next N windows from `occurrences()`** for the schedule
      being built — the same evaluator the engine uses, never preview-only logic.
- [ ] **Round-trip property:** any `Schedule` that parses under `ScheduleSchema` loads into
      the editor and saves deep-equal when untouched, including variants with no preset form.
      A schedule the presets cannot represent (a `Difference` of two `Intersect`s, a
      `Derived`) opens directly in the advanced editor — never silently coerced or dropped.
- [ ] **Routine editor** writes `{ when, goals[] }`, and the status it displays equals
      `evaluateRoutine()`'s weakest-link rollup — no parallel rollup logic in the UI.
- [ ] `Goal.grace` and `Goal.rollup` are implemented and exposed, or explicitly removed from
      the model. A goal with `grace: n` reads `Met` when `actual` is within `n` of `target`;
      a `rollup` schedule produces one result per rollup window folded from member windows.
      Same for `Routine.ordered`. Ending M5 with them still inert is not acceptable.

### M6 — Google Calendar write path

Gated behind M1.5 running cleanly for a while. Writing to real calendar data is the one
genuinely destructive thing this app does.

- Opt-in **per calendar**; read-only remains the default.
- Every write carries `extendedProperties.private`: `{ trackId, entryId, valueType, value, opId }`.
  Invisible in the Google UI, survives user edits, and gives a real machine-readable
  round-trip that title-matching never can.
- Per-track `calendarId` routing; managed-calendar creation.
- **API constraint:** `Calendars`/`CalendarList` resources have **no `extendedProperties`** —
  only `Events` do. Identify managed calendars with a marker line in the `description`
  (`x-timeslife:v1:<uuid>`), discovered via a `calendarList.list` scan. Do not use a naming
  convention on the display name.

**Acceptance criteria**
- [ ] Round-trip test: write an entry with `extendedProperties`, read it back, identical `Entry`.
- [ ] Local delete does **not** delete remotely without an explicit confirmed action; remote
      delete removes locally rather than being resurrected on next sync.
- [ ] Conflict test: a remote edit with a newer `updated` beats a local edit.

### M7 — Portability

ICS import/export and full JSON op-log export/import. Non-negotiable for a self-hostable
tool. Read `ConfigBackupManager.kt` in scribcal first — it already solves the config half.

**Acceptance criteria**
- [ ] Round trip: JSON export → valibot parse → import → **identical folded state**
      (already tested for ops; extend to the whole document).
- [ ] Export contains everything needed to reconstruct state on a clean install.
- [ ] **ICS round trip preserves instants exactly** for timed, all-day and zero-duration
      entries, including one spanning each DST transition. Timed events carry `TZID` plus a
      `VTIMEZONE` — never floating time.
- [ ] **A third-party `.ics` imports without crashing.** Export one from Google Calendar and
      keep it as a fixture. Unmappable events are reported, never silently dropped.
- [ ] **ICS import is idempotent, keyed on `UID`** — the same dedupe contract as the M1.5
      Google Calendar import.

### M8 — Reminders (best-effort)

Web Push where supported, plus manifest `shortcuts` for per-track quick capture. Explicitly
**not** a headline feature — scribcal owns the notification-driven workflow. Schedules come
straight from `occurrences()`.

### Later — sync

A ~200-line relay (Cloudflare Worker + Durable Object, or self-hosted Node) storing
end-to-end-encrypted op batches keyed by a sync secret. No accounts, no readable database.
The op log means **no data-model changes are required**.

---

## 7. Working on it

```sh
pnpm install
pnpm dev         # Vite dev server (currently the radial spike)
pnpm test        # vitest, all packages
pnpm typecheck   # tsc -b
pnpm lint        # eslint, including the solid-js import boundary
pnpm build       # all packages + web
pnpm eval packages/core/fixture.example.json --from 2026-01-05 --to 2026-01-12 --now 2026-02-01T00:00:00Z
```

`pnpm eval` prints a `GoalResult` table per goal straight from a JSON fixture — the fastest
way to check an engine change without a UI in the way. `packages/core/fixture.example.json`
is committed and holds the same data the test suite uses, so the command above runs as
written. Fixture shape: `{ tz?, tags[], tracks[], entries[], goals[], routines[] }`.

### Conventions

- Comments explain **why**, never what. Density is low; a comment earns its place by
  recording a decision or a trap.
- Every closed string set **in the persisted model** is an `as const` object in
  `packages/core/src/model/enums.ts` with a valibot schema derived from it. Three known
  exceptions, all worth cleaning up: the selector `match` field is an inline `'any' | 'all'`
  union with a hand-written picklist; `DayShape`/`DstPolicy` live in `packages/views` with no
  schema (view-layer today, but `DstPolicy` becomes a persisted user setting in M2);
  `GoalStatus` has no derived schema.
- Evaluator switches end in a `never`-typed default so a new variant fails to compile.
- Geometry returns **plain data** — path strings, numbers. Never JSX, never elements.
- Solid components run **once**: `const { zoom } = props` captures a dead value; use
  `props.zoom` or `splitProps`. This is the most common Solid mistake and it fails silently.

### Known open questions

- The `Schedule` evaluator has example-based tests only; the other algebras have property
  tests. Closing that gap is cheap and would likely find something.
- `Goal.grace`, `Goal.rollup`, `Routine.ordered` are declared but inert (see section 3).
  M5 must implement or remove them.
- Schedule/selector editor UX (M5) is the biggest unknown in the project.
- Browser-only OAuth gets **no refresh token**, so sync only happens while the app is open.
  If that becomes annoying the fix is a ~150-line token broker, not a redesign.
