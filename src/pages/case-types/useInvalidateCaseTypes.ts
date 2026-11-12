import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../../stores/authStore'

/**
 * Refresh the case types page and every reader of the plain list. The
 * archived list is nested under ['case-types', orgId], so it refreshes too.
 */
export function useInvalidateCaseTypes() {
  const queryClient = useQueryClient()
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['case-types-with-counts', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['case-types', orgId] }),
    ])
}
