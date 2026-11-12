import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveRestore, ChevronDown, ChevronRight } from 'lucide-react'
import { useToast } from '../../components/ui/toastStore'
import { getArchivedCaseTypes, restoreCaseType } from '../../lib/api/caseTypes'
import { invalidateOfferingReaders } from '../../lib/invalidateOfferingReaders'
import { bodyMapSpot } from '../../shared/bodyMap'
import { useAuthStore } from '../../stores/authStore'
import type { CaseType } from '../../types/database'
import { useInvalidateCaseTypes } from './useInvalidateCaseTypes'

/** Case types archived for all providers, each restorable as it was. */
export default function ArchivedCaseTypes() {
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const { toast } = useToast()
  const invalidate = useInvalidateCaseTypes()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)

  // Nested under the plain list's key so the list page's
  // invalidateQueries(['case-types', orgId]) after an archive refreshes it.
  const { data: archived = [] } = useQuery({
    queryKey: ['case-types', orgId, 'archived'],
    queryFn: () => getArchivedCaseTypes(orgId),
    enabled: Boolean(orgId),
  })

  if (archived.length === 0) return null

  async function restore(caseType: CaseType) {
    setRestoring(caseType.id)
    const { error, lostSpot } = await restoreCaseType(caseType)
    setRestoring(null)
    if (error) {
      toast.error(error)
      return
    }
    // Its offerings come back on the data table and provider pages too.
    await Promise.all([invalidate(), invalidateOfferingReaders(queryClient, orgId)])
    if (lostSpot) {
      toast.warning(
        `${caseType.name} restored. Its body map spot (${bodyMapSpot(caseType.map_tag)?.label}) is now used by another case type, so it was left off the map.`,
      )
    } else {
      toast.success(`${caseType.name} restored`)
    }
  }

  return (
    <section className="mt-8">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Archived case types ({archived.length})
      </button>
      {open ? (
        <ul className="mt-3 space-y-2">
          {archived.map((ct) => (
            <li
              key={ct.id}
              className="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5"
            >
              <span className="flex-1 text-sm text-slate-600">{ct.name}</span>
              <button
                type="button"
                aria-label={`Restore ${ct.name}`}
                disabled={restoring !== null}
                onClick={() => void restore(ct)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
                {restoring === ct.id ? 'Restoring…' : 'Restore'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
