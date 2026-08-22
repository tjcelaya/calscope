import { describe, expect, it } from 'vitest'
import { GOOGLE_EVENT_COLORS, dominantColorId, hexForColorId } from '../src/colors.js'

describe('Google event color index', () => {
  it('covers exactly the 11 event colorIds, matching scribcal’s index', () => {
    expect(Object.keys(GOOGLE_EVENT_COLORS).sort((a, b) => Number(a) - Number(b))).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11',
    ])
    // Spot-pin the ends against GoogleCalendarColors.kt so a palette edit is deliberate.
    expect(GOOGLE_EVENT_COLORS['1']).toEqual({ name: 'Lavender', hex: '#A4BDFC' })
    expect(GOOGLE_EVENT_COLORS['11']).toEqual({ name: 'Tomato', hex: '#DC2127' })
  })

  it('hexForColorId maps known ids and returns undefined for unknown or missing', () => {
    expect(hexForColorId('9')).toBe('#5484ED')
    expect(hexForColorId('12')).toBeUndefined()
    expect(hexForColorId(undefined)).toBeUndefined()
  })
})

describe('dominantColorId', () => {
  it('picks the most frequent colorId', () => {
    expect(dominantColorId({ '3': 2, '9': 7, '11': 1 })).toBe('9')
  })

  it('breaks ties toward the lower numeric id, regardless of key order', () => {
    expect(dominantColorId({ '11': 3, '2': 3 })).toBe('2')
    expect(dominantColorId({ '2': 3, '11': 3 })).toBe('2')
  })

  it('returns undefined for a cluster with no colored events', () => {
    expect(dominantColorId({})).toBeUndefined()
  })
})
