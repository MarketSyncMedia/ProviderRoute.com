import type { Constraint } from '../types/database'

/**
 * One line describing an offering's constraint values in the admin's own
 * wording ("Age Range: 12–85, Sports Only"), wherever offerings are listed.
 * Reads the org's live constraints rather than the stored keys, so a binary
 * left off and anything belonging to an archived constraint are not shown.
 */
export function constraintSummary(raw: unknown, constraints: Constraint[]): string {
  const values = (raw ?? {}) as Record<string, unknown>
  const parts: string[] = []
  for (const c of constraints) {
    const v = values[c.mapped_key]
    if (v === undefined || v === null || v === '') continue
    if (c.type === 'binary') {
      if (v === 1 || v === '1' || v === true) parts.push(c.name)
      continue
    }
    const secondary = c.secondary_mapped_key ? values[c.secondary_mapped_key] : undefined
    const hasSecondary = secondary !== undefined && secondary !== null && secondary !== ''
    parts.push(`${c.name}: ${String(v)}${hasSecondary ? `–${String(secondary)}` : ''}`)
  }
  return parts.join(', ')
}
