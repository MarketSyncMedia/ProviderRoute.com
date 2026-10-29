import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { useToast } from '../../components/ui/toastStore'
import { archiveCaseType, getCaseTypeProviders } from '../../lib/api/caseTypes'
import { archiveOfferings } from '../../lib/api/dataTable'
import { useAuthStore } from '../../stores/authStore'
import type { CaseType } from '../../types/database'

/**
 * Archiving a case type either for every provider (the case type itself) or
 * for just the providers ticked (their offerings of it). Both are undoable:
 * the first from "Archived case types" on this page, the second from the data
 * table's Archived view.
 */
export default function ArchiveCaseTypeDialog({
  caseType,
  offeringCount,
  close,
  refresh,
}: {
  caseType: CaseType
  offeringCount: number
  close: () => void
  refresh: () => Promise<void>
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const [scope, setScope] = useState<'all' | 'some'>('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const providers = useQuery({
    queryKey: ['case-type-providers', caseType.id],
    queryFn: () => getCaseTypeProviders(caseType.id),
    enabled: scope === 'some',
  })

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function confirm() {
    setSaving(true)
    if (scope === 'all') {
      const { error } = await archiveCaseType(caseType.id)
      setSaving(false)
      if (error) {
        toast.error(error)
        return
      }
      await refresh()
      close()
      toast.success(`${caseType.name} archived for all providers`)
      return
    }

    const chosen = (providers.data ?? []).filter((p) => picked.has(p.providerId))
    const { error } = await archiveOfferings(chosen.flatMap((p) => p.offeringIds))
    setSaving(false)
    if (error) {
      toast.error(error)
      return
    }
    await Promise.all([
      refresh(),
      queryClient.invalidateQueries({ queryKey: ['case-type-providers', caseType.id] }),
      queryClient.invalidateQueries({ queryKey: ['data-table-offerings', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['provider-offerings'] }),
    ])
    close()
    toast.success(
      `${caseType.name} archived for ${chosen.length} ${chosen.length === 1 ? 'provider' : 'providers'}`,
    )
  }

  const someReady = scope === 'some' && picked.size > 0 && !providers.isLoading
  const confirmLabel =
    scope === 'all'
      ? 'Archive for all providers'
      : `Archive for ${picked.size} ${picked.size === 1 ? 'provider' : 'providers'}`

  return (
    <ConfirmDialog
      isOpen
      title={`Archive ${caseType.name}`}
      message={
        offeringCount > 0
          ? `${caseType.name} is used in ${offeringCount} ${offeringCount === 1 ? 'offering' : 'offerings'}.`
          : `${caseType.name} is not used in any offerings.`
      }
      confirmLabel={confirmLabel}
      confirmVariant="danger"
      isLoading={saving}
      confirmDisabled={scope === 'some' && !someReady}
      onConfirm={() => void confirm()}
      onCancel={close}
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">Archive for</legend>
        <label className="flex gap-3 rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50/50">
          <input type="radio" name="archive-scope" checked={scope === 'all'} onChange={() => setScope('all')} />
          <span>
            <span className="block font-medium text-slate-900">All providers</span>
            <span className="block text-xs text-slate-500">
              Removed from every provider, the widget and the body map. Restore it from Archived case types.
            </span>
          </span>
        </label>
        <label
          className={[
            'flex gap-3 rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50/50',
            offeringCount === 0 ? 'opacity-50' : '',
          ].join(' ')}
        >
          <input
            type="radio"
            name="archive-scope"
            checked={scope === 'some'}
            disabled={offeringCount === 0}
            onChange={() => setScope('some')}
          />
          <span>
            <span className="block font-medium text-slate-900">Only some providers</span>
            <span className="block text-xs text-slate-500">
              The case type stays for everyone else. Restore from the data table&apos;s Archived view.
            </span>
          </span>
        </label>
      </fieldset>

      {scope === 'some' ? (
        <div className="mt-3">
          {providers.isLoading ? (
            <p className="text-sm text-slate-500">Loading providers…</p>
          ) : providers.isError ? (
            <p className="text-sm text-red-600">{(providers.error as Error).message}</p>
          ) : !providers.data?.length ? (
            <p className="text-sm text-slate-500">No active provider offers this case type.</p>
          ) : (
            <>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                <span>
                  {providers.data.length} {providers.data.length === 1 ? 'provider offers' : 'providers offer'} this
                </span>
                <button
                  type="button"
                  className="font-medium text-indigo-600 hover:text-indigo-700"
                  onClick={() =>
                    setPicked(
                      picked.size === (providers.data?.length ?? 0)
                        ? new Set()
                        : new Set((providers.data ?? []).map((p) => p.providerId)),
                    )
                  }
                >
                  {picked.size === (providers.data?.length ?? 0) ? 'Clear' : 'Select all'}
                </button>
              </div>
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {(providers.data ?? []).map((p) => (
                  <li key={p.providerId}>
                    <label className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={picked.has(p.providerId)}
                        onChange={() => toggle(p.providerId)}
                      />
                      <span className="flex-1 text-slate-800">{p.providerName}</span>
                      {p.offeringIds.length > 1 ? (
                        <span className="text-xs text-slate-500">{p.offeringIds.length} offerings</span>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </ConfirmDialog>
  )
}
