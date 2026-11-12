#!/usr/bin/env node
// Daily synthetic check that the deployed widget.js and the deployed
// track-session/widget-data edge functions still agree with each other.
//
// This exists because the widget (GitHub Pages) and the edge functions
// (Supabase, manually deployed) ship independently. Nothing forces them to
// stay in sync — a validator change on one side with no corresponding
// change on the other is exactly how the 2026-08-21 "Invalid scroll_depth"
// bug shipped silently for who-knows-how-long. This script exercises every
// payload shape widget.js actually sends, against the live production
// endpoints, and fails loudly (non-zero exit -> GitHub Actions failure ->
// email) if any of them stop agreeing.
//
// The widget_id/anon key/org used here are not secrets: the anon key and
// widget_id are already public in the <script> embed on the customer site,
// and the anon key is scoped by RLS + this function's own domain check.
// Writes use a fixed, obviously-synthetic session_id so they upsert the
// same one row every day instead of accumulating garbage, and the event
// check is tagged event_type "health_check_ping" so it's trivially
// filterable out of real analytics.

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const SUPABASE_URL = requiredEnv('WIDGET_HEALTH_SUPABASE_URL').replace(/\/$/, '')
const ANON_KEY = requiredEnv('WIDGET_HEALTH_ANON_KEY')
const WIDGET_ID = requiredEnv('WIDGET_HEALTH_WIDGET_ID')
const ORIGIN = requiredEnv('WIDGET_HEALTH_ORIGIN')
const WIDGET_JS_URL = requiredEnv('WIDGET_HEALTH_SCRIPT_URL')

const SESSION_ID = 'deadbeef-dead-4eef-8eef-deadbeefdead' // fixed synthetic canary session
let providerId = null
let sessionToken = null

const results = []

async function check(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`✅ ${name}`)
  } catch (e) {
    results.push({ name, ok: false, error: e.message })
    console.log(`❌ ${name}: ${e.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function postTrack(body) {
  body.session_token = sessionToken
  const res = await fetch(`${SUPABASE_URL}/functions/v1/track-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      Origin: ORIGIN,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* leave null, caller decides if that's fatal */
  }
  return { status: res.status, json, text }
}

// --- 1. Static asset reachable -------------------------------------------
await check('widget.js is served and looks like the real bundle', async () => {
  // A unique query string gives this request its own cache entry at the CDN.
  // This check runs on every merge to main at the same moment as the widget
  // deploy, so fetching the plain URL could reach Cloudflare before the new
  // build is published and cache the old one under the URL every customer
  // site loads -- on 2026-10-07 that held a release back for ten minutes.
  const url = new URL(WIDGET_JS_URL)
  url.searchParams.set('health-check', String(Date.now()))
  const res = await fetch(url, { cache: 'no-store' })
  assert(res.status === 200, `expected 200, got ${res.status}`)
  const text = await res.text()
  assert(text.includes('postTracking'), 'bundle is missing postTracking() -- wrong/stale build?')
})

// --- 2. widget-data contract ----------------------------------------------
await check('widget-data returns config + providers for the live widget', async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/widget-data?id=${WIDGET_ID}&session_id=${SESSION_ID}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}`, Origin: ORIGIN },
  })
  assert(res.status === 200, `expected 200, got ${res.status}`)
  const json = await res.json()
  assert(json.config?.widget_id === WIDGET_ID, 'response config.widget_id does not match')
  assert(Array.isArray(json.providers), 'response is missing providers[]')
  providerId = json.providers[0]?.id ?? null
  sessionToken = json.config?.session_token ?? null
  assert(providerId, 'response has no provider to use for relationship validation')
  assert(sessionToken, 'response is missing a signed session token')
})

// --- 3. CORS preflight still matches what the widget requests -------------
await check('track-session OPTIONS preflight succeeds', async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/track-session`, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'apikey,authorization,content-type',
    },
  })
  assert(res.status === 200, `expected 200, got ${res.status}`)
  assert(res.headers.get('access-control-allow-origin'), 'missing access-control-allow-origin')
})

// --- 4. Full session upsert (trackSession shape) ---------------------------
await check('track-session accepts a full session upsert payload', async () => {
  const { status, json } = await postTrack({
    type: 'session',
    widget_id: WIDGET_ID,
    session_id: SESSION_ID,
    case_type_id: null,
    results_count: 1,
    providers_shown: [providerId],
    zero_results: false,
    results_positions: [{ provider_id: providerId, position: 0 }],
    scroll_depth: null,
  })
  assert(status === 200 && json?.ok === true, `expected 200 {ok:true}, got ${status} ${JSON.stringify(json)}`)
})

// --- 5. Scroll event -- the exact shape that regressed on 2026-08-21 -------
await check('track-session accepts the real scroll_depth object shape', async () => {
  const { status, json } = await postTrack({
    widget_id: WIDGET_ID,
    session_id: SESSION_ID,
    type: 'scroll',
    scroll_depth: { max_position_seen: 3, time_in_results_ms: 4200 },
  })
  assert(status === 200 && json?.ok === true, `expected 200 {ok:true}, got ${status} ${JSON.stringify(json)}`)
})

// --- 6. Click event ----------------------------------------------------
await check('track-session accepts a click payload', async () => {
  const { status, json } = await postTrack({
    widget_id: WIDGET_ID,
    session_id: SESSION_ID,
    type: 'click',
    provider_id: providerId,
    position_at_click: 0,
    click_order: 1,
  })
  assert(status === 200 && json?.ok === true, `expected 200 {ok:true}, got ${status} ${JSON.stringify(json)}`)
})

await check('track-session rejects a provider outside the published widget', async () => {
  const { status } = await postTrack({
    widget_id: WIDGET_ID,
    session_id: SESSION_ID,
    type: 'click',
    provider_id: 'deadbeef-beef-4eef-8eef-beefdeadbeef',
    position_at_click: 0,
    click_order: 2,
  })
  assert(status === 400, `expected 400, got ${status}`)
})

// --- 7. Generic event ----------------------------------------------------
await check('track-session accepts an event payload', async () => {
  const { status, json } = await postTrack({
    widget_id: WIDGET_ID,
    session_id: SESSION_ID,
    type: 'event',
    event_type: 'health_check_ping',
    step_index: null,
    question_id: null,
  })
  assert(status === 200 && json?.ok === true, `expected 200 {ok:true}, got ${status} ${JSON.stringify(json)}`)
})

// --- 8. Validation hasn't gone slack: bad input must still 400 -----------
await check('track-session still rejects a malformed scroll_depth', async () => {
  const { status, json } = await postTrack({
    widget_id: WIDGET_ID,
    session_id: SESSION_ID,
    type: 'scroll',
    scroll_depth: 50, // the old (wrong) shape -- must be rejected, not silently accepted
  })
  assert(status === 400, `expected 400, got ${status} ${JSON.stringify(json)}`)
})

await check('track-session still rejects a missing widget_id', async () => {
  const { status } = await postTrack({ type: 'event', event_type: 'health_check_ping' })
  assert(status === 400, `expected 400, got ${status}`)
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  console.log('\nFailures:')
  for (const f of failed) console.log(`  - ${f.name}: ${f.error}`)
  process.exit(1)
}
