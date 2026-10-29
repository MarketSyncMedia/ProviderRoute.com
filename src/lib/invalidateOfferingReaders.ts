import type { QueryClient } from '@tanstack/react-query'

/**
 * Refresh every cached view that lists or counts offerings. Archiving or
 * restoring an offering, a provider or a case type changes which offerings
 * are live, and each of these pages caches its own copy, so refreshing only
 * the page the admin is on left the others showing the old rows (with
 * "Unknown" for an archived case type) for up to the 5 minute stale time.
 */
export function invalidateOfferingReaders(queryClient: QueryClient, orgId: string) {
  const keys = [
    ['data-table-offerings', orgId],
    ['provider-offerings'],
    ['case-type-providers'],
    ['case-types-with-counts', orgId],
    ['categories-with-counts', orgId],
    ['locations-with-counts', orgId],
    ['dashboard', orgId],
  ]
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}
