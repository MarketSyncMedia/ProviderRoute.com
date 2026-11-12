#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const widgetData = readFileSync('supabase/functions/widget-data/index.ts', 'utf8')
const tracking = readFileSync('supabase/functions/track-session/index.ts', 'utf8')
const widget = readFileSync('widget/src/widget.js', 'utf8')
const widgetBuild = readFileSync('widget/build.js', 'utf8')
const originGuards = readFileSync('supabase/functions/_shared/origin.ts', 'utf8')
const invitations = readFileSync('supabase/functions/invite-member/index.ts', 'utf8')
const failures = []

if (/\.select\(\s*['"]\*['"]\s*\)/.test(widgetData)) {
  failures.push('widget-data must never use select("*") on its public response path')
}
if (!widgetData.includes('safeHttpsUrl')) {
  failures.push('widget-data must sanitize public web URLs')
}
if (!widgetData.includes('Widget privacy configuration is incomplete') || !widget.includes('appendPrivacyNotice')) {
  failures.push('the public widget must fail closed and render its approved privacy notice before interaction')
}
if (!tracking.includes("widget.status !== 'live'")) {
  failures.push('track-session must reject non-live widgets')
}
if (!tracking.includes('EVENT_TYPES.has(eventType)')) {
  failures.push('track-session must enforce the event-type allowlist')
}
if (!tracking.includes('validateEntityIds')) {
  failures.push('track-session must validate submitted relationship ids')
}
if (widget.includes('answers: this.state.answers')) {
  failures.push('the public widget must not transmit the full clinical answer vector')
}
if (widget.includes('question_text: questionText') || widget.includes('answer_text: answerText')) {
  failures.push('the public widget must not duplicate readable question/answer text into events')
}
if (!tracking.includes('question_text: null') || !tracking.includes('answers: {}')) {
  failures.push('track-session must minimize stored answer and event payloads')
}
if (!widgetData.includes('issueSessionToken') || !tracking.includes('verifySessionToken')) {
  failures.push('public tracking must require a short-lived signed widget session')
}
if (!tracking.includes("body.type !== 'session'")) {
  failures.push('track-session must reject unknown payload types')
}
if (!originGuards.includes('if (list.length === 0) return false')) {
  failures.push('public domain authorization must fail closed')
}
if (/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/.test(widget)) {
  failures.push('the widget source must not contain a hardcoded project JWT')
}
if (/[a-z0-9]{20}\.supabase\.co/i.test(widgetBuild)) {
  failures.push('the widget build must not contain a hardcoded Supabase project')
}
if (!invitations.includes("actor.role !== 'owner'") || !invitations.includes('auth.admin.inviteUserByEmail')) {
  failures.push('member invitations must verify an owner before using the Auth admin API')
}
if (!invitations.includes('const actorClient') || !invitations.includes('await actorClient')) {
  failures.push('invitation database writes must run under caller RLS for attributable audit records')
}
// Every whole-org read on the public widget must page past PostgREST's row cap;
// an unpaged one silently shows patients a truncated provider list. Only the
// single-row widget and organization lookups are exempt.
for (const segment of widgetData.split('.from(').slice(1)) {
  const table = segment.match(/^\s*['"]([a-z_]+)['"]/)?.[1]
  if (!table || table === 'widgets' || table === 'organizations') continue
  // Each segment runs up to the next `.from(`, so it holds exactly one query.
  if (!segment.includes('.range(from, to)')) {
    failures.push(`widget-data must page its ${table} read with selectAllRows`)
  }
}
if (/supabase-js@2['"]/.test(widgetData + tracking)) {
  failures.push('Edge Function dependencies must use an exact version')
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`ERROR: ${failure}`)
  process.exit(1)
}

console.log('Public Edge Function safety invariants passed')
