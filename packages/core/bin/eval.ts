#!/usr/bin/env node
/**
 * Exercise the engine from a terminal, with no UI in the way:
 *
 *   pnpm eval path/to/fixture.json [--from 2026-01-05] [--to 2026-01-12] [--now <iso>]
 *
 * The fixture is `{ tags, tracks, entries, goals, routines }`. Output is one table per
 * goal, so a schedule or aggregation change can be eyeballed before any view exists.
 */
import { readFileSync } from 'node:fs'
import { Temporal } from 'temporal-polyfill'
import {
  type Goal,
  type Routine,
  evaluateGoal,
  evaluateRoutine,
} from '../src/index.js'

type Fixture = {
  tz?: string
  tags?: Parameters<typeof evaluateGoal>[4]
  tracks: Parameters<typeof evaluateGoal>[2]
  entries: Parameters<typeof evaluateGoal>[1]
  goals?: Goal[]
  routines?: Routine[]
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const path = process.argv[2]
if (!path || path.startsWith('--')) {
  console.error('usage: whenn-eval <fixture.json> [--from DATE] [--to DATE] [--now ISO]')
  console.error('example: pnpm eval packages/core/fixture.example.json --from 2026-01-05 --to 2026-01-12')
  process.exit(1)
}

let fixture: Fixture
try {
  fixture = JSON.parse(readFileSync(path, 'utf8')) as Fixture
} catch (err) {
  // A missing or malformed fixture is a usage mistake, not a crash. Print the shape
  // rather than an ENOENT stack trace.
  console.error(`cannot read fixture '${path}': ${(err as Error).message}`)
  console.error('\nexpected JSON shape:')
  console.error('  { tz?, tags[], tracks[], entries[], goals[], routines[] }')
  console.error('\nexample: pnpm eval packages/core/fixture.example.json --from 2026-01-05 --to 2026-01-12')
  process.exit(1)
}
const tz = fixture.tz ?? Temporal.Now.timeZoneId()

const from = Temporal.PlainDate.from(arg('from') ?? Temporal.Now.plainDateISO(tz).toString())
const to = Temporal.PlainDate.from(arg('to') ?? from.add({ days: 7 }).toString())
const nowArg = arg('now')

const range = {
  start: from.toZonedDateTime({ timeZone: tz, plainTime: '00:00' }).toInstant(),
  end: to.toZonedDateTime({ timeZone: tz, plainTime: '00:00' }).toInstant(),
}
const now = nowArg ? Temporal.Instant.from(nowArg) : Temporal.Now.instant()

const short = (iso: string) =>
  Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainDateTime().toString({ smallestUnit: 'minute' })

console.log(`range ${from} .. ${to}  tz=${tz}  now=${now.toZonedDateTimeISO(tz).toPlainDateTime().toString({ smallestUnit: 'minute' })}\n`)

for (const goal of fixture.goals ?? []) {
  const results = evaluateGoal(goal, fixture.entries, fixture.tracks, range, fixture.tags ?? [], { now })

  console.log(`${goal.name}  [${goal.aggregate} ${goal.compare} ${goal.target}${goal.unit ? ' ' + goal.unit : ''}]`)
  if (results.length === 0) console.log('  (no windows in range)')

  console.table(
    results.map((r) => ({
      window: `${short(r.window.start)} → ${short(r.window.end)}`,
      actual: Number(r.actual.toFixed(3)),
      target: r.target,
      status: r.status,
      entries: r.contributingEntryIds.length,
    })),
  )

  const excluded = results[0]?.excludedTrackIds ?? []
  if (excluded.length > 0) {
    console.log(`  excluded (incompatible units): ${excluded.join(', ')}`)
  }
  console.log()
}

for (const routine of fixture.routines ?? []) {
  const results = evaluateRoutine(
    routine,
    fixture.goals ?? [],
    fixture.entries,
    fixture.tracks,
    range,
    fixture.tags ?? [],
    { now },
  )
  console.log(`routine: ${routine.name}`)
  console.table(
    results.map((r) => ({
      window: `${short(r.window.start)} → ${short(r.window.end)}`,
      status: r.status,
      members: r.members.length,
    })),
  )
  console.log()
}
