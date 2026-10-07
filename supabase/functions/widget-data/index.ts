import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3'
import { corsHeaders, isHostAllowed, requestHost } from '../_shared/origin.ts'
import { clientKey, isUuid, rateLimit } from '../_shared/guard.ts'
import { issueSessionToken } from '../_shared/session-token.ts'

// Keep in sync with the widget's fetch: it sends only Content-Type and
// Authorization, and adding to this list has previously broken preflight.
const ALLOW_HEADERS = 'Content-Type, Authorization'

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function safePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/[^0-9+]/g, '')
  return /^\+?[0-9]{7,20}$/.test(normalized) ? normalized : null
}

serve(async (req) => {
  // Preflight leaks nothing, so answer it permissively; the domain list is
  // enforced on the actual GET, once we know which org the widget belongs to.
  const cors = corsHeaders(req, ALLOW_HEADERS, false)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (!rateLimit(`widget-data:${clientKey(req)}`, 120, 60_000)) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '60' },
      })
    }

    const url = new URL(req.url)
    const widgetId = url.searchParams.get('id')
    const sessionId = url.searchParams.get('session_id')
    if (!isUuid(widgetId)) {
      return new Response(JSON.stringify({ error: 'Missing widget id' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    if (sessionId !== null && !isUuid(sessionId)) {
      return new Response(JSON.stringify({ error: 'Invalid session id' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      (Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
    )

    const { data: widget, error: widgetError } = await supabase
      .from('widgets')
      .select('id,org_id,status,primary_color,button_text,greeting_text,disclaimer_text,privacy_url,fallback_message,embed_mode,show_worth_the_drive,question_order,published_snapshot,open_delay_enabled,open_delay_seconds,button_animation,button_subtext,button_icon_type,button_icon_value')
      .eq('id', widgetId)
      .eq('status', 'live')
      .single()

    if (widgetError || !widget) {
      return new Response(JSON.stringify({ error: 'Widget not found or not published' }), {
        status: 404,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const privacyUrl = safeHttpsUrl(widget.privacy_url)
    if (!widget.disclaimer_text?.trim() || !privacyUrl) {
      return new Response(JSON.stringify({ error: 'Widget privacy configuration is incomplete' }), {
        status: 503,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const orgId = widget.org_id as string
    const snapshot = (widget.published_snapshot ?? {}) as Record<string, unknown>
    const scopedProviderIds = Array.isArray(snapshot.scoped_provider_ids) &&
        (snapshot.scoped_provider_ids as string[]).length
      ? (snapshot.scoped_provider_ids as string[])
      : null
    const scopedCaseTypeIds = Array.isArray(snapshot.scoped_case_type_ids) &&
        (snapshot.scoped_case_type_ids as string[]).length
      ? (snapshot.scoped_case_type_ids as string[])
      : null
    const scopedLocationIds = Array.isArray(snapshot.scoped_location_ids) &&
        (snapshot.scoped_location_ids as string[]).length
      ? (snapshot.scoped_location_ids as string[])
      : null
    const questionOrder = (widget.question_order ?? []) as string[]
    const scopedQuestionIds = Array.isArray(snapshot.scoped_question_ids) &&
        (snapshot.scoped_question_ids as string[]).length
      ? (snapshot.scoped_question_ids as string[])
      : null

    const orgQuery = Promise.resolve(
      supabase
        .from('organizations')
        .select('fallback_phone,fallback_message,allowed_domains,default_booking_mode,default_phone_mode')
        .eq('id', orgId)
        .single()
    )

    const results = await Promise.all([
      orgQuery,
      // This endpoint is public. Keep these projections deliberately narrow so
      // adding an admin-only column to a table can never publish it by accident.
      supabase
        .from('providers')
        .select('id,name,subtitle,bio_link,image_url,category_ids,booking_mode,phone_mode')
        .eq('org_id', orgId)
        .eq('is_archived', false),
      supabase
        .from('offerings')
        .select('id,provider_id,case_type_id,location_ids,constraints')
        .eq('org_id', orgId)
        .eq('is_archived', false),
      supabase
        .from('case_types')
        .select('id,name,sort_order,map_tag')
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .order('name'),
      supabase
        .from('categories')
        .select('id,name,sort_order')
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .order('name'),
      supabase
        .from('locations')
        .select('id,name,address,directions_url,sort_order')
        .eq('org_id', orgId)
        .eq('is_archived', false),
      supabase
        .from('constraints')
        .select('id,name,type,mapped_key,secondary_mapped_key,min_allowed_value,max_allowed_value,yes_label,no_label,yes_maps_to,no_maps_to,sort_order')
        .eq('org_id', orgId)
        .eq('is_archived', false),
      supabase
        .from('questions')
        .select('id,question_text,subtext,question_type,input_type,constraint_id,required,order_rank,system_config')
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .order('order_rank'),
    ])

    for (const result of results) {
      if (result.error) throw new Error(result.error.message)
    }

    const [
      { data: org },
      { data: allProviders },
      { data: allOfferings },
      { data: caseTypes },
      { data: categories },
      { data: locations },
      { data: constraints },
      { data: allQuestions },
    ] = results

    // Enforce the org's domain list here, not just in the widget. The
    // client-side check in widget.js runs after the payload has already been
    // delivered, so on its own it hides the UI without protecting the data.
    const host = requestHost(req)
    const locked = Array.isArray(org?.allowed_domains) && org.allowed_domains.length > 0
    if (!isHostAllowed(host, org?.allowed_domains)) {
      return new Response(JSON.stringify({ error: 'Domain not authorized' }), {
        status: 403,
        headers: { ...corsHeaders(req, ALLOW_HEADERS, true), 'Content-Type': 'application/json' },
      })
    }

    let sessionToken: string | null = null
    if (sessionId) {
      const sessionSecret = Deno.env.get('WIDGET_SESSION_SECRET')
      if (!sessionSecret || sessionSecret.length < 32) {
        throw new Error('WIDGET_SESSION_SECRET must contain at least 32 characters')
      }
      sessionToken = await issueSessionToken(sessionSecret, widgetId, sessionId)
    }

    const providers = (scopedProviderIds
      ? (allProviders ?? []).filter((p) => scopedProviderIds.includes(p.id))
      : (allProviders ?? [])).map((provider) => ({
        ...provider,
        bio_link: safeHttpsUrl(provider.bio_link),
        image_url: safeHttpsUrl(provider.image_url),
      }))
    const filteredCaseTypes = scopedCaseTypeIds
      ? (caseTypes ?? []).filter((ct) => scopedCaseTypeIds.includes(ct.id))
      : (caseTypes ?? [])
    const filteredLocations = scopedLocationIds
      ? (locations ?? []).filter((l) => scopedLocationIds.includes(l.id))
      : (locations ?? [])
    const providerIds = providers.map((p) => p.id)
    const caseTypeIds = filteredCaseTypes.map((ct) => ct.id)
    const offerings = (allOfferings ?? []).filter(
      (o) => providerIds.includes(o.provider_id) && caseTypeIds.includes(o.case_type_id),
    )

    let questions = scopedQuestionIds
      ? (allQuestions ?? []).filter((q) => scopedQuestionIds.includes(q.id))
      : (allQuestions ?? [])

    if (questionOrder.length > 0) {
      const ordered: typeof questions = []
      for (const qId of questionOrder) {
        const found = questions.find((qq) => qq.id === qId)
        if (found) ordered.push(found)
      }
      const entryQ = questions.find((qq) => qq.question_type === 'entry')
      if (entryQ && !ordered.some((qq) => qq.question_type === 'entry')) {
        ordered.unshift(entryQ)
      }
      questions = ordered
    }

    let providerLocations: Record<string, unknown>[] = []
    if (providerIds.length > 0 && filteredLocations.length > 0) {
      const providerLocationsResult = await supabase
        .from('provider_locations')
        .select('provider_id,location_id,booking_link,phone,bio_link')
        .in('provider_id', providerIds)
        .in('location_id', filteredLocations.map((location) => location.id))
      if (providerLocationsResult.error) throw new Error(providerLocationsResult.error.message)
      providerLocations = (providerLocationsResult.data ?? []).map((providerLocation) => ({
        ...providerLocation,
        booking_link: safeHttpsUrl(providerLocation.booking_link),
        bio_link: safeHttpsUrl(providerLocation.bio_link),
        phone: safePhone(providerLocation.phone),
      }))
    }

    return new Response(
      JSON.stringify({
        config: {
          widget_id: widgetId,
          session_token: sessionToken,
          org_id: orgId,
          primary_color: widget.primary_color,
          button_text: widget.button_text,
          greeting_text: widget.greeting_text,
          disclaimer_text: widget.disclaimer_text,
          privacy_url: privacyUrl,
          fallback_message: widget.fallback_message || org?.fallback_message,
          fallback_phone: safePhone(org?.fallback_phone),
          allowed_domains: org?.allowed_domains || [],
          embed_mode: widget.embed_mode,
          show_worth_the_drive: widget.show_worth_the_drive,
          default_booking_mode: org?.default_booking_mode || 'simple',
          default_phone_mode: org?.default_phone_mode || 'simple',
          open_delay_enabled: widget.open_delay_enabled,
          open_delay_seconds: widget.open_delay_seconds,
          button_animation: widget.button_animation,
          button_subtext: widget.button_subtext,
          button_icon_type: widget.button_icon_type,
          button_icon_value: widget.button_icon_type === 'image'
            ? safeHttpsUrl(widget.button_icon_value)
            : widget.button_icon_value,
        },
        providers,
        offerings,
        caseTypes: filteredCaseTypes,
        categories: categories ?? [],
        locations: filteredLocations.map((location) => ({
          ...location,
          directions_url: safeHttpsUrl(location.directions_url),
        })),
        constraints: constraints ?? [],
        questions,
        providerLocations,
      }),
      {
        headers: {
          ...corsHeaders(req, ALLOW_HEADERS, locked),
          'Content-Type': 'application/json',
          'Cache-Control': sessionToken ? 'private, no-store' : 'public, max-age=60',
        },
      },
    )
  } catch (e) {
    // Log the detail, return a generic message: this endpoint is public and
    // internal errors can name tables and columns.
    console.error('widget-data failed', e)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
