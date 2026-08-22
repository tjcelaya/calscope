/**
 * Google Calendar's event palette: colorId (the "1"–"11" carried on events) -> hex.
 *
 * Values are the API's classic event palette, mirrored from scribcal-android's
 * GoogleCalendarColors.kt -- the SAME index scribcal used when writing the back
 * catalogue, which is what makes imported tracks come out in the colors the user
 * actually picked. Hardcoded rather than fetched from the `colors` endpoint on purpose:
 * the palette is a historical constant of the written data, not live state, and a pull
 * must work offline against fixtures.
 */
export const GOOGLE_EVENT_COLORS: Readonly<Record<string, { name: string; hex: string }>> = {
  '1': { name: 'Lavender', hex: '#A4BDFC' },
  '2': { name: 'Sage', hex: '#7AE7BF' },
  '3': { name: 'Grape', hex: '#DBADFF' },
  '4': { name: 'Flamingo', hex: '#FF887C' },
  '5': { name: 'Banana', hex: '#FBD75B' },
  '6': { name: 'Tangerine', hex: '#FFB878' },
  '7': { name: 'Peacock', hex: '#46D6DB' },
  '8': { name: 'Graphite', hex: '#E1E1E1' },
  '9': { name: 'Blueberry', hex: '#5484ED' },
  '10': { name: 'Basil', hex: '#51B749' },
  '11': { name: 'Tomato', hex: '#DC2127' },
}

export function hexForColorId(colorId: string | undefined): string | undefined {
  if (colorId === undefined) return undefined
  return GOOGLE_EVENT_COLORS[colorId]?.hex
}

/**
 * The colorId most events in a cluster carry, from classify()'s per-cluster tally.
 * Ties break toward the lower id so the result is deterministic, not object-key order.
 */
export function dominantColorId(colorIds: Readonly<Record<string, number>>): string | undefined {
  let best: string | undefined
  let bestCount = 0
  for (const [id, count] of Object.entries(colorIds)) {
    if (count > bestCount || (count === bestCount && best !== undefined && Number(id) < Number(best))) {
      best = id
      bestCount = count
    }
  }
  return best
}
