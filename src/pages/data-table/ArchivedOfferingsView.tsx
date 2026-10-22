import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveRestore } from 'lucide-react'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useToast } from '../../components/ui/toastStore'
import { getArchivedDataTableOfferings, restoreOfferings } from '../../lib/api/dataTable'
import type { CaseType, Constraint, Location } from '../../types/database'

const PAGE_SIZE = 50

interface ArchivedOfferingsViewProps {
  orgId: string
  caseTypes: CaseType[]
  locations: Location[]
  constraints: Constraint[]
}

function constraintSummary(raw: unknown, constraints: Constraint[]): string {
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

export default function ArchivedOfferingsView({
  orgId,
  caseTypes,
  locations,
  constraints,
}: ArchivedOfferingsViewProps) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [restoring, setRestoring] = useState(false)

  // Nested under the active list's key so the existing
  // invalidateQueries(['data-table-offerings', orgId]) calls after an archive,
  // import or clear also refresh this list.
  const { data: archived = [], isLoading } = useQuery({
    queryKey: ['data-table-offerings', orgId, 'archived'],
    queryFn: () => getArchivedDataTableOfferings(orgId),
    enabled: Boolean(orgId),
  })

  const caseTypeNameById = useMemo(() => new Map(caseTypes.map((ct) => [ct.id, ct.name])), [caseTypes])
  const locationNameById = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return archived
    return archived.filter((offering) => (offering.providers?.name ?? '').toLowerCase().includes(term))
  }, [archived, search])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(pageIndex, pageCount - 1)
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  // Selection only ever counts rows that are still listed.
  const selectedIds = filtered.filter((o) => selected.has(o.id)).map((o) => o.id)
  const allPageSelected = pageRows.length > 0 && pageRows.every((o) => selected.has(o.id))

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (allPageSelected) pageRows.forEach((o) => next.delete(o.id))
      else pageRows.forEach((o) => next.add(o.id))
      return next
    })

  const restore = async (ids: string[]) => {
    if (ids.length === 0 || restoring) return
    setRestoring(true)
    const result = await restoreOfferings(ids)
    setRestoring(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    // Prefix match refreshes both the active and archived lists.
    await queryClient.invalidateQueries({ queryKey: ['data-table-offerings', orgId] })
    setSelected((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
    toast.success(ids.length === 1 ? 'Offering restored' : `${ids.length} offerings restored`)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div>
      <p className="mt-2 text-sm text-slate-500">
        Archived offerings are hidden from the data table, matcher and widget. Restore one to bring it
        back exactly as it was.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPageIndex(0)
          }}
          placeholder="Search provider"
          aria-label="Search archived offerings by provider"
          className="w-56 rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <span className="text-sm text-slate-500">
          Showing {filtered.length} of {archived.length} archived offerings
        </span>
        {selectedIds.length > 0 ? (
          <button
            type="button"
            disabled={restoring}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            onClick={() => restore(selectedIds)}
          >
            Restore Selected ({selectedIds.length})
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          {archived.length === 0 ? 'No archived offerings' : 'No archived offerings match that search'}
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full">
            <thead className="border-b bg-slate-50">
              <tr>
                <th className="w-10 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    aria-label="Select all archived offerings on this page"
                    checked={allPageSelected}
                    onChange={togglePage}
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-500">
                  Provider
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-500">
                  Case Type
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-500">
                  Locations
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-500">
                  Constraints
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((offering) => {
                const locationNames = (offering.location_ids ?? [])
                  .map((locationId) => locationNameById.get(locationId))
                  .filter((name): name is string => Boolean(name))
                const summary = constraintSummary(offering.constraints, constraints)
                return (
                  <tr key={offering.id} className="border-b border-slate-100">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${offering.providers?.name ?? 'offering'}`}
                        checked={selected.has(offering.id)}
                        onChange={() => toggleOne(offering.id)}
                      />
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      {offering.providers?.name ?? 'Unknown provider'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {caseTypeNameById.get(offering.case_type_id) ?? 'Unknown'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {locationNames.length > 0 ? locationNames.join(', ') : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{summary || '—'}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={restoring}
                        className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                        onClick={() => restore([offering.id])}
                      >
                        <ArchiveRestore className="h-4 w-4" /> Restore
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <div className="mt-3 flex items-center justify-end gap-3 text-sm">
          <button
            type="button"
            onClick={() => setPageIndex(currentPage - 1)}
            disabled={currentPage === 0}
            className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-50"
          >
            Previous
          </button>
          <span>
            Page {currentPage + 1} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPageIndex(currentPage + 1)}
            disabled={currentPage >= pageCount - 1}
            className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  )
}
