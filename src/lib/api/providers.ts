import { supabase } from '../supabase'
import { validateImageUpload } from '../imageUpload'
import type { Provider } from '../../types/database'
import { normalizeName } from '../parsers/nameNormalizer'

export async function getProviders(orgId: string): Promise<Provider[]> {
  const { data, error } = await supabase
    .from('providers')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_archived', false)
    .order('name', { ascending: true })

  if (error || !data) {
    return []
  }

  return data as Provider[]
}

export async function getProvider(id: string): Promise<Provider | null> {
  const { data, error } = await supabase.from('providers').select('*').eq('id', id).maybeSingle()

  if (error || !data) {
    return null
  }

  return data as Provider
}

export async function createProvider(data: {
  org_id: string
  name: string
  subtitle?: string
  npi?: string
  email?: string
  bio_link?: string
}): Promise<{ data: Provider | null; error: string | null }> {
  const { data: inserted, error } = await supabase
    .from('providers')
    .insert({
      org_id: data.org_id,
      name: data.name,
      normalized_name: normalizeName(data.name),
      subtitle: data.subtitle ?? null,
      npi: data.npi ?? null,
      email: data.email ?? null,
      bio_link: data.bio_link ?? null,
      category_ids: [],
    })
    .select()
    .single()

  if (error || !inserted) {
    return { data: null, error: error?.message ?? 'Failed to create provider' }
  }

  return { data: inserted as Provider, error: null }
}

export async function updateProvider(
  id: string,
  updates: Partial<Provider>
): Promise<{ error: string | null }> {
  const payload: Partial<Provider> = { ...updates }
  if (updates.name) {
    payload.normalized_name = normalizeName(updates.name)
  }

  const { error } = await supabase.from('providers').update(payload).eq('id', id)
  return { error: error?.message ?? null }
}

export async function archiveProvider(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('providers').update({ is_archived: true }).eq('id', id)
  return { error: error?.message ?? null }
}

export async function getArchivedProviders(orgId: string): Promise<Provider[]> {
  const { data, error } = await supabase
    .from('providers')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_archived', true)
    .order('name', { ascending: true })

  if (error || !data) {
    return []
  }

  return data as Provider[]
}

/** Brings a provider back with everything that was kept when they were archived. */
export async function restoreProvider(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('providers').update({ is_archived: false }).eq('id', id)
  return { error: error?.message ?? null }
}

export async function uploadProviderImage(
  providerId: string,
  orgId: string,
  file: File
): Promise<{ url: string | null; error: string | null }> {
  const validationError = validateImageUpload(file)
  if (validationError) return { url: null, error: validationError }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const path = `${orgId}/${providerId}.${extension}`

  const { error: uploadError } = await supabase.storage
    .from('provider-images')
    .upload(path, file, { upsert: true })

  if (uploadError) {
    return { url: null, error: uploadError.message }
  }

  const { data: publicData } = supabase.storage.from('provider-images').getPublicUrl(path)
  const publicUrl = publicData.publicUrl

  const { error: updateError } = await supabase
    .from('providers')
    .update({ image_url: publicUrl })
    .eq('id', providerId)

  if (updateError) {
    return { url: null, error: updateError.message }
  }

  return { url: publicUrl, error: null }
}

export async function removeProviderImage(
  providerId: string,
  currentImageUrl: string
): Promise<{ error: string | null }> {
  // Clearing image_url is what actually matters to the user — try to clean up
  // the stored file too, but a storage failure shouldn't block that.
  try {
    const path = decodeURIComponent(new URL(currentImageUrl).pathname).split('/provider-images/')[1]
    if (path) {
      await supabase.storage.from('provider-images').remove([path])
    }
  } catch {
    /* best-effort cleanup only */
  }

  const { error } = await supabase.from('providers').update({ image_url: null }).eq('id', providerId)
  return { error: error?.message ?? null }
}
