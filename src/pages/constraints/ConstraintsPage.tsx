import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Pencil, Plus, SlidersHorizontal } from 'lucide-react'
import ConstraintModal, { type ConstraintFormSavePayload } from '../../components/modals/ConstraintModal'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import EmptyState from '../../components/ui/EmptyState'
import { useToast } from '../../components/ui/toastStore'
import {
  archiveConstraint,
  createConstraint,
  getConstraints,
  getConstraintQuestionCounts,
  getNextConstraintSortOrder,
  updateConstraint,
} from '../../lib/api/constraints'
import { useAuthStore } from '../../stores/authStore'
import type { Constraint } from '../../types/database'

type ConstraintRow = { constraint: Constraint; questionCount: number }

const EMPTY_CONSTRAINT_ROWS: ConstraintRow[] = []

function typeBadgeClass(type: Constraint['type']): string {
  switch (type) {
    case 'binary':
      return 'bg-green-100 text-green-700'
    case 'range':
      return 'bg-blue-100 text-blue-700'
    case 'exact':
      return 'bg-purple-100 text-purple-700'
    default:
      return 'bg-slate-100 text-slate-700'
  }
}

function mappedKeysLabel(c: Constraint): string {
  if (c.type === 'range') {
    const maxKey = c.secondary_mapped_key ?? '—'
    return `${c.mapped_key} / ${maxKey}`
  }
  return c.mapped_key
}

export default function ConstraintsPage() {
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [modal, setModal] = useState<{ type: 'add' | 'edit' | 'archive' | null; payload?: Constraint }>({
    type: null,
  })
  const [archiveLoading, setArchiveLoading] = useState(false)

  const { data, isLoading } = useQuery({
    // Augmented rows -- must not share the plain ['constraints', orgId] key that
    // LogicTester, DataTablePage, ProviderProfilePage and QuestionsPage read
    // Constraint[] from.
    queryKey: ['constraints-with-counts', orgId],
    queryFn: async () => {
      const list = await getConstraints(orgId)
      const counts = await getConstraintQuestionCounts(list.map((c) => c.id))
      return list.map((constraint) => ({
        constraint,
        questionCount: counts[constraint.id] ?? 0,
      }))
    },
    enabled: Boolean(orgId),
  })

  const rows = data ?? EMPTY_CONSTRAINT_ROWS

  function getQuestionCount(constraintId: string | undefined): number {
    if (!constraintId) {
      return 0
    }
    return rows.find((r) => r.constraint.id === constraintId)?.questionCount ?? 0
  }

  useEffect(() => {
    if (modal.type === null) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModal({ type: null })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [modal.type])

  useEffect(() => {
    if (modal.type !== null) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [modal.type])

  async function handleCreate(payload: ConstraintFormSavePayload) {
    if (!orgId) {
      throw new Error('Organization not found')
    }
    const sort_order = await getNextConstraintSortOrder(orgId)
    const { error } = await createConstraint({ ...payload, org_id: orgId, sort_order })
    if (error) {
      throw new Error(error)
    }
    await queryClient.invalidateQueries({ queryKey: ['constraints-with-counts', orgId] })
    await queryClient.invalidateQueries({ queryKey: ['constraints', orgId] })
    setModal({ type: null })
    toast.success('Constraint created')
  }

  async function handleUpdate(payload: ConstraintFormSavePayload) {
    if (!modal.payload) {
      return
    }
    const { error } = await updateConstraint(modal.payload.id, payload)
    if (error) {
      throw new Error(error)
    }
    await queryClient.invalidateQueries({ queryKey: ['constraints-with-counts', orgId] })
    await queryClient.invalidateQueries({ queryKey: ['constraints', orgId] })
    setModal({ type: null })
    toast.success('Constraint updated')
  }

  async function handleConfirmArchive() {
    if (modal.type !== 'archive' || !modal.payload) {
      return
    }
    const { id } = modal.payload
    setArchiveLoading(true)
    const { error } = await archiveConstraint(id)
    setArchiveLoading(false)
    if (error) {
      toast.error(error)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['constraints-with-counts', orgId] })
    await queryClient.invalidateQueries({ queryKey: ['constraints', orgId] })
    setModal({ type: null })
    toast.success('Constraint archived')
  }

  return (
    <div>
      <div className="mb-6 flex justify-end">
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          onClick={() => setModal({ type: 'add' })}
        >
          <Plus className="h-4 w-4" />
          Add Constraint
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading constraints…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<SlidersHorizontal className="h-10 w-10" />}
          title="No constraints yet"
          description="Create constraints to enable custom filtering logic"
          action={
            <button
              type="button"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              onClick={() => setModal({ type: 'add' })}
            >
              + Add Constraint
            </button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Mapped Key(s)</th>
                <th className="px-4 py-3">Questions Using</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ constraint, questionCount }) => (
                <tr key={constraint.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-medium text-slate-900">{constraint.name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${typeBadgeClass(constraint.type)}`}
                    >
                      {constraint.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{mappedKeysLabel(constraint)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                      {questionCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-600"
                        aria-label="Edit constraint"
                        onClick={() => setModal({ type: 'edit', payload: constraint })}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {questionCount > 0 ? (
                        <button
                          type="button"
                          className="cursor-not-allowed rounded-lg p-2 text-slate-300"
                          disabled
                          title="Remove from all questions first"
                          aria-label="Archive constraint (disabled: remove from questions first)"
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-red-600"
                          aria-label="Archive constraint"
                          onClick={() => setModal({ type: 'archive', payload: constraint })}
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConstraintModal
        isOpen={modal.type === 'add'}
        title="Add Constraint"
        orgId={orgId}
        onClose={() => setModal({ type: null })}
        onSave={handleCreate}
      />

      <ConstraintModal
        isOpen={modal.type === 'edit'}
        title="Edit Constraint"
        orgId={orgId}
        initialData={modal.payload}
        questionCount={modal.type === 'edit' && modal.payload ? getQuestionCount(modal.payload.id) : 0}
        onClose={() => setModal({ type: null })}
        onSave={handleUpdate}
      />

      <ConfirmDialog
        isOpen={modal.type === 'archive'}
        title="Archive Constraint"
        message={
          modal.type === 'archive' && modal.payload
            ? `Archive ${modal.payload.name}? It will no longer be available for questions or filtering.`
            : ''
        }
        confirmLabel="Archive"
        confirmVariant="danger"
        isLoading={archiveLoading}
        onConfirm={handleConfirmArchive}
        onCancel={() => setModal({ type: null })}
      />
    </div>
  )
}
