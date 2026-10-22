import { supabase } from '../supabase'
import { selectAllRows } from './paginate'
import type { Offering, Provider } from '../../types/database'

/**
 * An offering with the subset of provider columns the data table selects.
 *
 * The index signature is load-bearing, not laziness: the data table builds
 * columns dynamically from the org's constraint keys and reads them by string,
 * so rows genuinely are indexable beyond the declared fields.
 */
export interface DataTableOffering extends Offering {
  providers: Pick<Provider, 'id' | 'name' | 'category_ids' | 'image_url'> | null
  [key: string]: unknown
}

export async function getDataTableOfferings(orgId: string): Promise<DataTableOffering[]> {
  // Paged: this backs the whole data table, so truncating at PostgREST's row
  // cap would hide offerings from the admin entirely rather than merely
  // shortening a list.
  const rows = await selectAllRows<DataTableOffering>((from, to) =>
    supabase
      .from('offerings')
      .select('*, providers(id, name, category_ids, image_url)')
      .eq('org_id', orgId)
      .eq('is_archived', false)
      .range(from, to),
  )

  return rows ?? []
}

/**
 * Archived counterpart of getDataTableOfferings, backing the data table's
 * "Archived" view. Paged for the same reason: an import that replaces data can
 * archive thousands of rows at once.
 */
export async function getArchivedDataTableOfferings(orgId: string): Promise<DataTableOffering[]> {
  const rows = await selectAllRows<DataTableOffering>((from, to) =>
    supabase
      .from('offerings')
      .select('*, providers(id, name, category_ids, image_url)')
      .eq('org_id', orgId)
      .eq('is_archived', true)
      .range(from, to),
  )

  return rows ?? []
}

export async function updateOfferingLocationIds(
  offeringId: string,
  locationIds: string[]
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('offerings')
    .update({ location_ids: locationIds })
    .eq('id', offeringId)

  return { error: error?.message ?? null }
}

export async function updateOfferingConstraint(
  offeringId: string,
  key: string,
  value: unknown
): Promise<{ error: string | null }> {
  const { data: offering, error: fetchError } = await supabase
    .from('offerings')
    .select('constraints')
    .eq('id', offeringId)
    .maybeSingle()

  if (fetchError || !offering) {
    return { error: fetchError?.message ?? 'Failed to fetch offering constraints' }
  }

  const currentConstraints = (offering.constraints ?? {}) as Record<string, unknown>
  const merged = { ...currentConstraints, [key]: value }

  const { error } = await supabase.from('offerings').update({ constraints: merged }).eq('id', offeringId)
  return { error: error?.message ?? null }
}

export async function updateOfferingCaseType(
  offeringId: string,
  caseTypeId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('offerings')
    .update({ case_type_id: caseTypeId })
    .eq('id', offeringId)

  return { error: error?.message ?? null }
}

export async function updateProviderCategories(
  providerId: string,
  categoryIds: string[]
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('providers')
    .update({ category_ids: categoryIds })
    .eq('id', providerId)

  return { error: error?.message ?? null }
}

export async function archiveOfferings(offeringIds: string[]): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('offerings')
    .update({ is_archived: true })
    .in('id', offeringIds)

  return { error: error?.message ?? null }
}

export async function restoreOfferings(offeringIds: string[]): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('offerings')
    .update({ is_archived: false })
    .in('id', offeringIds)

  return { error: error?.message ?? null }
}

export async function archiveAllOfferings(orgId: string): Promise<{ error: string | null }> {
  const { data: providers, error: providersError } = await supabase
    .from('providers')
    .select('id')
    .eq('org_id', orgId)

  if (providersError) {
    return { error: providersError.message }
  }

  const providerIds = (providers ?? []).map((p) => p.id).filter(Boolean)

  if (providerIds.length > 0) {
    const { error: providerLocationsError } = await supabase
      .from('provider_locations')
      .delete()
      .in('provider_id', providerIds)

    if (providerLocationsError) {
      return { error: providerLocationsError.message }
    }
  }

  const { error: offeringsError } = await supabase.from('offerings').delete().eq('org_id', orgId)
  if (offeringsError) {
    return { error: offeringsError.message }
  }

  const { error: providersDeleteError } = await supabase.from('providers').delete().eq('org_id', orgId)
  if (providersDeleteError) {
    return { error: providersDeleteError.message }
  }

  const { error: categoriesError } = await supabase.from('categories').delete().eq('org_id', orgId)
  if (categoriesError) {
    return { error: categoriesError.message }
  }

  const { error: caseTypesError } = await supabase.from('case_types').delete().eq('org_id', orgId)
  if (caseTypesError) {
    return { error: caseTypesError.message }
  }

  const { error: importHistoryError } = await supabase.from('import_history').delete().eq('org_id', orgId)
  if (importHistoryError) {
    return { error: importHistoryError.message }
  }

  return { error: null }
}
