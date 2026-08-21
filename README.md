# whenn

A local-first tool for **goals, events, and routines** on one composable model, rendered
through three calendar views: a **radial** view of concentric day-rings, a **vertical**
year/month scroll, and **horizontal** day columns.

Most habit trackers can express "did I do this today" and nothing else. whenn is built
around the things that actually describe a life:

- Did this occur — or deliberately **not** occur — inside a window?
- Was the sum of this *type* of thing above or below a target? *(where "caffeine" means
  espresso and tea and whatever you start logging next March)*
- …where the window itself may be on its own complex schedule.

It ships as an installable PWA served from static files — self-hostable by anyone, no
accounts, no database to run. Google Calendar is a peer store: whenn reads and writes it,
but is no more canonical than it is.

## Status

Early. The headless engine is complete and tested; the only UI is a radial-view spike running
on fake data.

```sh
pnpm install
pnpm dev         # Vite dev server (currently the radial spike)
pnpm test        # 103 tests across all packages
pnpm typecheck
pnpm lint
pnpm eval packages/core/fixture.example.json --from 2026-01-05 --to 2026-01-12
```

`pnpm eval` prints a goal-evaluation table straight from a JSON fixture — the fastest way to
check an engine change with no UI in the way.

## Layout

```
packages/core/   zero-DOM engine: model, schedule algebra, selectors, goals, op log
packages/views/  pure geometry: no framework, path strings out
apps/web/        Vite + Solid + PWA
```

## Docs

**[`docs/PLAN.md`](docs/PLAN.md)** — the design, the invariants that must not be broken, and
the remaining milestones with acceptance criteria. Read it before changing anything in
`packages/core`; several of its invariants were arrived at by getting them wrong first.
