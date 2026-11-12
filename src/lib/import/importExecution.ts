import { normalizeName } from '../parsers/nameNormalizer'
import { compareProviderNames, matchInitialOnly, parseProviderName } from '../parsers/providerName'
import { supabase } from '../supabase'
import type { CaseType, Category, Constraint, Provider } from '../../types/database'

/** Subset of wizard column mapping; kept here to avoid circular imports. */
export interface ImportColumnMapping {
  excelHeader: string
  role: string
  locationId?: string
  constraintId?: string
  rangePosition?: 'min' | 'max'
  locationScope?: string | 'all'
}

export interface ConflictItem {
  rowIndex: number
  incomingName: string
  existingProvider: Provider
  matchType: 'exact' | 'fuzzy'
  similarity?: number
}

export function detectConflicts(
  rows: Record<string, string>[],
  providerHeader: string,
  existingProviders: Provider[]
): ConflictItem[] {
  const conflicts: ConflictItem[] = []
  const existingParts = existingProviders.map((provider) => parseProviderName(provider.name))

  rows.forEach((row, rowIndex) => {
    const raw = (row[providerHeader] ?? '').trim()
    if (!raw) return
    const incomingNorm = normalizeName(raw)

    // The same name as stored, ignoring only case and punctuation.
    const exactMatch = existingProviders.find((provider) => {
      const existing = (provider.normalized_name ?? normalizeName(provider.name)).trim()
      return incomingNorm === existing
    })
    if (exactMatch) {
      conflicts.push({ rowIndex, incomingName: raw, existingProvider: exactMatch, matchType: 'exact' })
      return
    }

    // Otherwise compare as names, so titles, credentials and name order don't hide a match.
    const incoming = parseProviderName(raw)
    let bestIndex = -1
    let best: { matchType: 'exact' | 'fuzzy'; score: number } | null = null
    existingParts.forEach((parts, index) => {
      const match = compareProviderNames(incoming, parts)
      if (match && (!best || match.score > best.score)) {
        best = match
        bestIndex = index
      }
    })
    if (best && bestIndex >= 0) {
      const { matchType, score } = best as { matchType: 'exact' | 'fuzzy'; score: number }
      conflicts.push({
        rowIndex,
        incomingName: raw,
        existingProvider: existingProviders[bestIndex],
        matchType,
        ...(matchType === 'fuzzy' ? { similarity: score } : {}),
      })
      return
    }

    const initialOnly = matchInitialOnly(incoming, existingParts)
    if (initialOnly !== null) {
      conflicts.push({
        rowIndex,
        incomingName: raw,
        existingProvider: existingProviders[initialOnly],
        matchType: 'fuzzy',
        similarity: 0.8,
      })
    }
  })

  return conflicts
}

function isStrictBinaryOk(value: string): boolean {
  if (value === '') return true
  return ['0', '1', 'true', 'false', 'yes', 'no', 'y', 'n'].includes(value.toLowerCase())
}

export { isStrictBinaryOk }

export interface ExecuteImportParams {
  orgId: string
  filename: string
  headers: string[]
  rows: Record<string, string>[]
  mappings: ImportColumnMapping[]
  orgConstraints: Constraint[]
  orgCaseTypes: CaseType[]
  orgCategories: Category[]
  conflicts: ConflictItem[]
  resolvedConflicts: Record<string, 'merge' | 'separate' | 'skip'>
}

export interface ExecuteImportResult {
  providersCreated: number
  providersUpdated: number
  offeringsUpserted: number
  newCaseTypesCount: number
  newCategoriesCount: number
}

function isImportResult(value: unknown): value is ExecuteImportResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  return [
    'providersCreated',
    'providersUpdated',
    'offeringsUpserted',
    'newCaseTypesCount',
    'newCategoriesCount',
  ].every((key) => Number.isInteger(result[key]) && Number(result[key]) >= 0)
}

/**
 * Submit one bounded import plan to PostgreSQL. The RPC derives the tenant from
 * auth.uid(), validates every referenced id, and performs all writes in the
 * function's single transaction. No browser-side partial writes remain.
 */
export async function executeImportRun(params: ExecuteImportParams): Promise<ExecuteImportResult> {
  const payload = {
    filename: params.filename,
    headers: params.headers,
    rows: params.rows,
    mappings: params.mappings,
    conflicts: params.conflicts.map((conflict) => ({
      rowIndex: conflict.rowIndex,
      existingProviderId: conflict.existingProvider.id,
    })),
    resolvedConflicts: params.resolvedConflicts,
  }

  const { data, error } = await supabase.rpc('execute_provider_import', { p_payload: payload })
  if (error) throw new Error(error.message)
  if (!isImportResult(data)) throw new Error('Import returned an invalid result')
  return data
}
