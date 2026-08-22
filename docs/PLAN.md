# calscope

A local-first tool for **goals, events, and routines** on one composable model, rendered
through three quite different calendar views.

It is an installable PWA served as static files — self-hostable by anyone, no accounts, no
database to run. Google Calendar is a **peer store**: calscope reads and writes it, but is
no more canonical than it is.

---

## 1. What it is for

Most habit trackers can express "did I do this today" and nothing else. calscope exists to
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
history that calscope must visualise. Its Room schema is calscope's model in embryo
(`EventType`→`Track`, `Cadence`→`ValueType`, and an `Event` with the identical
instant/ongoing/completed states), so nothing needs redesigning to accept that history.

**Division of labour:** scribcal stays a capture client for the one thing a PWA genuinely
cannot do — hold a persistent silent notification you can stop a running timer from.
calscope owns the model, goals, and views. Google Calendar is the bus between them, and
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
| Daylight | `suncalc` (spike; NOAA-style calc may move into `packages/views` in M2) | Sunrise/sunset is pure astronomy, computed locally. **No network service**: an offline-first app must not have its background depend on a free endpoint staying up. Coordinates come from the IANA zone itself — tzdb's `zone1970.tab` ships a representative lat/lng per zone — with browser Geolocation as an optional refinement |
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
  fillsGapBefore?: boolean   // sleep pattern: entries claim back to the previous event's end
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

**Gap fill (`fillsGapBefore`)** exists for sleep-style capture: one instant logged at
wake-up should read as the whole night. An entry on such a track claims the span from the
previous event's end — the latest completed-interval end or instant moment across ALL
tracks, ongoing entries excluded — up to its own moment. This is a **derivation**
(`expandGapFill` in core, applied in the app's `buildModel`), never a rewrite of the
stored entry: the captured instant stays canonical in the op log and in Google Calendar,
and the expansion recomputes when neighbouring events are imported, edited, or deleted.
Goal evaluation currently sees the RAW entries; feeding it expanded ones is a decision
for M5's editor (a sleep-duration goal wants it, an "did I log sleep" Exists goal must
not double-count).

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

**Done: M0, M0.5 (both field-review rounds), M1, and the offline half of M1.5** —
`packages/gcal` complete against recorded fixtures, IndexedDB op-log persistence, and the
app wired to the real engine with capture and a Google Calendar connect/dry-run/import UI.
278 tests; lint, typecheck and build clean. Live at
**https://tjcelaya.github.io/calscope/** — every push to `main` with green tests deploys.

**Next: the user-side half of M1.5** — the Google Cloud OAuth client (documented in the CI
and hosting section) and the dry-run classification report against the real account, which
is expected to force iteration on the era rules. A fresh agent should read section 4
(invariants) and the field findings below before touching `packages/views` or the spike —
several invariants were arrived at by getting them wrong first, and the findings record
which "obvious" implementations are known-wrong.

| Package | State |
|---|---|
| `packages/core` | Complete for M1: enums, valibot schemas, interval algebra, calendar windows, schedule evaluator, selector resolver, unit conversion, goal + routine evaluation, HLC, op log, `pnpm eval` CLI |
| `packages/views` | `virtualDay()` + radial geometry, hardened by two field-review rounds, plus the pieces extracted from the spike: `config.ts` (zoom→ring geometry), `inset.ts` (containment depth), `order.ts` (ring-order swap), `viewport.ts` (`snapViewport`). No `TimeScale` interface yet — that lands in M2 |
| `packages/gcal` | Complete offline: injectable GIS auth (readonly scope), fixture-tested client (`singleEvents`, `showDeleted`, pagination, `syncToken`, `410` → `FullResyncRequired`), normative event→`Entry` mapper (zone resolution, all-day, skipped-hour rejection reported not snapped, cross-zone offset fallback), era classifier, dry-run report. Untested against the real API — that is the user-side half |
| `apps/web` | Real engine + persistence: IndexedDB op store (`src/persist/`, HLC continuity across restarts, cached fold), capture panel (create track, log instant, start/stop ongoing), demo/my-data source toggle, gcal connect UI (`src/gcal-ui/`: calendar list, dry-run report, per-cluster import, incremental pull with resync-replace semantics), three views on either data source |
| `packages/ui` | Not created yet (spike components still live in `apps/web` directly) |

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
- **Overlapping marks need more than z-order.** A long event painted after a short one hides
  it entirely. Superseded by the mark-encoding spec below: kind is a *shape* channel, so an
  instant can never be occluded by an interval in the first place. Lane rules remain for
  interval-vs-interval overlap. **Partially open — see M2.**

### Field findings (deployed spike, viewed on a phone)

Looking at the deployed spike on real hardware caught what the unit tests could not —
path-string assertions all passed while the pixels were wrong or invisible:

- **The spring-forward void was in the wrong hour.** The transition instant was read in the
  *post*-transition offset, landing the void one shift-width late (3am instead of the skipped
  2–3am; Lord Howe 2:30 instead of 2:00). Fixed in `virtualDay`, regression-tested against
  both NY and Lord Howe in both directions.
- **The void was invisible anyway.** Rendered as a dashed stroke outline on a dark band, it
  vanished on a phone — making a spring-forward week indistinguishable from an ordinary one,
  which defeated the scenario comparison entirely. Now a hatched fill, per the original spec.
- **`AtDayEnd` is ill-defined on a ring.** "Append after 24:00" lands at 0° — the same angle
  as day *start* — because the circle closes; it rendered adjacent to (and indistinguishable
  from) the at-transition wedge. The radial renderer now abuts midnight from the
  counter-clockwise side (the segment *ends* at the top). This falsifies the earlier claim
  that policy "changes only `slotIndex`": placement is necessarily interpreted per renderer.
- **The fixture barely exercised concurrency, and hid the evidence.** It held exactly one
  overlap (an instant inside a long interval) and the interval fully occluded it; there was
  no ongoing entry at all. The fixture now carries a concurrency ladder — instant inside a
  meeting inside an ongoing workday, plus a partial overlap across a boundary — and a
  simulated `now`.
- **Scenario discriminability rests entirely on the anomaly encoding.** The fixture is
  deliberately seeded by day *index*, not date, so scenarios differ only in their DST marks —
  a controlled comparison, but it means those marks must carry real visual weight.

Second round, after the encoding prototype shipped:

- **12h mode collapsed every day but the first into the PM sub-band.** Sub-band selection
  compared the raw *grid* slot (hours from day 0's midnight) against 12, so day 3's 9am
  (slot 81) landed in PM. Spotted from a phone screenshot as "read appears to overlap other
  events". Fixed: `subBandForSlot` reduces to within-day time first; regression tests cover
  multi-day placement.
- **Interval-inside-interval was ambiguous under overpainting** — a meeting drawn over work
  reads as "meeting replaces work". Answered with a fifth channel: **radial inset encodes
  containment**. Depth = number of strictly-longer intervals fully containing the mark; each
  level insets the band (18% per level, capped), so the container stays visible on both
  radial sides of the contained. Deterministic, order-independent. *Partial* overlap (the
  16:30 meeting straddling work's end) still overpaints — open.
- **Ring backgrounds now carry the day's actual light** (night / civil twilight / daylight),
  which also turns out to be the best AM/PM affordance found so far: in 12h mode the two
  sub-bands show different light at the same angle, so 9am and 9pm content stop looking
  like neighbours.

Third round, cross-device (Framework 13 / Moto Razr / iPad Pro, all Brave):

- **Relative inset fails at phone scale.** Nesting was legible on desktop and invisible on
  the Razr: 18% of a constant band thickness is a couple of physical pixels on a phone.
  Fix within the locked-zoom rules: **ring thickness is now a function of zoom** (ring
  count fills a fixed target radius, thickness clamped 14–44), which is exactly the
  `slotSize(zoom)` shape invariant 1 permits — geometry depends on zoom, never on any
  day's length. Insets also gained an absolute floor, `spurHeight` scales with thickness,
  and mark outlines use `vector-effect="non-scaling-stroke"` so boundaries stay ~1px crisp
  at any viewport size.
- **iPad Brave re-tinted the whole palette** (cream backgrounds, navy sleep) — almost
  certainly a browser night-mode/auto-dark filter, not our CSS. Defense shipped:
  `<meta name="color-scheme" content="dark">` alongside the existing CSS `color-scheme`,
  which well-behaved auto-dark heuristics respect. If it persists, check Brave iOS
  Appearance → Night Mode. **Unconfirmed on-device.**
- **Ring order is now a control**: newest day at the outer edge (default) or at the
  center. Implemented as a pure permutation of the day→ring assignment; nothing else in
  the pipeline changes. Promote to a persisted user setting in M2.
- **All three views now render side by side in the spike** from one shared day-model
  (`apps/web/src/spike-model.ts` → `RadialView` / `ColumnsView` / `GridView`), so
  cross-view consistency is checkable by eye: the same instant ticks, nested meetings,
  ongoing-to-`now`, DST anomaly and daylight appear in each projection. This de-risks
  M3/M4 and is the working prototype of the shared ViewModel contract. The grid's
  per-cell micro-timelines are a spike aid; real M3 cells collapse to goal-status marks.

### Mark encoding and facet emphasis (all views)

Concurrent truths need separate visual channels, or they occlude each other. A day can
simultaneously contain a completed interval, a shorter interval inside it, an instant inside
that, an *ongoing* interval still running, and a goal window that is pending until its
deadline passes. One channel (fill color, painter's order) cannot carry all of it.

| Channel | Encodes | Concretely |
|---|---|---|
| **Fill** (hue) | Track identity | The track's color, same in every view |
| **Shape** | Kind | Instant → radial tick crossing the band; interval → arc; ongoing → arc extended to `now` with a dashed leading edge; goal window → stroke-only outline band, never filled |
| **Stroke / pattern** | State | Ongoing → dashed edge; skipped time → hatch; pending window → dashed outline; missed → to be designed in M2 |
| **Opacity** | Emphasis | The facet selector dims non-focused marks (≈0.12), never removes them |

Two rules that fall out:

- **`now` is an input, never a clock read.** Geometry and evaluation both take `now` as a
  parameter (`evaluateGoal` already does); views reading the real clock would make geometry
  impure and tests nondeterministic. The facet selector and `now` join the small set of raw
  UI signals.
- **Facet emphasis is a first-class control**: *everything / happening now / instants /
  finished durations / pending windows*. It answers "what is happening, what happened, and
  what still has a window open before it fails" without a mode switch — dimming, never
  filtering, so context stays visible.

The spike prototypes the first three rows (ticks, ongoing-to-now, hatched void, emphasis
select); M2 hardens them into `packages/views` and adds the goal-window row, which needs the
engine.

### CI and hosting

**Live and working — nothing to set up.** The repo is public at `tjcelaya/calscope`,
default branch `main`. `.github/workflows/ci.yml` runs lint → typecheck → test → build on
every push and PR; pushes to `main` with green tests additionally deploy to GitHub Pages at
**https://tjcelaya.github.io/calscope/**. Deploy is gated behind the tests, so a red build
never publishes.

Deployment uses the Actions-based Pages flow (`upload-pages-artifact` + `deploy-pages`) —
no `gh-pages` branch, no Jekyll. The repo setting (Settings → Pages → Source: GitHub
Actions) is already configured.

**Base path.** A project Pages site is served from `https://<user>.github.io/<repo>/`, so CI
builds with `BASE_PATH=/${{ github.event.repository.name }}/` — derived from the repo name
at build time rather than hardcoded, so a future rename does not silently break the deploy.
`apps/web/vite.config.ts` feeds it to Vite's `base` *and* to the PWA manifest's `start_url`
and `scope` — a service worker cannot control pages outside its scope, so a `/` scope on a
`/calscope/` deployment would silently disable offline support. Local dev and `vite preview`
stay at `/`.

**This origin matters for M1.5:** `https://<user>.github.io` must be an authorized JavaScript
origin on the Google OAuth web client.

*(An earlier revision of this section targeted Cloudflare Pages, while the repo was still
private and GitHub Pages was unavailable on the Free plan. Reverted once the repo went
public. The project itself was renamed twice in the same span — `timeslife` → `whenn` →
`calscope` — this section, the package names, and the manifest all reflect the current one.)*

**Agent-session caveat, kept for future sessions:** a token without GitHub's `workflow`
OAuth scope cannot push any change under `.github/workflows/` (creating or modifying;
deleting is exempt). Nothing is pending right now — but if a future agent session needs to
change `ci.yml` and hits that rejection, the working convention is: write the new file to
`.github/workflows-pending/ci.yml` with a README beside it, and let the user move it into
place with `git mv` and push with their own credentials.

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
- [x] Dry-run classification report runs *before* any import: per-era counts, date ranges,
      clustered by distinct title.
- [x] Review UI maps title clusters onto `Track`s; prefixes strip into `legacyTitles`.
- [x] Re-running the import produces **no duplicates** (`Entry.id = 'gcal:' + eventId`).
- [x] Recorded (scrubbed) API-response fixtures; `packages/gcal` tested offline against them:
      `syncToken` continuation, `410 Gone` → full resync, recurring expansion, all-day vs
      timed events.
- [x] A zero-duration event imports as `Binary`, not a zero-length `Interval`.
- [ ] **Viewer-only mode works**: app is useful over the calendar with zero local entries.
      *(Built; unverified until the real-account run.)*
- [ ] The dry-run report has been run against the **real account** and the era rules
      iterated on what it actually finds. Requires the user-side OAuth client setup.

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
- `DstPolicy` is a user setting: `AtTransition` (default) or `AtDayEnd`. The *model* carries
  it as `anomaly.slotIndex`, but **placement is interpreted per renderer** — on a ring,
  "after 24:00" is the same angle as 00:00, so the radial view abuts midnight from the
  counter-clockwise side. (An earlier claim that policy costs "one branch via slotIndex
  alone" was falsified by the deployed spike.)

**Acceptance criteria — concurrency and mark encoding first.** The field test showed this is
where the view actually fails; DST polish is second; the locked-zoom infrastructure is
already proven and carries over.

*Concurrency & encoding*
- [ ] The encoding table above is implemented in `packages/views`: kind is a shape channel
      (tick / arc / ongoing-to-now / outline window), state a stroke/pattern channel,
      identity fill, emphasis opacity.
- [ ] **The concurrency ladder renders with every entry visible**: an instant inside an
      interval inside an ongoing interval yields three distinct marks, none fully covered.
      Also: partial overlap across a boundary, identical starts, three-plus deep, and an
      interval spanning midnight while another runs.
- [ ] **Ongoing property**: an ongoing entry's mark ends at `angle(now)`; advancing `now`
      moves only ongoing marks and the now-line, nothing else. `now` is a parameter, never
      a clock read inside views.
- [ ] Interval-vs-interval **containment** renders as radial inset (depth = count of
      strictly-longer containers; deterministic and order-independent), so nesting is
      unambiguous. *Partial* overlap gets an explicit rule — inset does not cover it and
      overpainting is not acceptable as the final answer.
- [ ] **Legibility is scale-tested, not assumed**: band thickness derives from zoom
      (target-radius fill, clamped), insets have an absolute floor, outlines are
      non-scaling — verified at a ~400px viewport, since that is where relative sizing
      quietly failed in the spike.
- [ ] **Ring order is a persisted user setting** (newest at edge vs center), implemented
      as a pure permutation of day→ring assignment. Property test: flipping the order
      permutes ring radii only — the set of mark angles, sweeps and sub-bands is
      unchanged.
- [ ] Sub-band placement uses **within-day** time on every day (regression: raw grid slots
      collapsed all days but the first into PM).
- [ ] **Daylight ring backgrounds**: night/twilight/day segments per day from a local solar
      calculation; coordinates derived from the IANA zone via a `zone1970.tab` table, with
      optional Geolocation refinement; polar day/night degrades to a flat band, never
      garbage. Segments respect 12h sub-bands. Evaluate whether this closes the AM/PM
      affordance question and record the verdict in section 5.
- [ ] Facet emphasis dims (≈0.12 opacity) and never removes: mark count is identical under
      every emphasis value.
- [ ] Goal-window marks (stroke-only outline; `Pending` dashed) render from `GoalResult`,
      visually distinct from any entry mark.

*DST anomalies*
- [ ] Anomaly sits at the correct wall-clock hour on both shapes: NY spring void at [2,3),
      fall spur at [1,2); Lord Howe at [2,2.5) and [1.5,2). (Regression — the spike shipped
      the void an hour late.)
- [ ] The void is a filled/hatched mark with nonzero area, never stroke-only.
- [ ] `AtDayEnd` on the radial abuts midnight from the counter-clockwise side — its geometry
      is never congruent with a day-start placement. (Regression-tested.)
- [ ] Both `DstPolicy` values produce the **same set** of marks — only positions differ.
      Placement never drops or duplicates an entry.
- [ ] Spike findings addressed: `innerRadius` ratio, `spurHeight` scaling with ring pitch.
- [ ] **12h mode has an explicit AM/PM affordance** beyond the sub-band gap — labels,
      differing opacity, or a day-separator spoke. Record the choice in section 5 and strike
      the open question.

*Locked zoom & infrastructure*
- [ ] Dev fixture permanently contains a spring-forward and a fall-back week, the concurrency
      ladder, and an ongoing entry with a simulated `now`.
- [ ] Property test: `slotSize` byte-identical for any two dates in any zone at the same zoom.
      Generate across awkward zones — Lord Howe (30-min shift), Tehran, Chatham, Santiago.
- [ ] A ring's arcs sum to exactly 360° on `Long`, `Short` and `Normal` days alike.
- [ ] Every entry lands in exactly one slot-or-spur; both 1:30ams of a fall-back night
      resolve to *different* marks.
- [ ] `snapViewport` is idempotent, widens by at most one day, no-ops when all days are `Normal`.
- [ ] Geometry snapshot tests on SVG path strings at several zoom levels.

### M3 — Vertical year/month scroll

`LinearVerticalScale` + tick-to-complete, wired to the op log. The radial view is the
*interesting* one; this is the **useful** one — it is the Giertz grid and what makes daily
logging a habit. **Do not let it slip far behind M2.** DST is invisible at day granularity,
so this is mostly reuse of the M2 contract. A working spike prototype exists at
`apps/web/src/GridView.tsx` (cells with micro-timelines; real cells collapse to
goal-status marks once the engine is wired).

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

Third implementation of the same `TimeScale` interface, plus the shared zoom control. A
working spike prototype exists at `apps/web/src/ColumnsView.tsx` — including the linear
analogs of the spur (stepped-out block) and void (in-column hatch), nested-interval
insets, and horizontal overflow scrolling.

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
  (`x-calscope:v1:<uuid>`), discovered via a `calendarList.list` scan. Do not use a naming
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
- Missed-state encoding (stroke channel) is undesigned; goal-window outline marks need the
  engine and land in M2.
- Deep interval overlap (4+): inset nesting is proven to 3-deep (instant innermost);
  beyond that, and for *partial* overlaps, the encoding is unresolved.
- Polar day/night: the daylight background currently degrades to a flat band above the
  arctic circles; a real treatment is undesigned.
- Daylight coordinates are hardcoded to New York; any other home zone gets flat-night
  backgrounds. Fix is a small IANA-zone → representative-coordinates table (tzdb
  `zone1970.tab` carries exactly this), plus an optional manual override.
- The same Google event id appearing in two selected calendars maps to one `Entry`, so
  which track wins depends on pull order. Harmless for the primary-calendar workflow;
  needs a rule (e.g. calendar-scoped entry ids) before multi-calendar import is real.
- A captured instant's tick coincides with the `now` line at the moment of capture, so
  the mark is invisible until time moves on. Cosmetic; needs a capture-flash affordance.
- The manifest icon is a single SVG; iOS home-screen installs want a PNG
  `apple-touch-icon`, deferred until there is real branding to rasterize.
- Browser-only OAuth gets **no refresh token**, so sync only happens while the app is open.
  If that becomes annoying the fix is a ~150-line token broker, not a redesign.
