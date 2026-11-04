import { supabase } from '../supabase'
import type { Offering } from '../../types/database'

// Offerings of an archived case type stay as they are so restoring the case
// type brings them back; the inner join hides them meanwhile.
export async function getOfferingsByProvider(providerId: string): Promise<Offering[]> {
  const { data, error } = await supabase
    .from('offerings')
    .select('*, case_types!inner()')
    .eq('provider_id', providerId)
    .eq('is_archived', false)
    .eq('case_types.is_archived', false)

  if (error || !data) {
    return []
  }

  return data as Offering[]
}

export async function getArchivedOfferingsByProvider(providerId: string): Promise<Offering[]> {
  const { data, error } = await supabase
    .from('offerings')
    .select('*, case_types!inner()')
    .eq('provider_id', providerId)
    .eq('is_archived', true)
    .eq('case_types.is_archived', false)

  if (error || !data) {
    return []
  }

  return data as Offering[]
}

export async function createOffering(data: {
  provider_id: string
  case_type_id: string
  org_id: string
  location_ids?: string[]
  constraints?: Record<string, unknown>
}): Promise<{ data: Offering | null; error: string | null }> {
  const { data: inserted, error } = await supabase
    .from('offerings')
    .insert({
      provider_id: data.provider_id,
      case_type_id: data.case_type_id,
      org_id: data.org_id,
      location_ids: data.location_ids ?? [],
      constraints: data.constraints ?? {},
    })
    .select()
    .single()

  if (error || !inserted) {
    return { data: null, error: error?.message ?? 'Failed to create offering' }
  }

  return { data: inserted as Offering, error: null }
}

export async function updateOffering(
  id: string,
  updates: Partial<Offering>
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('offerings').update(updates).eq('id', id)
  return { error: error?.message ?? null }
}

export async function restoreOffering(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('offerings').update({ is_archived: false }).eq('id', id)
  return { error: error?.message ?? null }
}

export async function archiveOffering(id: string): Promise<{ error: string | null }> {
  const { data: offering, error: fetchError } = await supabase
    .from('offerings')
    .select('provider_id, location_ids')
    .eq('id', id)
    .single()

  if (fetchError || !offering) {
    return { error: fetchError?.message ?? 'Offering not found' }
  }

  const { error: archiveError } = await supabase
    .from('offerings')
    .update({ is_archived: true })
    .eq('id', id)

  if (archiveError) {
    return { error: archiveError.message }
  }

  const providerId = offering.provider_id as string
  const locationIds = (offering.location_ids as string[]) ?? []

  for (const locationId of locationIds) {
    const { data: activeOfferings, error: checkError } = await supabase
      .from('offerings')
      .select('id')
      .eq('provider_id', providerId)
      .eq('is_archived', false)
      .contains('location_ids', [locationId])
      .limit(1)

    if (checkError) {
      return { error: checkError.message }
    }

    if (!activeOfferings?.length) {
      const { error: deleteError } = await supabase
        .from('provider_locations')
        .delete()
        .eq('provider_id', providerId)
        .eq('location_id', locationId)

      if (deleteError) {
        return { error: deleteError.message }
      }
    }
  }

  return { error: null }
}
