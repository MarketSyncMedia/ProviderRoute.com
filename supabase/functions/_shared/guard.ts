/**
 * Abuse guards for the public (unauthenticated) widget endpoints.
 *
 * These endpoints run with the service role key and accept traffic from any
 * visitor on a customer's site, so anything reaching the database has to be
 * bounded first: request rate, body size, and the shape/length of every field
 * we persist.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** Max bytes we will read from a request body. */
export const MAX_BODY_BYTES = 16 * 1024

/** Caps on anything we write, so a single session can't grow without bound. */
export const LIMITS = {
  textField: 2_000,
  arrayItems: 200,
  clicksDetail: 500,
  answerKeys: 100,
} as const

/** Truncate to a string of at most `max` chars, or null if not a usable string. */
export function boundedText(value: unknown, max: number = LIMITS.textField): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

/** Keep only valid UUIDs, deduped, up to `max` entries. */
export function boundedUuidArray(value: unknown, max: number = LIMITS.arrayItems): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const item of value) {
    if (seen.size >= max) break
    if (isUuid(item)) seen.add(item)
  }
  return [...seen]
}

/** Finite integer within [min, max], else null. */
export function boundedInt(value: unknown, min: number, max: number): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/**
 * Bound a free-form answers object: cap key count, and cap each value's size.
 * Values stay as-is structurally (the matcher reads strings/numbers/booleans);
 * anything larger or nested is stringified and truncated rather than dropped,
 * so analytics stay readable.
 */
export function boundedAnswers(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= LIMITS.answerKeys) break
    const k = key.slice(0, 200)
    if (raw === null || typeof raw === 'number' || typeof raw === 'boolean') {
      out[k] = raw
    } else if (typeof raw === 'string') {
      out[k] = raw.slice(0, LIMITS.textField)
    } else {
      out[k] = JSON.stringify(raw)?.slice(0, LIMITS.textField) ?? null
    }
  }
  return out
}

/** Read and parse a JSON body, refusing anything over MAX_BODY_BYTES. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null

  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) return null
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Best-effort per-caller rate limit.
 *
 * In-memory, so it is per isolate rather than global — it will not stop a
 * distributed flood, but it does stop the trivial single-source case (scripted
 * click inflation against the booking-fairness ranking, or bulk event inserts).
 */
const buckets = new Map<string, number[]>()

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const cutoff = now - windowMs
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff)

  if (buckets.size > 10_000) buckets.clear() // bound our own memory

  if (hits.length >= limit) {
    buckets.set(key, hits)
    return false
  }
  hits.push(now)
  buckets.set(key, hits)
  return true
}

/**
 * Caller identity for rate limiting: the real client IP.
 *
 * Prefer headers the fronting proxy sets and overwrites on every request
 * (`cf-connecting-ip`, then `x-real-ip`) over `x-forwarded-for`, whose leftmost
 * entry is supplied by the caller and so can be rotated to defeat the limit.
 * X-Forwarded-For is only a last resort, and then its *last* hop -- the address
 * the trusted proxy appended -- is used, not the client-controlled first one.
 */
export function clientKey(req: Request): string {
  const trusted = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip')
  if (trusted) return trusted.trim()

  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const hops = fwd.split(',').map((h) => h.trim()).filter(Boolean)
    if (hops.length > 0) return hops[hops.length - 1]
  }
  return 'unknown'
}
