#!/usr/bin/env node
// Fails (-> GitHub Actions failure -> email) when the telemetry-retention cron
// job is missing, inactive, or has not succeeded recently. See
// docs/production-readiness.md: the job is meant to run daily, and the runbook
// says to alert after 26 hours without a success.
//
// Reads public.prune_job_health(), which exposes only job metadata, so the anon
// key is enough. Reuses the widget health check's project URL and key.

const MAX_AGE_HOURS = 26

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const url = requiredEnv('WIDGET_HEALTH_SUPABASE_URL').replace(/\/$/, '')
const key = requiredEnv('WIDGET_HEALTH_ANON_KEY')

const res = await fetch(`${url}/rest/v1/rpc/prune_job_health`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
  body: '{}',
})
if (!res.ok) {
  console.error(`prune_job_health RPC failed: HTTP ${res.status} ${await res.text()}`)
  process.exit(1)
}

const health = await res.json()
console.log(JSON.stringify(health))

const problems = []
if (!health.job_exists) problems.push('retention job is not scheduled')
else if (!health.active) problems.push('retention job is inactive')

if (health.job_exists) {
  if (!health.last_success_at) {
    problems.push('retention job has never succeeded')
  } else {
    const hours = (Date.now() - new Date(health.last_success_at).getTime()) / 3_600_000
    if (hours > MAX_AGE_HOURS) {
      problems.push(`last success was ${hours.toFixed(1)}h ago (limit ${MAX_AGE_HOURS}h); last status: ${health.last_status}`)
    }
  }
}

if (problems.length > 0) {
  problems.forEach((p) => console.error(`ERROR: ${p}`))
  process.exit(1)
}
console.log('Telemetry retention job is healthy')
