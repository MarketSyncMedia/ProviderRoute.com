import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ArchivedList from '../../components/shared/ArchivedList'
import { useToast } from '../../components/ui/toastStore'
import { getArchivedProviders, restoreProvider } from '../../lib/api/providers'
import { invalidateOfferingReaders } from '../../lib/invalidateOfferingReaders'
import { useAuthStore } from '../../stores/authStore'
import type { Provider } from '../../types/database'

/** Providers archived from their profile, each restorable as they were. */
export default function ArchivedProviders() {
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [restoring, setRestoring] = useState<string | null>(null)

  // Nested under the plain list's key so every existing
  // invalidateQueries(['providers', orgId]) also refreshes this one.
  const { data: archived = [] } = useQuery({
    queryKey: ['providers', orgId, 'archived'],
    queryFn: () => getArchivedProviders(orgId),
    enabled: Boolean(orgId),
  })

  async function restore(provider: Provider) {
    setRestoring(provider.id)
    const { error } = await restoreProvider(provider.id)
    setRestoring(null)
    if (error) {
      toast.error(error)
      return
    }
    // Their offerings come back to the data table and every count too.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['providers', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['provider'] }),
      invalidateOfferingReaders(queryClient, orgId),
    ])
    toast.success(`${provider.name} restored`)
  }

  return (
    <ArchivedList
      label="providers"
      items={archived}
      nameOf={(provider) => provider.name}
      restoringId={restoring}
      onRestore={(provider) => void restore(provider)}
    />
  )
}
