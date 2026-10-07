import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Archive, GripVertical, Pencil, Plus } from 'lucide-react'
import ConfirmDialog from '../ui/ConfirmDialog'
import EmptyState from '../ui/EmptyState'
import { useToast } from '../ui/toastStore'
import { useAuthStore } from '../../stores/authStore'

/**
 * The shared implementation behind CaseTypesPage and CategoriesPage.
 *
 * Those two pages were ~88% identical — same drag-to-reorder list, same
 * add/edit/archive modal flow, same validation — differing only in labels,
 * icon, and which API module they called. This holds the one copy of that
 * behaviour; each page supplies its own copy strings and API functions.
 *
 * Behaviour is preserved exactly as it was in both pages, including the two
 * non-obvious choices their comments called out (see `syncedRows` and
 * `openAdd`/`openEdit` below) — both are pinned by
 * tests/unit/caseTypesPage.test.tsx and tests/unit/categoriesPage.test.tsx.
 */

/** The shape both case types and categories share. */
export type SortableEntity = {
  id: string
  name: string
  sort_order: number
}

/** The API surface a page must provide. Mirrors the existing per-entity modules. */
export type SortableEntityApi<T extends SortableEntity> = {
  list: (orgId: string) => Promise<T[]>
  /** Counts for the whole list at once -- see the per-entity API modules. */
  offeringCounts: (ids: string[]) => Promise<Record<string, number>>
  create: (orgId: string, name: string) => Promise<{ error: string | null }>
  update: (id: string, name: string) => Promise<{ error: string | null }>
  updateOrders: (
    updates: Array<{ id: string; sort_order: number }>,
  ) => Promise<{ error: string | null }>
  archive: (id: string) => Promise<{ error: string | null }>
}

export type SortableEntityCopy = {
  /** Title case, singular — buttons and headings, e.g. "Case Type". */
  singular: string
  /** Lower case, singular — aria-labels and messages, e.g. "case type". */
  singularLower: string
  /** Lower case, plural — loading and empty states, e.g. "case types". */
  pluralLower: string
  /** Empty-state hint, e.g. "Add case types like Knee, Shoulder, Hip". */
  emptyDescription: string
}

type EntityRow<T> = { entity: T; offeringCount: number }

const EMPTY_ROWS: EntityRow<never>[] = []

/**
 * Toasts read as sentence case ("Case type added", "Category archived") while
 * headings and buttons use title case ("Add Case Type"), so the toast label is
 * derived from the lower-case form rather than reusing `singular`.
 */
function toastLabel(singularLower: string): string {
  return singularLower.charAt(0).toUpperCase() + singularLower.slice(1)
}

function SortableEntityRow<T extends SortableEntity>({
  entity,
  offeringCount,
  singularLower,
  extra,
  onEdit,
  onArchive,
}: {
  entity: T
  offeringCount: number
  singularLower: string
  extra?: ReactNode
  onEdit: () => void
  onArchive: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entity.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="mb-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3"
    >
      <button
        type="button"
        className="touch-none cursor-grab text-slate-300 hover:text-slate-400 active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <span className="flex-1 text-sm font-medium text-slate-900">{entity.name}</span>
      {extra}
      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
        {offeringCount}
      </span>
      <button
        type="button"
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-600"
        aria-label={`Edit ${singularLower}`}
        onClick={onEdit}
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-red-600"
        aria-label={`Archive ${singularLower}`}
        onClick={onArchive}
      >
        <Archive className="h-4 w-4" />
      </button>
    </div>
  )
}

export default function SortableEntityListPage<T extends SortableEntity>({
  queryKey,
  alsoInvalidate = [],
  api,
  copy,
  icon,
  rowExtra,
  toolbarExtra,
}: {
  /**
   * Key prefix for this page's own query; the org id is appended. Must be
   * distinct from the plain-list key other pages use — this query caches
   * counts-augmented rows, and two shapes under one key means whichever
   * mounted first serves its shape to the other. See `alsoInvalidate`.
   */
  queryKey: string
  /**
   * Additional key prefixes to invalidate after a mutation. The plain-list key
   * belongs here: other pages read the entity list under it, and they must
   * still refresh when something is added, renamed, archived or reordered.
   */
  alsoInvalidate?: string[]
  api: SortableEntityApi<T>
  copy: SortableEntityCopy
  icon: ReactNode
  /** Page-specific controls rendered in each row, before the count badge. */
  rowExtra?: (entity: T, all: T[]) => ReactNode
  /** Page-specific controls rendered beside the add button. */
  toolbarExtra?: (all: T[]) => ReactNode
}) {
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  /** Refresh this page's rows and every other view of the same entity. */
  async function invalidateAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [queryKey, orgId] }),
      ...alsoInvalidate.map((key) => queryClient.invalidateQueries({ queryKey: [key, orgId] })),
    ])
  }

  const [modal, setModal] = useState<{ type: 'add' | 'edit' | 'archive' | null; payload?: T }>({
    type: null,
  })
  const [name, setName] = useState('')
  const [formError, setFormError] = useState('')
  const [saveLoading, setSaveLoading] = useState(false)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [items, setItems] = useState<T[]>([])

  const { data, isLoading } = useQuery({
    queryKey: [queryKey, orgId],
    queryFn: async () => {
      const entities = await api.list(orgId)
      const counts = await api.offeringCounts(entities.map((e) => e.id))
      return entities.map((entity) => ({
        entity,
        offeringCount: counts[entity.id] ?? 0,
      }))
    },
    enabled: Boolean(orgId),
  })

  const rows: EntityRow<T>[] = data ?? (EMPTY_ROWS as EntityRow<T>[])

  // `items` is the drag-reorderable copy of `rows`. Resyncing it during render
  // when the query returns new data — rather than from an effect — avoids
  // painting one frame of the stale order after every refetch.
  const [syncedRows, setSyncedRows] = useState(rows)
  if (rows !== syncedRows) {
    setSyncedRows(rows)
    setItems(rows.map((r) => r.entity))
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

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

  // Seed the form as the dialog is opened rather than in an effect reacting to
  // `modal`. The effect ran a second render on every open, and these are the
  // only paths that reach the add/edit dialogs.
  function openAdd() {
    setName('')
    setFormError('')
    setModal({ type: 'add' })
  }

  function openEdit(target: T) {
    setName(target.name)
    setFormError('')
    setModal({ type: 'edit', payload: target })
  }

  const archivePayload = modal.type === 'archive' ? modal.payload : undefined
  const archiveOfferingCount = archivePayload
    ? (rows.find((r) => r.entity.id === archivePayload.id)?.offeringCount ?? 0)
    : 0

  function validateName(value: string): string | null {
    const t = value.trim()
    if (!t) {
      return 'Name is required'
    }
    if (t.length < 2) {
      return 'Name must be at least 2 characters'
    }
    const excludeId = modal.type === 'edit' && modal.payload ? modal.payload.id : undefined
    const dup = items.some(
      (e) => e.id !== excludeId && e.name.trim().toLowerCase() === t.toLowerCase(),
    )
    if (dup) {
      return `A ${copy.singularLower} with this name already exists`
    }
    return null
  }

  async function handleSaveAddOrEdit() {
    if (!orgId) {
      setFormError('Organization not found')
      return
    }
    const err = validateName(name)
    if (err) {
      setFormError(err)
      return
    }

    setFormError('')
    setSaveLoading(true)

    if (modal.type === 'edit' && !modal.payload) {
      setSaveLoading(false)
      return
    }

    if (modal.type === 'add') {
      const { error } = await api.create(orgId, name.trim())
      setSaveLoading(false)
      if (error) {
        setFormError(error)
        return
      }
      await invalidateAll()
      setModal({ type: null })
      toast.success(`${toastLabel(copy.singularLower)} added`)
      return
    }

    if (modal.type === 'edit' && modal.payload) {
      const { error } = await api.update(modal.payload.id, name.trim())
      setSaveLoading(false)
      if (error) {
        setFormError(error)
        return
      }
      await invalidateAll()
      setModal({ type: null })
      toast.success(`${toastLabel(copy.singularLower)} updated`)
    }
  }

  async function handleConfirmArchive() {
    if (modal.type !== 'archive' || !modal.payload) {
      return
    }
    const { id } = modal.payload
    setArchiveLoading(true)
    const { error } = await api.archive(id)
    setArchiveLoading(false)
    if (error) {
      toast.error(error)
      return
    }
    await invalidateAll()
    setModal({ type: null })
    toast.success(`${toastLabel(copy.singularLower)} archived`)
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) {
      return
    }
    const oldIndex = items.findIndex((i) => i.id === active.id)
    const newIndex = items.findIndex((i) => i.id === over.id)
    if (oldIndex < 0 || newIndex < 0) {
      return
    }

    const previous = [...items]
    const next = arrayMove(items, oldIndex, newIndex)
    setItems(next)

    const updates = next.map((e, idx) => ({ id: e.id, sort_order: idx }))
    const { error } = await api.updateOrders(updates)
    if (error) {
      setItems(previous)
      toast.error(error)
      return
    }
    await invalidateAll()
  }

  return (
    <div>
      <div className="mb-6 flex justify-end gap-3">
        {toolbarExtra && rows.length > 0 ? toolbarExtra(items) : null}
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          onClick={openAdd}
        >
          <Plus className="h-4 w-4" />+ Add {copy.singular}
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading {copy.pluralLower}…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={icon}
          title={`No ${copy.pluralLower} yet`}
          description={copy.emptyDescription}
          action={
            <button
              type="button"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              onClick={openAdd}
            >
              + Add {copy.singular}
            </button>
          }
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            {items.map((entity) => {
              const offeringCount = rows.find((r) => r.entity.id === entity.id)?.offeringCount ?? 0
              return (
                <SortableEntityRow
                  key={entity.id}
                  entity={entity}
                  offeringCount={offeringCount}
                  singularLower={copy.singularLower}
                  extra={rowExtra?.(entity, items)}
                  onEdit={() => openEdit(entity)}
                  onArchive={() => setModal({ type: 'archive', payload: entity })}
                />
              )
            })}
          </SortableContext>
        </DndContext>
      )}

      {modal.type === 'add' || modal.type === 'edit' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onMouseDown={() => setModal({ type: null })}
          />
          <div
            className="relative mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              {modal.type === 'add' ? `Add ${copy.singular}` : `Edit ${copy.singular}`}
            </h2>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {formError ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModal({ type: null })}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                disabled={saveLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAddOrEdit}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                disabled={saveLoading}
              >
                {saveLoading ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={modal.type === 'archive'}
        title={`Archive ${copy.singular}`}
        message={
          modal.type === 'archive' && modal.payload
            ? archiveOfferingCount > 0
              ? `Archive ${modal.payload.name}? This ${copy.singularLower} is used in ${archiveOfferingCount} offerings.`
              : `Archive ${modal.payload.name}?`
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
