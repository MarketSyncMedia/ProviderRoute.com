import { describe, expect, it } from 'vitest'
import { formatPhone } from '../../src/lib/phone'

describe('formatPhone', () => {
  it('writes ten digits one way however they were typed', () => {
    for (const typed of ['4103377900', '(410) 337-7900', '410-337-7900', '410.337.7900', ' 410 337 7900 ']) {
      expect(formatPhone(typed)).toBe('(410) 337-7900')
    }
  })

  it('drops a leading country code 1', () => {
    expect(formatPhone('1-410-337-7900')).toBe('(410) 337-7900')
    expect(formatPhone('+1 410 337 7900')).toBe('(410) 337-7900')
  })

  it('leaves anything else as typed, trimmed', () => {
    expect(formatPhone('410-337-7900 ext. 12')).toBe('410-337-7900 ext. 12')
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958')
    expect(formatPhone('337-7900')).toBe('337-7900')
    expect(formatPhone(' 4103 ')).toBe('4103')
  })

  it('handles nothing', () => {
    expect(formatPhone('')).toBe('')
    expect(formatPhone(null)).toBe('')
    expect(formatPhone(undefined)).toBe('')
  })
})
