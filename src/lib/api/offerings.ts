import { supabase } from '../supabase'
import type { Offering } from '../../types/database'

/** Postgres error code for a unique constraint violation. */
const UNIQUE_VIOLATION = '23505'

/**
 * A provider holds one offering per case type, archived or not, so changing an
 * offering to a case type they already have hits offerings' unique constraint.
 */
export function offeringSaveError(error: { code?: string; message: string }): string {
  return error.code === UNIQUE_VIOLATION
    ? 'This provider already has an offering for that case type, which may be archived. Edit or restore that one instead.'
    : error.message
}

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
}): Promise<{ data: Offering | null; error: string | null; restored?: boolean }> {
  const details = {
    location_ids: data.location_ids ?? [],
    constraints: data.constraints ?? {},
  }
  const { data: inserted, error } = await supabase
    .from('offerings')
    .insert({
      provider_id: data.provider_id,
      case_type_id: data.case_type_id,
      org_id: data.org_id,
      ...details,
    })
    .select()
    .single()

  if (error?.code === UNIQUE_VIOLATION) {
    return reviveArchivedOffering(data.provider_id, data.case_type_id, details)
  }

  if (error || !inserted) {
    return { data: null, error: error?.message ?? 'Failed to create offering' }
  }

  return { data: inserted as Offering, error: null }
}

/**
 * Adding back a case type the provider has archived brings that offering back
 * with the details just entered. Only an archived offering is updated, so no
 * row back means the existing one is live and the admin should edit it.
 */
async function reviveArchivedOffering(
  providerId: string,
  caseTypeId: string,
  details: { location_ids: string[]; constraints: Record<string, unknown> },
): Promise<{ data: Offering | null; error: string | null; restored?: boolean }> {
  const { data, error } = await supabase
    .from('offerings')
    .update({ ...details, is_archived: false })
    .eq('provider_id', providerId)
    .eq('case_type_id', caseTypeId)
    .eq('is_archived', true)
    .select()
    .maybeSingle()

  if (error) {
    return { data: null, error: error.message }
  }
  if (!data) {
    return { data: null, error: 'This provider already has an offering for that case type. Edit that one instead.' }
  }
  return { data: data as Offering, error: null, restored: true }
}

export async function updateOffering(
  id: string,
  updates: Partial<Offering>
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('offerings').update(updates).eq('id', id)
  return { error: error ? offeringSaveError(error) : null }
}

export async function restoreOffering(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('offerings').update({ is_archived: false }).eq('id', id)
  return { error: error?.message ?? null }
}

/**
 * Leaves the provider's booking link and phone for its locations saved, even
 * if this was their last offering there, so restoring it brings them back. The
 * widget only offers saved details where a live offering remains.
 */
export async function archiveOffering(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('offerings').update({ is_archived: true }).eq('id', id)
  return { error: error?.message ?? null }
}
