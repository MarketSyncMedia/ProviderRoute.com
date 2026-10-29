import { supabase } from '../supabase'
import type { Location } from '../../types/database'
import { selectAllRows } from './paginate'

export async function getLocations(orgId: string): Promise<Location[]> {
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_archived', false)
    .order('name', { ascending: true })

  if (error || !data) {
    return []
  }

  return (data as Location[]).filter(Boolean)
}

export async function createLocation(data: {
  org_id: string
  name: string
  address?: string
  phone?: string
  directions_url?: string
}): Promise<{ data: Location | null; error: string | null }> {
  const { data: inserted, error } = await supabase
    .from('locations')
    .insert({
      org_id: data.org_id,
      name: data.name,
      address: data.address ?? null,
      phone: data.phone ?? null,
      directions_url: data.directions_url ?? null,
    })
    .select()
    .maybeSingle()

  if (error) {
    return { data: null, error: error.message }
  }

  return { data: (inserted as Location) ?? null, error: null }
}

export async function updateLocation(id: string, updates: Partial<Location>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('locations').update(updates).eq('id', id)

  return { error: error?.message ?? null }
}

export async function archiveLocation(id: string, orgId: string): Promise<{ error: string | null }> {
  const { error: deletePlError } = await supabase.from('provider_locations').delete().eq('location_id', id)

  if (deletePlError) {
    return { error: deletePlError.message }
  }

  // Paged: a partial read would leave the archived location still referenced
  // on every offering past the first page.
  const offerings = await selectAllRows<{ id: string; location_ids: string[] }>((from, to) =>
    supabase
      .from('offerings')
      .select('id, location_ids')
      .eq('org_id', orgId)
      .contains('location_ids', [id])
      .range(from, to),
  )

  if (!offerings) {
    return { error: 'Failed to load offerings for this location' }
  }

  const toUpdate = offerings

  for (const row of toUpdate) {
    const next = ((row.location_ids as string[]) ?? []).filter((lid) => lid !== id)
    const { error: upErr } = await supabase.from('offerings').update({ location_ids: next }).eq('id', row.id)
    if (upErr) {
      return { error: upErr.message }
    }
  }

  const { error: archiveError } = await supabase.from('locations').update({ is_archived: true }).eq('id', id)

  return { error: archiveError?.message ?? null }
}

/**
 * Offering counts for many locations in one pass.
 *
 * Counting per row previously cost one request per location on every load of
 * the locations list.
 */
export async function getLocationOfferingCounts(
  locationIds: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const id of locationIds) {
    counts[id] = 0
  }
  if (locationIds.length === 0) {
    return counts
  }

  // Counts what the data table lists, which leaves out offerings of an
  // archived provider or case type.
  const rows = await selectAllRows<{ location_ids: string[] | null }>((from, to) =>
    supabase
      .from('offerings')
      .select('location_ids, providers!inner(), case_types!inner()')
      .eq('is_archived', false)
      .eq('providers.is_archived', false)
      .eq('case_types.is_archived', false)
      .overlaps('location_ids', locationIds)
      .range(from, to),
  )
  if (!rows) {
    return counts
  }

  for (const row of rows) {
    // Deduped: a location listed twice on one offering must not count twice.
    for (const locationId of new Set(row.location_ids ?? [])) {
      if (locationId in counts) {
        counts[locationId] += 1
      }
    }
  }

  return counts
}
