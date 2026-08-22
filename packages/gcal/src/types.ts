import * as v from 'valibot'

/**
 * Only the slice of the Calendar API surface we actually consume. Unknown keys are
 * stripped by valibot, so Google adding fields never breaks a pull; a *missing* field we
 * depend on fails loudly at the parse boundary instead of deep inside the mapper.
 *
 * Same `as const` + derived-union convention as core's enums (see core enums.ts for why
 * TS `enum` is banned).
 */

function fromEnum<T extends Record<string, string>>(e: T) {
  return v.picklist(Object.values(e) as [T[keyof T], ...T[keyof T][]])
}

export const GcalEventStatus = {
  Confirmed: 'confirmed',
  Tentative: 'tentative',
  Cancelled: 'cancelled',
} as const
export type GcalEventStatus = (typeof GcalEventStatus)[keyof typeof GcalEventStatus]
export const GcalEventStatusSchema = fromEnum(GcalEventStatus)

/**
 * calendarList.list entry. `timeZone` is load-bearing: it is the fallback zone for every
 * event that does not carry its own, which is why calendarList is part of the M1.5 read
 * path at all.
 */
export const GcalCalendarListEntrySchema = v.object({
  id: v.string(),
  summary: v.optional(v.string()),
  timeZone: v.optional(v.string()),
  primary: v.optional(v.boolean()),
})
export type GcalCalendarListEntry = v.InferOutput<typeof GcalCalendarListEntrySchema>

export const GcalCalendarListResponseSchema = v.object({
  items: v.optional(v.array(GcalCalendarListEntrySchema)),
  nextPageToken: v.optional(v.string()),
})
export type GcalCalendarListResponse = v.InferOutput<typeof GcalCalendarListResponseSchema>

/**
 * `{date}` for all-day, `{dateTime, timeZone?}` for timed. `dateTime` is a bare RFC3339
 * offset string -- it does NOT satisfy core's ZonedIsoSchema until the mapper attaches a
 * bracketed IANA zone.
 */
export const GcalEventTimeSchema = v.union([
  v.object({ date: v.string() }),
  v.object({ dateTime: v.string(), timeZone: v.optional(v.string()) }),
])
export type GcalEventTime = v.InferOutput<typeof GcalEventTimeSchema>

export const GcalEventSchema = v.object({
  id: v.string(),
  status: v.optional(GcalEventStatusSchema),
  summary: v.optional(v.string()),
  description: v.optional(v.string()),
  // Cancelled events delivered through a syncToken pull are id+status stubs, so start/end
  // must be optional here; the mapper enforces presence for live events.
  start: v.optional(GcalEventTimeSchema),
  end: v.optional(GcalEventTimeSchema),
  updated: v.optional(v.string()),
  colorId: v.optional(v.string()),
  /** Expanded instances of one recurrence share this while keeping distinct `id`s. */
  recurringEventId: v.optional(v.string()),
  extendedProperties: v.optional(
    v.object({
      private: v.optional(v.record(v.string(), v.string())),
      shared: v.optional(v.record(v.string(), v.string())),
    }),
  ),
})
export type GcalEvent = v.InferOutput<typeof GcalEventSchema>

export const GcalEventsPageSchema = v.object({
  items: v.optional(v.array(GcalEventSchema)),
  nextPageToken: v.optional(v.string()),
  /** Only present on the final page of a listing. */
  nextSyncToken: v.optional(v.string()),
})
export type GcalEventsPage = v.InferOutput<typeof GcalEventsPageSchema>
