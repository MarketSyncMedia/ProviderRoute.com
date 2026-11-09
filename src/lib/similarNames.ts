import { fuzzyMatch, normalizeName } from './parsers/nameNormalizer'

/**
 * How alike two names must be (1 is identical) for one to be treated as a
 * likely misspelling of the other. One slipped letter in a name of ordinary
 * length clears it ("Sports Medincine" is 94% of "Sports Medicine"); two
 * different short words ("Hip", "Hop") do not.
 */
export const SIMILAR_NAME_THRESHOLD = 0.8

export interface SimilarName {
  name: string
  score: number
}

/**
 * The existing name this one most likely means, when it is almost but not
 * exactly one of them. Names that match once case and punctuation are ignored
 * are not returned: those are duplicates, which callers already report.
 */
export function findSimilarName(name: string, existing: readonly string[]): SimilarName | null {
  const incoming = normalizeName(name)
  if (!incoming) return null

  let best: SimilarName | null = null
  for (const candidate of existing) {
    const other = normalizeName(candidate)
    if (!other || other === incoming) continue
    const score = fuzzyMatch(incoming, other)
    if (score >= SIMILAR_NAME_THRESHOLD && (!best || score > best.score)) {
      best = { name: candidate, score }
    }
  }
  return best
}

export type NameKind = 'caseType' | 'category'

/** A name in an import file that is probably a misspelling of one that exists. */
export interface NameFix {
  kind: NameKind
  incoming: string
  suggested: string
  score: number
}

export const nameFixKey = (fix: Pick<NameFix, 'kind' | 'incoming'>) =>
  `${fix.kind}:${fix.incoming.trim().toLowerCase()}`

/** A category cell may list several, separated by commas, as the import reads it. */
function categoryParts(cell: string | undefined): string[] {
  return (cell ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

interface NameFixInput {
  rows: Record<string, string>[]
  caseTypeHeader?: string
  categoryHeader?: string
  existingCaseTypes: readonly string[]
  existingCategories: readonly string[]
}

/**
 * Names in the file that are not an existing case type or category but are
 * almost one, each with the name it most likely means. Left alone, the import
 * would create each as a new entry next to the correct one.
 */
export function suggestNameFixes({
  rows,
  caseTypeHeader,
  categoryHeader,
  existingCaseTypes,
  existingCategories,
}: NameFixInput): NameFix[] {
  const fixes = new Map<string, NameFix>()

  const consider = (kind: NameKind, incoming: string, existing: readonly string[]) => {
    if (!incoming || existing.some((name) => name.trim().toLowerCase() === incoming.toLowerCase())) return
    const similar = findSimilarName(incoming, existing)
    if (!similar) return
    const fix = { kind, incoming, suggested: similar.name, score: similar.score }
    const key = nameFixKey(fix)
    if (!fixes.has(key)) fixes.set(key, fix)
  }

  for (const row of rows) {
    if (caseTypeHeader) consider('caseType', (row[caseTypeHeader] ?? '').trim(), existingCaseTypes)
    if (categoryHeader) {
      for (const part of categoryParts(row[categoryHeader])) consider('category', part, existingCategories)
    }
  }
  return [...fixes.values()]
}

/**
 * The rows with each fix applied: a case type cell naming `incoming` reads
 * `suggested` instead, and so does each matching entry in a category cell. The
 * same rows come back when there is nothing to apply.
 */
export function applyNameFixes(
  rows: Record<string, string>[],
  caseTypeHeader: string | undefined,
  categoryHeader: string | undefined,
  fixes: readonly NameFix[],
): Record<string, string>[] {
  if (fixes.length === 0) return rows
  const suggestedBy = new Map(fixes.map((fix) => [nameFixKey(fix), fix.suggested]))

  return rows.map((row) => {
    let next = row
    if (caseTypeHeader) {
      const incoming = (row[caseTypeHeader] ?? '').trim()
      const suggested = suggestedBy.get(nameFixKey({ kind: 'caseType', incoming }))
      if (suggested) next = { ...next, [caseTypeHeader]: suggested }
    }
    if (categoryHeader) {
      const parts = categoryParts(row[categoryHeader])
      const mapped = parts.map((part) => suggestedBy.get(nameFixKey({ kind: 'category', incoming: part })) ?? part)
      if (mapped.some((part, index) => part !== parts[index])) {
        next = { ...next, [categoryHeader]: mapped.join(', ') }
      }
    }
    return next
  })
}
