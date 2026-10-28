export function normalizeApprovedDomain(value: unknown): string | null {
  const host = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split('/')[0]
    .split(':')[0]
  if (
    host.length > 253 ||
    !host.includes('.') ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)
  ) {
    return null
  }
  return host
}

export const MAX_APPROVED_DOMAINS = 50

/**
 * Why a one-domain-per-line list can't be saved, naming the offending lines,
 * or null when it can. The Edge Functions drop invalid entries with the same
 * rule (`_shared/origin.ts`), so the message can say removing them is safe.
 */
export function approvedDomainListProblem(text: string): string | null {
  const entries = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const invalid = entries.filter((entry) => !normalizeApprovedDomain(entry))
  if (invalid.length > 0) {
    const names = invalid.map((entry) => `"${entry}"`).join(', ')
    const verb = invalid.length === 1 ? "isn't a full domain" : "aren't full domains"
    return (
      `${names} ${verb}. Use something like example.com (no wildcards or bare suffixes). ` +
      `The live widget already ignores ${invalid.length === 1 ? 'it' : 'them'}, so removing ${invalid.length === 1 ? 'it' : 'them'} changes nothing.`
    )
  }
  const unique = new Set(entries.map((entry) => normalizeApprovedDomain(entry)))
  if (unique.size > MAX_APPROVED_DOMAINS) {
    return `Use at most ${MAX_APPROVED_DOMAINS} domains (this list has ${unique.size}).`
  }
  return null
}
