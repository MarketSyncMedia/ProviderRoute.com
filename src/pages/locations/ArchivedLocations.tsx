import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ArchivedList from '../../components/shared/ArchivedList'
import { useToast } from '../../components/ui/toastStore'
import { getArchivedLocations, restoreLocation } from '../../lib/api/locations'
import { invalidateOfferingReaders } from '../../lib/invalidateOfferingReaders'
import { useAuthStore } from '../../stores/authStore'
import type { Location } from '../../types/database'

/**
 * Locations archived from the list. Archiving leaves offerings and booking
 * details as they were, so restoring one brings every offering back there.
 */
export default function ArchivedLocations() {
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [restoring, setRestoring] = useState<string | null>(null)

  // Nested under the plain list's key so the page's
  // invalidateQueries(['locations', orgId]) after an archive refreshes it.
  const { data: archived = [] } = useQuery({
    queryKey: ['locations', orgId, 'archived'],
    queryFn: () => getArchivedLocations(orgId),
    enabled: Boolean(orgId),
  })

  async function restore(location: Location) {
    setRestoring(location.id)
    const { error } = await restoreLocation(location.id)
    setRestoring(null)
    if (error) {
      toast.error(error)
      return
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['locations-with-counts', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['locations', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['provider-locations'] }),
      invalidateOfferingReaders(queryClient, orgId),
    ])
    toast.success(`${location.name} restored`)
  }

  return (
    <ArchivedList
      label="locations"
      items={archived}
      nameOf={(location) => location.name}
      restoringId={restoring}
      onRestore={(location) => void restore(location)}
    />
  )
}
