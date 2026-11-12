/**
 * "Simple" booking and phone modes mean one link / one number for every
 * location a provider covers. The values are stored per location (so switching
 * a provider to "advanced" keeps what was there), which means they can
 * disagree -- after the account's default mode is flipped, or a location was
 * added later. This is the single rule for which value then stands for all of
 * them, used by both the provider page (what it shows and saves) and the widget
 * (what a patient is sent to), so the two can never pick differently: the
 * first non-empty value, taking locations in id order.
 */

export interface LocationValue {
  locationId: string
  value: string | null | undefined
}

export function sharedLocationValue(entries: readonly LocationValue[]): string {
  const sorted = [...entries].sort((a, b) => (a.locationId < b.locationId ? -1 : a.locationId > b.locationId ? 1 : 0))
  for (const { value } of sorted) {
    const text = (value ?? '').trim()
    if (text) return text
  }
  return ''
}

/** True when two locations hold different non-empty values, so one has to win. */
export function locationValuesDisagree(entries: readonly LocationValue[]): boolean {
  const seen = new Set<string>()
  for (const { value } of entries) {
    const text = (value ?? '').trim()
    if (text) seen.add(text)
  }
  return seen.size > 1
}
