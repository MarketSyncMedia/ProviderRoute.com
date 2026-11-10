import { describe, expect, it } from 'vitest'
import { detectConflicts } from '../../src/lib/import/importExecution'
import { parseProviderName } from '../../src/lib/parsers/providerName'
import type { Provider } from '../../src/types/database'

/**
 * Provider names as spreadsheets write them. Comparing raw text caught plain
 * typos but missed titles, credentials, "Last, First" order, a dropped middle
 * initial or generation, and short forms of a first name, and each miss makes
 * the import create a second provider for the same person.
 */

const NAMES = [
  'Jeffery T. Brodie',
  'Kenneth DeFontes III',
  'Mark V. Clough',
  'Timothy P. Codd',
  'Sarah Hobart',
  'Elizabeth Inkellis Langhammer',
  'Alexander Adams',
  'Michael J. Marion',
  'Brian D. Mulliken',
  'Brian Shiu',
]

const providers = NAMES.map(
  (name, i) =>
    ({
      id: `p${i}`,
      org_id: 'org1',
      name,
      normalized_name: name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(),
      category_ids: [],
      is_archived: false,
    }) as unknown as Provider,
)

function match(incoming: string) {
  const [conflict] = detectConflicts([{ Provider: incoming }], 'Provider', providers)
  return conflict ? { name: conflict.existingProvider.name, type: conflict.matchType } : null
}

describe('parseProviderName', () => {
  it('drops titles and credentials and reads "Last, First" order', () => {
    expect(parseProviderName('Dr. Jeffery T. Brodie').full).toBe('jeffery t brodie')
    expect(parseProviderName('Jeffery T. Brodie, MD').full).toBe('jeffery t brodie')
    expect(parseProviderName('Brodie, Jeffery T.').full).toBe('jeffery t brodie')
    expect(parseProviderName('Brodie, Jeffery T., MD').full).toBe('jeffery t brodie')
    expect(parseProviderName('Smith, John, Jr.').full).toBe('john smith jr')
  })

  it('keeps a middle initial and a generation out of the first and last name', () => {
    expect(parseProviderName('Kenneth DeFontes III')).toMatchObject({
      first: 'kenneth',
      last: 'defontes',
      core: 'kenneth defontes',
    })
    expect(parseProviderName('Mark V. Clough')).toMatchObject({ first: 'mark', last: 'clough', initials: ['v'] })
  })

  it('treats a hyphenated surname as separate words', () => {
    expect(parseProviderName('Elizabeth Inkellis-Langhammer')).toMatchObject({
      first: 'elizabeth',
      last: 'langhammer',
    })
  })

  it('copes with one-word and empty names', () => {
    expect(parseProviderName('Cher').full).toBe('cher')
    expect(parseProviderName('Dr.').full).toBe('dr')
    expect(parseProviderName('  ').full).toBe('')
  })
})

describe('provider name matching', () => {
  it.each([
    ['Dr. Jeffery T. Brodie', 'Jeffery T. Brodie'],
    ['Brodie, Jeffery T.', 'Jeffery T. Brodie'],
    ['Jeffery T Brodie MD', 'Jeffery T. Brodie'],
    ['Jeffery T. Brodie, MD', 'Jeffery T. Brodie'],
    ['Sarah Hobart MD', 'Sarah Hobart'],
    ['Dr. Alexander Adams', 'Alexander Adams'],
    ['Elizabeth Inkellis-Langhammer', 'Elizabeth Inkellis Langhammer'],
  ])('treats %s as the same person, so it can be auto-merged', (incoming, existing) => {
    expect(match(incoming)).toEqual({ name: existing, type: 'exact' })
  })

  it.each([
    ['Kenneth DeFontes', 'Kenneth DeFontes III'],
    ['Mark Clough', 'Mark V. Clough'],
    ['Elizabeth Langhammer', 'Elizabeth Inkellis Langhammer'],
    ['Tim Codd', 'Timothy P. Codd'],
    ['Timothy Codd', 'Timothy P. Codd'],
    ['Jeffrey T. Brodie', 'Jeffery T. Brodie'],
    ['Sara Hobart', 'Sarah Hobart'],
    ['Alexander Adam', 'Alexander Adams'],
  ])('flags %s as possibly %s for the admin to decide', (incoming, existing) => {
    expect(match(incoming)).toMatchObject({ name: existing, type: 'fuzzy' })
  })

  it('flags a bare initial only when one provider could be meant', () => {
    expect(match('J. Brodie')).toMatchObject({ name: 'Jeffery T. Brodie', type: 'fuzzy' })
    // Two Brians: "B. Shiu" can only be Shiu, but "B. Mulliken" and others are unique too;
    // an initial matching two people is left alone.
    const two = [
      ...providers,
      { ...providers[0], id: 'x1', name: 'John Smith', normalized_name: 'john smith' },
      { ...providers[0], id: 'x2', name: 'Jane Smith', normalized_name: 'jane smith' },
    ]
    expect(detectConflicts([{ Provider: 'J. Smith' }], 'Provider', two)).toHaveLength(0)
  })

  it('ranks different middle initials lower, but still raises them', () => {
    const [conflict] = detectConflicts([{ Provider: 'Mark A. Clough' }], 'Provider', providers)
    expect(conflict).toMatchObject({ matchType: 'fuzzy' })
    expect(conflict.existingProvider.name).toBe('Mark V. Clough')
  })

  it.each(['Totally New Person', 'Mark Johnson', 'Brian Shaw', 'Michael Brodie', 'Jeffery Marion'])(
    'does not match a different person: %s',
    (incoming) => {
      expect(match(incoming)).toBeNull()
    },
  )

  it('picks the closest of several candidates', () => {
    expect(match('Brian Shiu MD')).toEqual({ name: 'Brian Shiu', type: 'exact' })
    expect(match('Brian Mulliken')).toMatchObject({ name: 'Brian D. Mulliken' })
  })
})
