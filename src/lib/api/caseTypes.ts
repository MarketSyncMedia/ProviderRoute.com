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

/**
 * Archives a case type for every provider at once. Offerings are left as they
 * are, so restoring the case type brings back exactly what each provider had.
 * The row keeps its map_tag for the same reason; the unique index only counts
 * live rows, so the spot is free for another case type meanwhile.
 */
export async function archiveCaseType(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('case_types').update({ is_archived: true }).eq('id', id)

  return { error: error?.message ?? null }
}

export async function getArchivedCaseTypes(orgId: string): Promise<CaseType[]> {
  const { data, error } = await supabase
    .from('case_types')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_archived', true)
    .order('name', { ascending: true })

  if (error || !data) {
    return []
  }

  return data as CaseType[]
}

/**
 * Brings an archived case type back at the end of the list. If another case
 * type took its body map spot while it was archived, it comes back without a
 * spot rather than failing on the one-case-type-per-spot index.
 */
export async function restoreCaseType(
  caseType: Pick<CaseType, 'id' | 'org_id' | 'map_tag'>,
): Promise<{ error: string | null; lostSpot: boolean }> {
  const { data: maxRow } = await supabase
    .from('case_types')
    .select('sort_order')
    .eq('org_id', caseType.org_id)
    .eq('is_archived', false)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const maxSort = maxRow?.sort_order
  const update: { is_archived: false; sort_order: number; map_tag?: null } = {
    is_archived: false,
    sort_order: typeof maxSort === 'number' ? maxSort + 1 : 0,
  }

  let lostSpot = false
  if (caseType.map_tag) {
    const { data: holder, error: holderError } = await supabase
      .from('case_types')
      .select('id')
      .eq('org_id', caseType.org_id)
      .eq('is_archived', false)
      .eq('map_tag', caseType.map_tag)
      .limit(1)
    if (holderError) {
      return { error: holderError.message, lostSpot }
    }
    if (holder?.length) {
      update.map_tag = null
      lostSpot = true
    }
  }

  const { error } = await supabase.from('case_types').update(update).eq('id', caseType.id)

  return { error: error?.message ?? null, lostSpot }
}

/** A provider offering a case type, with the ids of every such offering. */
export interface CaseTypeProvider {
  providerId: string
  providerName: string
  offeringIds: string[]
}

/**
 * The live providers offering a case type, so it can be archived for just
 * some of them. A provider can offer one case type several times (different
 * locations or constraints); those offerings are grouped under one entry.
 */
export async function getCaseTypeProviders(caseTypeId: string): Promise<CaseTypeProvider[]> {
  // offerings -> providers is many-to-one, so PostgREST embeds one object; the
  // inferred type says array, hence the override.
  type Row = { id: string; provider_id: string; providers: { name: string } | null }
  const rows = await selectAllRows<Row>((from, to) =>
    supabase
      .from('offerings')
      .select('id, provider_id, providers!inner(name)')
      .eq('case_type_id', caseTypeId)
      .eq('is_archived', false)
      .eq('providers.is_archived', false)
      .range(from, to)
      .overrideTypes<Row[], { merge: false }>(),
  )

  // Throws rather than returning [], which would read as "no provider offers
  // this" and steer the admin to archive it for everyone.
  if (!rows) {
    throw new Error('Could not load the providers offering this case type')
  }

  const byProvider = new Map<string, CaseTypeProvider>()
  for (const row of rows) {
    const entry = byProvider.get(row.provider_id) ?? {
      providerId: row.provider_id,
      providerName: row.providers?.name ?? 'Unnamed provider',
      offeringIds: [],
    }
    entry.offeringIds.push(row.id)
    byProvider.set(row.provider_id, entry)
  }

  return [...byProvider.values()].sort((a, b) => a.providerName.localeCompare(b.providerName))
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
      .select('case_type_id, providers!inner()')
      .eq('is_archived', false)
      .eq('providers.is_archived', false)
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
