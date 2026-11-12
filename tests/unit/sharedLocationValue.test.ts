import { describe, expect, it } from 'vitest'
import { locationValuesDisagree, sharedLocationValue } from '../../src/shared/sharedLocationValue'

/**
 * Simple mode means one booking link / phone for all of a provider's
 * locations. They are stored per location, so this is the one rule for which
 * stored value stands for all -- used by the provider page and the widget alike.
 */

const at = (locationId: string, value: string | null | undefined) => ({ locationId, value })

describe('sharedLocationValue', () => {
  it('is the value every location holds', () => {
    expect(sharedLocationValue([at('a', 'https://x'), at('b', 'https://x')])).toBe('https://x')
  })

  it('skips locations with nothing saved', () => {
    expect(sharedLocationValue([at('a', null), at('b', '  '), at('c', 'https://x')])).toBe('https://x')
  })

  it('takes the first non-empty value by location id, whatever order they arrive in', () => {
    const entries = [at('b', 'https://second'), at('a', 'https://first')]
    expect(sharedLocationValue(entries)).toBe('https://first')
    expect(sharedLocationValue([...entries].reverse())).toBe('https://first')
  })

  it('is empty when no location has one', () => {
    expect(sharedLocationValue([])).toBe('')
    expect(sharedLocationValue([at('a', undefined), at('b', '')])).toBe('')
  })

  it('does not change the list it is given', () => {
    const entries = [at('b', '2'), at('a', '1')]
    sharedLocationValue(entries)
    expect(entries.map((e) => e.locationId)).toEqual(['b', 'a'])
  })
})

describe('locationValuesDisagree', () => {
  it('is true when two locations hold different values', () => {
    expect(locationValuesDisagree([at('a', 'https://x'), at('b', 'https://y')])).toBe(true)
  })

  it('is false for matching values, or when only some locations have one', () => {
    expect(locationValuesDisagree([at('a', 'https://x'), at('b', ' https://x ')])).toBe(false)
    expect(locationValuesDisagree([at('a', 'https://x'), at('b', null)])).toBe(false)
    expect(locationValuesDisagree([])).toBe(false)
  })
})
