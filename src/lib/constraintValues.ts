import type { Constraint } from '../types/database'

/**
 * An offering's constraint values as they should be stored. The offering form's
 * number boxes hand back text, so ages were saved as "16" and "200" beside the
 * numbers the data table and the import save. The widget converts them, so
 * nothing broke, but one list held two kinds of value.
 *
 * Range values become numbers. A cleared range box is dropped rather than kept
 * as "": the matcher reads a missing maximum as unlimited, but "" as 0, which
 * would match no one. Anything that is not a plain number is left as it is.
 */
export function coerceRangeValues(
  values: Record<string, unknown>,
  constraints: Pick<Constraint, 'type' | 'mapped_key' | 'secondary_mapped_key'>[],
): Record<string, unknown> {
  const next = { ...values }
  for (const constraint of constraints) {
    if (constraint.type !== 'range') continue
    for (const key of [constraint.mapped_key, constraint.secondary_mapped_key]) {
      if (!key || typeof next[key] !== 'string') continue
      const text = (next[key] as string).trim()
      if (text === '') {
        delete next[key]
      } else if (/^-?\d+(\.\d+)?$/.test(text)) {
        next[key] = Number(text)
      }
    }
  }
  return next
}
