import { describe, expect, it } from 'vitest'
import { coerceRangeValues } from '../../src/lib/constraintValues'

const age = { type: 'range', mapped_key: 'age_min', secondary_mapped_key: 'age_max' } as const
const sports = { type: 'binary', mapped_key: 'Sports_only', secondary_mapped_key: null } as const
const note = { type: 'exact', mapped_key: 'note', secondary_mapped_key: null } as const

describe('coerceRangeValues', () => {
  it('turns the text a number box hands back into numbers', () => {
    expect(coerceRangeValues({ age_min: '16', age_max: '200' }, [age])).toEqual({ age_min: 16, age_max: 200 })
    expect(coerceRangeValues({ age_min: ' 0 ', age_max: '12.5' }, [age])).toEqual({ age_min: 0, age_max: 12.5 })
  })

  it('leaves numbers alone', () => {
    expect(coerceRangeValues({ age_min: 16, age_max: 200 }, [age])).toEqual({ age_min: 16, age_max: 200 })
  })

  it('drops a cleared box instead of storing an empty string, which would read as 0', () => {
    expect(coerceRangeValues({ age_min: '12', age_max: '' }, [age])).toEqual({ age_min: 12 })
  })

  it('does not touch other constraints, or text that is not a number', () => {
    const values = { Sports_only: 1, note: '16', age_min: 'abc' }
    expect(coerceRangeValues(values, [age, sports, note])).toEqual({ Sports_only: 1, note: '16', age_min: 'abc' })
  })

  it('returns a copy', () => {
    const values = { age_min: '16' }
    expect(coerceRangeValues(values, [age])).not.toBe(values)
    expect(values).toEqual({ age_min: '16' })
  })
})
