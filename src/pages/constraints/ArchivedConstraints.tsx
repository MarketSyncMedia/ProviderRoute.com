import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ArchivedList from '../../components/shared/ArchivedList'
import { useToast } from '../../components/ui/toastStore'
import { getArchivedConstraints, restoreConstraint } from '../../lib/api/constraints'
import { useAuthStore } from '../../stores/authStore'
import type { Constraint } from '../../types/database'

/** Constraints archived from the list, each restorable as they were. */
export default function ArchivedConstraints() {
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [restoring, setRestoring] = useState<string | null>(null)

  // Nested under the plain list's key so the page's
  // invalidateQueries(['constraints', orgId]) after an archive refreshes it.
  const { data: archived = [] } = useQuery({
    queryKey: ['constraints', orgId, 'archived'],
    queryFn: () => getArchivedConstraints(orgId),
    enabled: Boolean(orgId),
  })

  async function restore(constraint: Constraint) {
    setRestoring(constraint.id)
    const { error } = await restoreConstraint(constraint.id)
    setRestoring(null)
    if (error) {
      toast.error(error)
      return
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['constraints-with-counts', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['constraints', orgId] }),
    ])
    toast.success(`${constraint.name} restored`)
  }

  return (
    <ArchivedList
      label="constraints"
      items={archived}
      nameOf={(constraint) => constraint.name}
      restoringId={restoring}
      onRestore={(constraint) => void restore(constraint)}
    />
  )
}
