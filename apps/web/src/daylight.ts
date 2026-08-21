import * as SunCalc from 'suncalc'
import { Temporal } from 'temporal-polyfill'
import { slotPosition } from '@calscope/views'

/**
 * Day/night shading for ring backgrounds.
 *
 * Sunrise and sunset are pure astronomy -- computed locally from coordinates and date via
 * the NOAA solar equations (suncalc). No network service: an offline-first app must not
 * have its background depend on someone's free endpoint staying up. Coordinates at spike
 * fidelity are hardcoded for the fixture's zone; the real app derives approximate coords
 * from the IANA zone itself (tzdb's zone1970.tab ships a representative lat/lng per zone),
 * with browser Geolocation as an optional refinement. See docs/PLAN.md.
 */
export const DaylightClass = {
  Night: 'night',
  Twilight: 'twilight',
  Day: 'day',
} as const
export type DaylightClass = (typeof DaylightClass)[keyof typeof DaylightClass]

export type DaylightSeg = { from: number; to: number; cls: DaylightClass }

const FLAT_NIGHT: DaylightSeg[] = [{ from: 0, to: 24, cls: DaylightClass.Night }]

export function daylightSegments(
  date: Temporal.PlainDate,
  tz: string,
  lat: number,
  lng: number,
): DaylightSeg[] {
  // Local noon anchors the calculation on the right civil day regardless of UTC offset.
  const noon = date.toZonedDateTime({ timeZone: tz, plainTime: '12:00' })
  const times = SunCalc.getTimes(new Date(noon.epochMilliseconds), lat, lng)

  const toSlot = (d: Date): number =>
    slotPosition(Temporal.Instant.fromEpochMilliseconds(d.getTime()).toZonedDateTimeISO(tz))

  const raw = [times.dawn, times.sunrise, times.sunset, times.dusk]
  // Polar day/night (or any degenerate ordering) falls back to a flat band rather than
  // rendering garbage. Real handling is an M2 concern.
  if (raw.some((d) => d == null || Number.isNaN(d.getTime()))) return FLAT_NIGHT

  const [dawn, sunrise, sunset, dusk] = (raw as Date[]).map(toSlot) as [
    number,
    number,
    number,
    number,
  ]
  if (!(dawn < sunrise && sunrise < sunset && sunset < dusk)) return FLAT_NIGHT

  return [
    { from: 0, to: dawn, cls: DaylightClass.Night },
    { from: dawn, to: sunrise, cls: DaylightClass.Twilight },
    { from: sunrise, to: sunset, cls: DaylightClass.Day },
    { from: sunset, to: dusk, cls: DaylightClass.Twilight },
    { from: dusk, to: 24, cls: DaylightClass.Night },
  ].filter((s) => s.to - s.from > 0.001)
}
