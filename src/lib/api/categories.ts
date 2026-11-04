import { supabase } from '../supabase'
import type { Category } from '../../types/database'
import { selectAllRows } from './paginate'

export async function getCategories(orgId: string): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_archived', false)
    .order('sort_order', { ascending: true })

  if (error || !data) {
    return []
  }

  return data as Category[]
}

export async function createCategory(
  orgId: string,
  name: string
): Promise<{ data: Category | null; error: string | null }> {
  const { data: maxRow } = await supabase
    .from('categories')
    .select('sort_order')
    .eq('org_id', orgId)
    .eq('is_archived', false)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const maxSort = maxRow?.sort_order
  const nextSort = typeof maxSort === 'number' ? maxSort + 1 : 0

  const { data: inserted, error } = await supabase
    .from('categories')
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

  return { data: (inserted as Category) ?? null, error: null }
}

export async function updateCategory(id: string, name: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('categories').update({ name }).eq('id', id)

  return { error: error?.message ?? null }
}

export async function updateCategoryOrders(
  updates: Array<{ id: string; sort_order: number }>
): Promise<{ error: string | null }> {
  const results = await Promise.all(
    updates.map((u) => supabase.from('categories').update({ sort_order: u.sort_order }).eq('id', u.id))
  )

  const failed = results.find((r) => r.error)
  return { error: failed?.error?.message ?? null }
}

export async function archiveCategory(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('categories').update({ is_archived: true }).eq('id', id)

  return { error: error?.message ?? null }
}

/**
 * Offering counts for many categories in one pass — for each category, the
 * non-archived offerings whose provider lists it in category_ids (parity with
 * the case type usage badge).
 *
 * Counting per row previously cost *two* requests per category (its providers,
 * then their offerings), so 50 categories meant 100 requests on every load.
 * Two paged reads now cover the whole list.
 */
export async function getCategoryOfferingCounts(
  categoryIds: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const id of categoryIds) {
    counts[id] = 0
  }
  if (categoryIds.length === 0) {
    return counts
  }

  const providers = await selectAllRows<{ id: string; category_ids: string[] | null }>((from, to) =>
    supabase
      .from('providers')
      .select('id, category_ids')
      .eq('is_archived', false)
      .overlaps('category_ids', categoryIds)
      .range(from, to),
  )
  if (!providers?.length) {
    return counts
  }

  const offerings = await selectAllRows<{ provider_id: string | null }>((from, to) =>
    supabase
      .from('offerings')
      .select('provider_id, case_types!inner()')
      .eq('is_archived', false)
      .eq('case_types.is_archived', false)
      .in(
        'provider_id',
        providers.map((p) => p.id),
      )
      .range(from, to),
  )
  if (!offerings) {
    return counts
  }

  const offeringsByProvider = new Map<string, number>()
  for (const row of offerings) {
    if (row.provider_id != null) {
      offeringsByProvider.set(row.provider_id, (offeringsByProvider.get(row.provider_id) ?? 0) + 1)
    }
  }

  for (const provider of providers) {
    const offeringCount = offeringsByProvider.get(provider.id) ?? 0
    if (offeringCount === 0) {
      continue
    }
    // Deduped: a category listed twice on one provider must not count twice.
    for (const categoryId of new Set(provider.category_ids ?? [])) {
      if (categoryId in counts) {
        counts[categoryId] += offeringCount
      }
    }
  }

  return counts
}
