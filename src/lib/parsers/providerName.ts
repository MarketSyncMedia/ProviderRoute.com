import { fuzzyMatch, normalizeName } from './nameNormalizer'

/**
 * Provider names as spreadsheets actually write them: "Dr. Jeffery T. Brodie",
 * "Brodie, Jeffery T.", "Jeffery Brodie, MD", "Tim Codd". Comparing the raw
 * text missed all of those, and a miss makes the import create a second
 * provider for the same person.
 */

const HONORIFICS = new Set(['dr', 'doctor', 'prof', 'professor', 'mr', 'mrs', 'ms', 'mx'])
const CREDENTIALS = new Set([
  'md', 'do', 'dpm', 'phd', 'pa', 'pac', 'np', 'dc', 'dds', 'dmd', 'od', 'rn', 'mph', 'mba', 'ms', 'msc',
  'facs', 'faaos', 'mbbs', 'pt', 'dpt', 'atc', 'ocs', 'cscs',
])
// "V" is left out: "Mark V. Clough" is a middle initial, not a generation.
const GENERATIONS = new Set(['jr', 'sr', 'ii', 'iii', 'iv'])

export interface ProviderNameParts {
  /** Lower case, no title or credentials, middle names and generation kept. */
  full: string
  first: string
  last: string
  /** First and last name only: what stays when middle names, initials and generation are ignored. */
  core: string
  /** Middle initials, in order. */
  initials: string[]
}

const tokensOf = (text: string): string[] =>
  normalizeName(text.replace(/[-–—]/g, ' '))
    .split(' ')
    .filter(Boolean)

const isCredential = (token: string) => CREDENTIALS.has(token) || GENERATIONS.has(token)

export function parseProviderName(raw: string): ProviderNameParts {
  const pieces = raw
    .split(',')
    .map((piece) => piece.trim())
    .filter(Boolean)

  // "Brodie, Jeffery T." is last name first; "Jeffery Brodie, MD" is a credential
  // after a comma. What follows the comma tells them apart.
  const afterComma = tokensOf(pieces.slice(1).join(' '))
  const lastNameFirst = pieces.length >= 2 && !afterComma.every(isCredential)

  let tokens: string[]
  if (lastNameFirst) {
    // "Brodie, Jeffery T., MD": credentials trailing the first names belong at the end.
    const trailing: string[] = []
    while (afterComma.length > 0 && isCredential(afterComma[afterComma.length - 1])) {
      trailing.unshift(afterComma.pop() as string)
    }
    tokens = [...afterComma, ...tokensOf(pieces[0]), ...trailing]
  } else {
    tokens = tokensOf(pieces.join(' '))
  }
  while (tokens.length > 1 && HONORIFICS.has(tokens[0])) tokens.shift()
  while (tokens.length > 1 && CREDENTIALS.has(tokens[tokens.length - 1])) tokens.pop()

  const named = tokens.filter((token, index) => !(index > 0 && GENERATIONS.has(token)))
  const first = named[0] ?? ''
  const last = named[named.length - 1] ?? ''
  const initials = named.slice(1, -1).filter((token) => token.length === 1)

  return { full: tokens.join(' '), first, last, core: `${first} ${last}`.trim(), initials }
}

export interface NameMatch {
  matchType: 'exact' | 'fuzzy'
  score: number
}

/** A nickname or short form of the other's first name: "Tim" and "Timothy". */
const isShortForm = (a: string, b: string) => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 3 && long.startsWith(short)
}

/**
 * How likely two names are the same person. "exact" means the same once
 * titles, credentials and name order are ignored; everything else is "fuzzy",
 * which the import shows for the admin to merge, keep separate or skip.
 */
export function compareProviderNames(incoming: ProviderNameParts, existing: ProviderNameParts): NameMatch | null {
  if (!incoming.full || !existing.full) return null
  if (incoming.full === existing.full) return { matchType: 'exact', score: 1 }

  let best = 0

  if (incoming.last === existing.last && incoming.first.length > 1 && existing.first.length > 1) {
    const sameFirst = incoming.first === existing.first
    if (sameFirst || isShortForm(incoming.first, existing.first)) {
      // Different middle initials are a hint these are two people, so rank it lower.
      const initialsClash =
        incoming.initials.length > 0 &&
        existing.initials.length > 0 &&
        incoming.initials.join('') !== existing.initials.join('')
      best = Math.max(best, initialsClash ? 0.86 : sameFirst ? 0.95 : 0.9)
    }
  }

  best = Math.max(best, fuzzyMatch(incoming.core, existing.core), fuzzyMatch(incoming.full, existing.full))

  return best > 0.85 ? { matchType: 'fuzzy', score: best } : null
}

/**
 * The only existing provider a name like "J. Brodie" could be, if there is
 * exactly one: a bare initial is too thin to pick among several people.
 */
export function matchInitialOnly(incoming: ProviderNameParts, existing: ProviderNameParts[]): number | null {
  if (incoming.first.length !== 1 || !incoming.last) return null
  const candidates = existing
    .map((parts, index) => ({ parts, index }))
    .filter(({ parts }) => parts.last === incoming.last && parts.first.startsWith(incoming.first))
  return candidates.length === 1 ? candidates[0].index : null
}
