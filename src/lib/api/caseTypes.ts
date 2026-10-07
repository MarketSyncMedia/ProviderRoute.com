import { supabase } from '../supabase'
import type { CaseType } from '../../types/database'
import { selectAllRows } from './paginate'

export async function getCaseTypes(orgId: string): Promise<CaseType[]> {
  const { data, error } = await supabase
    .from('case_types')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_archived', false)
    .order('sort_order', { ascending: true })

  if (error || !data) {
    return []
  }

  return data as CaseType[]
}

export async function createCaseType(
  orgId: string,
  name: string
): Promise<{ data: CaseType | null; error: string | null }> {
  const { data: maxRow } = await supabase
    .from('case_types')
    .select('sort_order')
    .eq('org_id', orgId)
    .eq('is_archived', false)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const maxSort = maxRow?.sort_order
  const nextSort = typeof maxSort === 'number' ? maxSort + 1 : 0

  const { data: inserted, error } = await supabase
    .from('case_types')
    .insert({
      org_id: orgId,
      name,
      sort_order: nextSort,
    })
    .select()
    .maybeSingle()

  if (error) {
    return { data: null, error: error.message }
  }

  return { data: (inserted as CaseType) ?? null, error: null }
}

export async function updateCaseType(id: string, name: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('case_types').update({ name }).eq('id', id)

  return { error: error?.message ?? null }
}

/** Links a case type to a body map spot, or unlinks it with `null`. */
export async function updateCaseTypeMapTag(
  id: string,
  mapTag: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('case_types').update({ map_tag: mapTag }).eq('id', id)

  return { error: error?.message ?? null }
}

export async function updateCaseTypeOrders(
  updates: Array<{ id: string; sort_order: number }>
): Promise<{ error: string | null }> {
  const results = await Promise.all(
    updates.map((u) => supabase.from('case_types').update({ sort_order: u.sort_order }).eq('id', u.id))
  )

  const failed = results.find((r) => r.error)
  return { error: failed?.error?.message ?? null }
}

export async function archiveCaseType(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('case_types').update({ is_archived: true }).eq('id', id)

  return { error: error?.message ?? null }
}

/**
 * Offering counts for many case types in one pass.
 *
 * Counting per row previously cost one request per case type — fine for a
 * handful, but a list page with 50 of them fired 50 requests on every load.
 */
export async function getCaseTypeOfferingCounts(
  caseTypeIds: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const id of caseTypeIds) {
    counts[id] = 0
  }
  if (caseTypeIds.length === 0) {
    return counts
  }

  const rows = await selectAllRows<{ case_type_id: string | null }>((from, to) =>
    supabase
      .from('offerings')
      .select('case_type_id')
      .eq('is_archived', false)
      .in('case_type_id', caseTypeIds)
      .range(from, to),
  )
  if (!rows) {
    return counts
  }

  for (const row of rows) {
    if (row.case_type_id != null && row.case_type_id in counts) {
      counts[row.case_type_id] += 1
    }
  }

  return counts
}
