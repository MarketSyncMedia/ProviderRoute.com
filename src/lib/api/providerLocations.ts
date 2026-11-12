import { supabase } from '../supabase'
import type { ProviderLocation } from '../../types/database'

export async function getProviderLocations(providerId: string): Promise<ProviderLocation[]> {
  const { data, error } = await supabase
    .from('provider_locations')
    .select('*')
    .eq('provider_id', providerId)

  if (error || !data) {
    return []
  }

  return data as ProviderLocation[]
}

export async function upsertProviderLocation(
  providerId: string,
  locationId: string,
  bookingLink: string | null,
  phone: string | null,
  // Left out, the stored self-scheduling link is untouched.
  selfScheduleLink?: string | null
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('provider_locations').upsert(
    {
      provider_id: providerId,
      location_id: locationId,
      booking_link: bookingLink,
      phone: phone,
      ...(selfScheduleLink === undefined ? {} : { self_schedule_link: selfScheduleLink }),
    },
    { onConflict: 'provider_id,location_id' }
  )
  return { error: error?.message ?? null }
}

export async function deleteProviderLocation(
  providerId: string,
  locationId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('provider_locations')
    .delete()
    .eq('provider_id', providerId)
    .eq('location_id', locationId)

  return { error: error?.message ?? null }
}

export async function applyBookingLinkToAll(
  providerId: string,
  bookingLink: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('provider_locations')
    .update({ booking_link: bookingLink })
    .eq('provider_id', providerId)

  return { error: error?.message ?? null }
}
