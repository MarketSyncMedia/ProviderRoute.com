import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { useToast } from '../../components/ui/toastStore'
import { getCategories, getCategoryProviders, removeCategory } from '../../lib/api/categories'
import { invalidateOfferingReaders } from '../../lib/invalidateOfferingReaders'
import { findSimilarName } from '../../lib/similarNames'
import { useAuthStore } from '../../stores/authStore'
import type { Category } from '../../types/database'

/**
 * Removing a category takes it off every provider and deletes it, or moves
 * those providers onto another category first. Merging is how a misspelled
 * duplicate ("Sports Medincine") goes away without leaving its providers bare.
 * It is a real delete, unlike archiving: a category is only a label, and
 * nothing would ever bring an archived one back.
 */
export default function RemoveCategoryDialog({
  category,
  close,
  refresh,
}: {
  category: Category
  offeringCount: number
  close: () => void
  refresh: () => Promise<void>
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [chosenMode, setChosenMode] = useState<'remove' | 'merge' | null>(null)
  const [chosenTarget, setChosenTarget] = useState('')

  const providers = useQuery({
    queryKey: ['category-providers', category.id],
    queryFn: () => getCategoryProviders(category.id),
  })
  const categories = useQuery({
    queryKey: ['categories', orgId],
    queryFn: () => getCategories(orgId),
    enabled: Boolean(orgId),
  })

  const others = (categories.data ?? []).filter((c) => c.id !== category.id)
  // A near-identical name is almost certainly the same thing misspelled, so
  // merging into it is where the dialog starts.
  const similar = findSimilarName(category.name, others.map((c) => c.name))
  const similarCategory = similar ? others.find((c) => c.name === similar.name) : undefined

  const mode = chosenMode ?? (similarCategory ? 'merge' : 'remove')
  const targetId = chosenTarget || similarCategory?.id || others[0]?.id || ''
  const target = others.find((c) => c.id === targetId)
  const count = providers.data?.length

  async function confirm() {
    setSaving(true)
    const { error, providersUpdated } = await removeCategory(category.id, mode === 'merge' ? targetId : null)
    setSaving(false)
    if (error) {
      toast.error(error)
      return
    }
    await Promise.all([
      refresh(),
      invalidateOfferingReaders(queryClient, orgId),
      queryClient.invalidateQueries({ queryKey: ['providers', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['provider'] }),
      queryClient.invalidateQueries({ queryKey: ['category-providers'] }),
    ])
    close()
    const updated = providersUpdated > 0 ? ` (${providersUpdated} ${providersUpdated === 1 ? 'provider' : 'providers'} updated)` : ''
    toast.success(
      mode === 'merge' && target ? `${category.name} merged into ${target.name}${updated}` : `${category.name} removed${updated}`,
    )
  }

  return (
    <ConfirmDialog
      isOpen
      title={`Remove ${category.name}`}
      message={
        providers.isLoading
          ? 'Checking which providers use it…'
          : providers.isError
            ? (providers.error as Error).message
            : count
              ? `${category.name} is on ${count} ${count === 1 ? 'provider' : 'providers'}.`
              : `${category.name} is not on any providers.`
      }
      confirmLabel={mode === 'merge' && target ? `Merge into ${target.name}` : 'Remove'}
      confirmVariant="danger"
      isLoading={saving}
      confirmDisabled={providers.isLoading || providers.isError || (mode === 'merge' && !target)}
      onConfirm={() => void confirm()}
      onCancel={close}
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">What happens to its providers</legend>
        <label className="flex gap-3 rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50/50">
          <input type="radio" name="remove-mode" checked={mode === 'remove'} onChange={() => setChosenMode('remove')} />
          <span>
            <span className="block font-medium text-slate-900">Just remove it</span>
            <span className="block text-xs text-slate-500">Providers lose this category. This can&apos;t be undone.</span>
          </span>
        </label>
        <label
          className={[
            'flex gap-3 rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50/50',
            others.length === 0 ? 'opacity-50' : '',
          ].join(' ')}
        >
          <input
            type="radio"
            name="remove-mode"
            checked={mode === 'merge'}
            disabled={others.length === 0}
            onChange={() => setChosenMode('merge')}
          />
          <span className="flex-1">
            <span className="block font-medium text-slate-900">Merge into another category</span>
            <span className="block text-xs text-slate-500">
              Its providers get the other category instead, then this one is deleted.
            </span>
            {similarCategory ? (
              <span className="mt-1 block text-xs font-medium text-indigo-700">
                Looks like a misspelling of {similarCategory.name}.
              </span>
            ) : null}
          </span>
        </label>
      </fieldset>

      {mode === 'merge' && others.length > 0 ? (
        <div className="mt-3">
          <label htmlFor="merge-target" className="mb-1 block text-sm font-medium text-slate-700">
            Merge into
          </label>
          <select
            id="merge-target"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={targetId}
            onChange={(e) => setChosenTarget(e.target.value)}
          >
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </ConfirmDialog>
  )
}
