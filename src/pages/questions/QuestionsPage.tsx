import { useEffect, useMemo, useState } from 'react'
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
import {
  Eye,
  FlaskConical,
  GripVertical,
  Lock,
  MapPin,
  Pencil,
  Plus,
  Stethoscope,
  Trash2,
  User,
  X,
} from 'lucide-react'
import LogicTester from '../../components/testing/LogicTester'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useToast } from '../../components/ui/toastStore'
import { getCaseTypes } from '../../lib/api/caseTypes'
import { getConstraints } from '../../lib/api/constraints'
import { getLocations } from '../../lib/api/locations'
import {
  archiveQuestion,
  createQuestion,
  ensureEntryQuestion,
  getNextOrderRank,
  getQuestions,
  reorderQuestions,
  updateQuestion,
} from '../../lib/api/questions'
import { useAuthStore } from '../../stores/authStore'
import type { CaseType, Constraint, Location, Question } from '../../types/database'
import { toJson } from '../../lib/schemaEnums'

const EMPTY_QUESTIONS: Question[] = []

function WidgetQuestionPreview({
  question,
  constraints,
  locations,
  caseTypes,
}: {
  question: Question
  constraints: Constraint[]
  locations: Location[]
  caseTypes: CaseType[]
}) {
  const sc = (question.system_config ?? {}) as Record<string, unknown>
  const c = question.constraint_id ? constraints.find((x) => x.id === question.constraint_id) : undefined

  // The entry question's answers are the org's case types.
  if (question.question_type === 'entry') {
    return (
      <div className="space-y-3">
        {question.input_type === 'buttons' && (
          <div className="flex flex-wrap gap-2">
            {caseTypes.map((caseType) => (
              <span
                key={caseType.id}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm"
              >
                {caseType.name}
              </span>
            ))}
          </div>
        )}
        {question.input_type === 'dropdown' && (
          <select className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm" disabled>
            <option>Select…</option>
            {caseTypes.map((caseType) => (
              <option key={caseType.id}>{caseType.name}</option>
            ))}
          </select>
        )}
        {question.input_type === 'number' && (
          <input
            type="number"
            readOnly
            placeholder="Enter a number"
            className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        )}
      </div>
    )
  }

  if (question.question_type === 'clinical' && c) {
    if (c.type === 'binary') {
      return (
        <div className="flex gap-2">
          <button type="button" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
            {c.yes_label || 'Yes'}
          </button>
          <button type="button" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
            {c.no_label || 'No'}
          </button>
        </div>
      )
    }
    if (c.type === 'range') {
      return (
        <input
          type="number"
          readOnly
          placeholder="Enter a number"
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      )
    }
    if (c.type === 'exact') {
      if (question.input_type === 'dropdown') {
        return (
          <select className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm" disabled>
            <option>Select…</option>
          </select>
        )
      }
      return (
        <div className="flex gap-2">
          <button type="button" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
            Option A
          </button>
          <button type="button" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
            Option B
          </button>
        </div>
      )
    }
  }

  if (question.question_type === 'location') {
    const scopeAll = sc.scope === 'all' || sc.locationFilter === 'all'
    const ids = ((sc.location_ids as string[]) ?? (sc.locationIds as string[]) ?? []) as string[]
    return (
      <select className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm" disabled>
        <option>
          {scopeAll
            ? 'All locations'
            : ids.length
              ? locations.filter((l) => ids.includes(l.id)).map((l) => l.name).join(', ') || 'Select locations'
              : 'Select locations'}
        </option>
      </select>
    )
  }

  if (question.question_type === 'provider') {
    return (
      <div className="flex gap-2">
        <button type="button" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
          Yes
        </button>
        <button type="button" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
          No
        </button>
      </div>
    )
  }

  return null
}

type AddQuestionType = 'clinical' | 'location' | 'provider'

type AddFormData = {
  question_text: string
  subtext: string
  required: boolean
  input_type: 'buttons' | 'dropdown' | 'number'
}

function typeBadgeClass(qt: Question['question_type']): string {
  switch (qt) {
    case 'clinical':
      return 'bg-green-100 text-green-700'
    case 'location':
      return 'bg-blue-100 text-blue-700'
    case 'provider':
      return 'bg-purple-100 text-purple-700'
    default:
      return 'bg-slate-100 text-slate-700'
  }
}

function SortableQuestionRow({
  question,
  orderLabel,
  constraintName,
  onPreview,
  onEdit,
  onDelete,
}: {
  question: Question
  orderLabel: string
  constraintName: string | null
  onPreview: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.id,
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
      className="mb-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
    >
      <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded bg-slate-100 px-1.5 text-xs font-medium text-slate-600">
        {orderLabel}
      </span>
      <button
        type="button"
        className="touch-none cursor-grab text-slate-300 hover:text-slate-400 active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-slate-900">{question.question_text}</span>
        {question.question_type === 'clinical' && constraintName ? (
          <span className="text-xs text-slate-500">{constraintName}</span>
        ) : null}
      </div>
      <span
        className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${typeBadgeClass(question.question_type)}`}
      >
        {question.question_type}
      </span>
      <button
        type="button"
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-600"
        aria-label="Preview"
        onClick={onPreview}
      >
        <Eye className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-600"
        aria-label="Edit"
        onClick={onEdit}
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="rounded-lg p-2 text-red-400 hover:bg-red-50 hover:text-red-600"
        aria-label="Delete question"
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

export default function QuestionsPage() {
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [items, setItems] = useState<Question[]>([])
  const [modal, setModal] = useState<{
    type: 'add' | 'edit' | 'delete' | 'preview' | null
    payload?: unknown
  }>({ type: null })
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [entryEditForm, setEntryEditForm] = useState<{
    question_text: string
    input_type: Question['input_type']
  }>({ question_text: '', input_type: 'buttons' })
  const [editIsSaving, setEditIsSaving] = useState(false)
  const [systemBusy, setSystemBusy] = useState<'location' | 'provider' | null>(null)

  const [addStep, setAddStep] = useState<1 | 2 | 3>(1)
  const [addType, setAddType] = useState<AddQuestionType | null>(null)
  const [addConstraintId, setAddConstraintId] = useState<string | null>(null)
  const [addFormData, setAddFormData] = useState<AddFormData>({
    question_text: '',
    subtext: '',
    required: true,
    input_type: 'buttons',
  })
  const [addLocationFilter, setAddLocationFilter] = useState<'all' | 'specific'>('all')
  const [addLocationIds, setAddLocationIds] = useState<string[]>([])
  const [addIsSaving, setAddIsSaving] = useState(false)
  const [addError, setAddError] = useState('')
  const [logicTesterOpen, setLogicTesterOpen] = useState(false)

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => getLocations(orgId),
    enabled: Boolean(orgId),
  })

  const { data: constraints = [] } = useQuery({
    queryKey: ['constraints', orgId],
    queryFn: () => getConstraints(orgId),
    enabled: Boolean(orgId),
  })

  const { data: caseTypes = [] } = useQuery({
    queryKey: ['case-types', orgId],
    queryFn: () => getCaseTypes(orgId),
    enabled: Boolean(orgId),
  })

  const { data: questionsData, isLoading } = useQuery({
    queryKey: ['questions', orgId],
    queryFn: () => getQuestions(orgId),
    enabled: Boolean(orgId),
  })

  const allQuestions = questionsData ?? EMPTY_QUESTIONS
  // The widget asks each system question at most once, so a flow that already
  // has one must not get a second copy from a stray click.
  const hasSystemQuestion = {
    location: allQuestions.some((q) => q.question_type === 'location'),
    provider: allQuestions.some((q) => q.question_type === 'provider'),
  }
  const systemCardsDisabled = systemBusy !== null || isLoading

  useEffect(() => {
    if (!orgId) {
      return
    }
    let cancelled = false
    void ensureEntryQuestion(orgId).then(() => {
      if (!cancelled) {
        void queryClient.invalidateQueries({ queryKey: ['questions', orgId] })
      }
    })
    return () => {
      cancelled = true
    }
  }, [orgId, queryClient])

  // Reset the add form when the modal switches into 'add', during render
  // rather than from an effect — matches the [modal.type] dependency of the
  // effect this replaces: fires exactly when modal.type changes.
  const [syncedAddModalType, setSyncedAddModalType] = useState(modal.type)
  if (modal.type !== syncedAddModalType) {
    setSyncedAddModalType(modal.type)
    if (modal.type === 'add') {
      setAddStep(1)
      setAddType(null)
      setAddConstraintId(null)
      setAddFormData({
        question_text: '',
        subtext: '',
        required: true,
        input_type: 'buttons',
      })
      setAddLocationFilter('all')
      setAddLocationIds([])
      setAddIsSaving(false)
      setAddError('')
    }
  }

  // Populate the edit form when the modal switches into 'edit' (or the
  // question being edited changes), during render rather than from an
  // effect. modal.payload is real useState, not a query-fallback default,
  // so it's referentially stable across renders when unchanged — safe to
  // compare directly.
  const [syncedEditModal, setSyncedEditModal] = useState<{ type: typeof modal.type; payload: unknown }>({
    type: modal.type,
    payload: modal.payload,
  })
  if (modal.type !== syncedEditModal.type || modal.payload !== syncedEditModal.payload) {
    setSyncedEditModal({ type: modal.type, payload: modal.payload })
    if (modal.type === 'edit' && modal.payload) {
      const q = modal.payload as Question
      setEditIsSaving(false)
      setAddError('')
      if (q.question_type === 'entry') {
        setEntryEditForm({ question_text: q.question_text, input_type: q.input_type })
      } else {
        setAddStep(1)
        if (q.question_type === 'clinical' || q.question_type === 'location' || q.question_type === 'provider') {
          setAddType(q.question_type)
        }
        setAddConstraintId(q.constraint_id)
        setAddFormData({
          question_text: q.question_text,
          subtext: q.subtext ?? '',
          required: q.required,
          input_type: q.input_type === 'number' ? 'number' : q.input_type === 'dropdown' ? 'dropdown' : 'buttons',
        })
        const sc = (q.system_config ?? {}) as Record<string, unknown>
        if (q.question_type === 'location') {
          const lf = sc.locationFilter as string | undefined
          const scp = sc.scope as string | undefined
          const ids = ((sc.location_ids as string[]) ?? (sc.locationIds as string[]) ?? []) as string[]
          if (lf === 'specific' || scp === 'specific') {
            setAddLocationFilter('specific')
            setAddLocationIds(Array.isArray(ids) ? ids : [])
          } else {
            setAddLocationFilter('all')
            setAddLocationIds([])
          }
        }
      }
    }
  }

  const entryQuestion = useMemo(() => {
    const entries = allQuestions.filter((q) => q.question_type === 'entry')
    if (entries.length === 0) {
      return undefined
    }
    return [...entries].sort((a, b) => a.order_rank - b.order_rank)[0]
  }, [allQuestions])

  const nonEntryFromServer = useMemo(() => {
    return allQuestions
      .filter((q) => q.question_type !== 'entry')
      .sort((a, b) => a.order_rank - b.order_rank)
  }, [allQuestions])

  // `items` is the drag-reorderable copy of nonEntryFromServer. Resync it
  // during render when the query returns new data, rather than from an
  // effect, to avoid painting one stale frame after every refetch.
  const [syncedItems, setSyncedItems] = useState(nonEntryFromServer)
  if (nonEntryFromServer !== syncedItems) {
    setSyncedItems(nonEntryFromServer)
    setItems(nonEntryFromServer)
  }

  const constraintMap = useMemo(() => {
    const m = new Map<string, string>()
    constraints.forEach((c) => m.set(c.id, c.name))
    return m
  }, [constraints])

  const selectedConstraint = useMemo(
    () => (addConstraintId ? constraints.find((c) => c.id === addConstraintId) : undefined),
    [addConstraintId, constraints]
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
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

  function closeModal() {
    setModal({ type: null })
  }

  function handleConstraintSelect(constraintId: string) {
    setAddConstraintId(constraintId)
    const c = constraints.find((x) => x.id === constraintId)
    if (c) {
      setAddFormData((prev) => ({
        ...prev,
        question_text: prev.question_text.trim() ? prev.question_text : `About ${c.name}`,
        input_type: c.type === 'exact' ? prev.input_type : c.type === 'range' ? 'number' : 'buttons',
      }))
    }
  }

  function validateStep1(): boolean {
    if (!addType) {
      setAddError('Select a question type')
      return false
    }
    setAddError('')
    return true
  }

  function goNextFromStep1() {
    if (modal.type === 'edit') {
      setAddError('')
      setAddStep(2)
      return
    }
    if (!validateStep1()) {
      return
    }
    if (addType === 'location') {
      setAddFormData((prev) => ({
        ...prev,
        question_text: prev.question_text.trim() || 'Which location works best for you?',
      }))
    }
    if (addType === 'provider') {
      setAddFormData((prev) => ({
        ...prev,
        question_text:
          prev.question_text.trim() || "Do you already know which provider you'd like to see?",
      }))
    }
    setAddStep(2)
  }

  function validateStep2(): boolean {
    if (addType === 'clinical') {
      if (!addConstraintId) {
        setAddError('Select a constraint')
        return false
      }
      if (!addFormData.question_text.trim()) {
        setAddError('Question text is required')
        return false
      }
    }
    if (addType === 'location') {
      if (!addFormData.question_text.trim()) {
        setAddError('Question text is required')
        return false
      }
      if (addLocationFilter === 'specific' && addLocationIds.length === 0) {
        setAddError('Select at least one location')
        return false
      }
    }
    if (addType === 'provider') {
      if (!addFormData.question_text.trim()) {
        setAddError('Question text is required')
        return false
      }
    }
    setAddError('')
    return true
  }

  function goNextFromStep2() {
    if (!validateStep2()) {
      return
    }
    setAddStep(3)
  }

  async function handleSaveNewQuestion() {
    if (!orgId || !addType) {
      return
    }
    if (addType !== 'clinical' && hasSystemQuestion[addType]) {
      setAddError('This question is already in your flow.')
      return
    }
    setAddError('')
    setAddIsSaving(true)

    const order_rank = await getNextOrderRank(orgId)
    const constraint = addConstraintId ? constraints.find((c) => c.id === addConstraintId) : undefined

    let question_type: Question['question_type']
    // No initializer: the if/else-if/else below is exhaustive over addType
    // and every branch assigns this before it's read.
    let constraint_id: string | null
    let input_type: Question['input_type']
    let system_config: Record<string, unknown> = {}

    if (addType === 'clinical') {
      if (!constraint) {
        setAddError('Invalid constraint')
        setAddIsSaving(false)
        return
      }
      question_type = 'clinical'
      constraint_id = constraint.id
      if (constraint.type === 'binary') {
        input_type = 'buttons'
      } else if (constraint.type === 'range') {
        input_type = 'number'
      } else {
        input_type = addFormData.input_type === 'dropdown' ? 'dropdown' : 'buttons'
      }
    } else if (addType === 'location') {
      question_type = 'location'
      constraint_id = null
      input_type = 'dropdown'
      // Same keys as the edit path and the widget (widget.js reads
      // `scope` / `location_ids`); anything else is silently ignored there.
      system_config =
        addLocationFilter === 'all'
          ? { scope: 'all', location_ids: [] }
          : { scope: 'specific', location_ids: addLocationIds }
    } else {
      question_type = 'provider'
      constraint_id = null
      input_type = 'buttons'
    }

    const { error } = await createQuestion({
      org_id: orgId,
      question_text: addFormData.question_text.trim(),
      subtext: addFormData.subtext.trim() || null,
      question_type,
      input_type,
      constraint_id,
      required: addFormData.required,
      order_rank,
      system_config: toJson(system_config),
      is_archived: false,
    })

    setAddIsSaving(false)
    if (error) {
      setAddError(error)
      return
    }

    await queryClient.invalidateQueries({ queryKey: ['questions', orgId] })
    closeModal()
    toast.success('Question added')
  }

  async function handleSaveEntryEdit() {
    if (modal.type !== 'edit' || !modal.payload) {
      return
    }
    const q = modal.payload as Question
    if (q.question_type !== 'entry') {
      return
    }
    setEditIsSaving(true)
    setAddError('')
    const { error } = await updateQuestion(q.id, {
      question_text: entryEditForm.question_text.trim(),
      input_type: entryEditForm.input_type,
    })
    setEditIsSaving(false)
    if (error) {
      setAddError(error)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['questions', orgId] })
    setModal({ type: null })
    toast.success('Question updated')
  }

  async function handleSaveNonEntryEdit() {
    if (modal.type !== 'edit' || !modal.payload || !orgId) {
      return
    }
    const q = modal.payload as Question
    if (q.question_type === 'entry') {
      return
    }
    setEditIsSaving(true)
    setAddError('')
    const constraint = addConstraintId ? constraints.find((c) => c.id === addConstraintId) : undefined

    let input_type: Question['input_type']
    let system_config: Record<string, unknown> = {}

    if (q.question_type === 'clinical') {
      if (!constraint) {
        setAddError('Invalid constraint')
        setEditIsSaving(false)
        return
      }
      if (constraint.type === 'binary') {
        input_type = 'buttons'
      } else if (constraint.type === 'range') {
        input_type = 'number'
      } else {
        input_type = addFormData.input_type === 'dropdown' ? 'dropdown' : 'buttons'
      }
    } else if (q.question_type === 'location') {
      input_type = 'dropdown'
      system_config =
        addLocationFilter === 'all'
          ? { scope: 'all', location_ids: [] }
          : { scope: 'specific', location_ids: addLocationIds }
    } else {
      input_type = 'buttons'
    }

    const updates: Partial<Question> = {
      question_text: addFormData.question_text.trim(),
      subtext: addFormData.subtext.trim() || null,
      input_type,
      required: addFormData.required,
    }
    if (q.question_type === 'clinical') {
      updates.constraint_id = addConstraintId
    }
    if (q.question_type === 'location') {
      updates.system_config = toJson(system_config)
    }
    if (q.question_type === 'provider') {
      updates.system_config = {}
    }

    const { error } = await updateQuestion(q.id, updates)
    setEditIsSaving(false)
    if (error) {
      setAddError(error)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['questions', orgId] })
    setModal({ type: null })
    toast.success('Question updated')
  }

  async function handleSystemLocationCard() {
    if (!orgId || hasSystemQuestion.location) {
      return
    }
    setSystemBusy('location')
    const rank = await getNextOrderRank(orgId)
    const { error } = await createQuestion({
      org_id: orgId,
      question_text: 'Which location works best for you?',
      question_type: 'location',
      input_type: 'dropdown',
      required: true,
      order_rank: rank,
      system_config: { scope: 'all', location_ids: [] },
      subtext: null,
      constraint_id: null,
      is_archived: false,
    })
    setSystemBusy(null)
    if (error) {
      toast.error(error)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['questions', orgId] })
    toast.success('Location selector added')
  }

  async function handleSystemProviderCard() {
    if (!orgId || hasSystemQuestion.provider) {
      return
    }
    setSystemBusy('provider')
    const rank = await getNextOrderRank(orgId)
    const { error } = await createQuestion({
      org_id: orgId,
      question_text: "Do you already know which provider you'd like to see?",
      question_type: 'provider',
      input_type: 'buttons',
      required: true,
      order_rank: rank,
      system_config: {},
      subtext: null,
      constraint_id: null,
      is_archived: false,
    })
    setSystemBusy(null)
    if (error) {
      toast.error(error)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['questions', orgId] })
    toast.success('Preferred provider added')
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

    const updates = next.map((q, idx) => ({ id: q.id, order_rank: idx + 1 }))
    const { error } = await reorderQuestions(updates)
    if (error) {
      setItems(previous)
      toast.error(error)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['questions', orgId] })
  }

  async function handleConfirmDelete() {
    if (modal.type !== 'delete' || !modal.payload || !orgId) {
      return
    }
    const payload = modal.payload as Question
    setDeleteLoading(true)
    const { error } = await archiveQuestion(payload.id)
    if (error) {
      setDeleteLoading(false)
      toast.error(error)
      return
    }

    const fresh = await getQuestions(orgId)
    const nonEntry = fresh
      .filter((q) => q.question_type !== 'entry')
      .sort((a, b) => a.order_rank - b.order_rank)
    const updates = nonEntry.map((q, idx) => ({ id: q.id, order_rank: idx + 1 }))
    const { error: reorderErr } = await reorderQuestions(updates)
    setDeleteLoading(false)
    if (reorderErr) {
      toast.error(reorderErr)
    } else {
      toast.success('Question removed')
    }
    await queryClient.invalidateQueries({ queryKey: ['questions', orgId] })
    setModal({ type: null })
  }

  const editPayload = modal.type === 'edit' && modal.payload ? (modal.payload as Question) : null
  const previewPayload = modal.type === 'preview' && modal.payload ? (modal.payload as Question) : null

  function toggleLocationId(id: string) {
    setAddLocationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const stepPill = (n: 1 | 2 | 3, label: string) => (
    <span
      className={
        addStep === n
          ? 'rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white'
          : 'rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500'
      }
    >
      {n} {label}
    </span>
  )

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLogicTesterOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <FlaskConical className="h-4 w-4" />
            Test Logic
          </button>
          <button
            type="button"
            onClick={() => setModal({ type: 'add' })}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            Add Question
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="mb-3 text-xs text-slate-500">System Components — Click to add to your question flow</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={systemCardsDisabled || hasSystemQuestion.location}
            onClick={() => void handleSystemLocationCard()}
            className="flex flex-1 min-w-[200px] cursor-pointer items-start gap-3 rounded-xl border-2 border-blue-200 bg-white p-4 text-left hover:bg-blue-50/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
          >
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
            <div>
              <div className="text-sm font-medium text-slate-900">Location Selector</div>
              <div className="text-xs text-slate-500">
                {hasSystemQuestion.location ? 'Already in your flow' : 'Ask patients which office they prefer'}
              </div>
            </div>
          </button>
          <button
            type="button"
            disabled={systemCardsDisabled || hasSystemQuestion.provider}
            onClick={() => void handleSystemProviderCard()}
            className="flex flex-1 min-w-[200px] cursor-pointer items-start gap-3 rounded-xl border-2 border-purple-200 bg-white p-4 text-left hover:bg-purple-50/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
          >
            <User className="mt-0.5 h-5 w-5 shrink-0 text-purple-500" />
            <div>
              <div className="text-sm font-medium text-slate-900">Preferred Provider</div>
              <div className="text-xs text-slate-500">
                {hasSystemQuestion.provider ? 'Already in your flow' : 'Ask if they know who they want to see'}
              </div>
            </div>
          </button>
        </div>
      </div>

      {isLoading && allQuestions.length === 0 ? (
        <p className="text-sm text-slate-500">Loading questions…</p>
      ) : (
        <>
          {entryQuestion ? (
            <div className="mb-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded bg-slate-100 px-1.5 text-xs font-medium text-slate-600">
                1
              </span>
              <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">Entry</span>
              <Lock className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
              <span className="flex-1 text-sm font-medium text-slate-900">{entryQuestion.question_text}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">Entry</span>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-600"
                aria-label="Preview"
                onClick={() => entryQuestion && setModal({ type: 'preview', payload: entryQuestion })}
              >
                <Eye className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-600"
                aria-label="Edit"
                onClick={() => entryQuestion && setModal({ type: 'edit', payload: entryQuestion })}
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="mb-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              Preparing entry question…
            </div>
          )}

          {items.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              No questions added yet. Click &apos;Add Question&apos; or add a system component above.
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={items.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                {items.map((question, index) => {
                  const orderLabel = String(index + 2)
                  const cName =
                    question.constraint_id && question.question_type === 'clinical'
                      ? constraintMap.get(question.constraint_id) ?? null
                      : null
                  return (
                    <SortableQuestionRow
                      key={question.id}
                      question={question}
                      orderLabel={orderLabel}
                      constraintName={cName}
                      onPreview={() => setModal({ type: 'preview', payload: question })}
                      onEdit={() => setModal({ type: 'edit', payload: question })}
                      onDelete={() => setModal({ type: 'delete', payload: question })}
                    />
                  )
                })}
              </SortableContext>
            </DndContext>
          )}
        </>
      )}

      {(modal.type === 'add' ||
        (modal.type === 'edit' && editPayload && editPayload.question_type !== 'entry')) ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onMouseDown={() => setModal({ type: null })} />
          <div
            className="relative mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-100 p-6">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold text-slate-900">
                  {modal.type === 'add' ? 'Add Question' : 'Edit Question'}
                </h2>
                <button
                  type="button"
                  onClick={() => setModal({ type: null })}
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-3 flex gap-2">
                {stepPill(1, 'Type')}
                {stepPill(2, 'Configure')}
                {stepPill(3, 'Preview')}
              </div>
            </div>

            <div className="p-6">
              {addStep === 1 && modal.type === 'edit' && editPayload ? (
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-700">Question type</p>
                  <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium capitalize text-slate-700">
                    {editPayload.question_type}
                  </span>
                  <p className="mt-3 text-xs text-slate-500">Type cannot be changed. Use Next to edit details.</p>
                </div>
              ) : null}

              {addStep === 1 && modal.type === 'add' ? (
                <div>
                  <p className="mb-3 text-sm font-medium text-slate-700">What kind of question?</p>
                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setAddType('clinical')
                        setAddError('')
                      }}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 text-left ${
                        addType === 'clinical'
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <Stethoscope className="mt-0.5 h-5 w-5 shrink-0 text-slate-700" />
                      <div>
                        <div className="text-sm font-medium text-slate-900">Clinical Question</div>
                        <div className="text-xs text-slate-500">Link to a constraint to filter providers</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      disabled={hasSystemQuestion.location}
                      onClick={() => {
                        setAddType('location')
                        setAddError('')
                      }}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                        addType === 'location'
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
                      <div>
                        <div className="text-sm font-medium text-slate-900">Location Selector</div>
                        <div className="text-xs text-slate-500">
                          {hasSystemQuestion.location ? 'Already in your flow' : 'Ask which office they prefer'}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      disabled={hasSystemQuestion.provider}
                      onClick={() => {
                        setAddType('provider')
                        setAddError('')
                      }}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                        addType === 'provider'
                          ? 'border-purple-500 bg-purple-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <User className="mt-0.5 h-5 w-5 shrink-0 text-purple-500" />
                      <div>
                        <div className="text-sm font-medium text-slate-900">Preferred Provider</div>
                        <div className="text-xs text-slate-500">
                          {hasSystemQuestion.provider ? 'Already in your flow' : 'Ask if they know who they want to see'}
                        </div>
                      </div>
                    </button>
                  </div>
                  {addError ? <p className="mt-3 text-sm text-red-600">{addError}</p> : null}
                </div>
              ) : null}

              {addStep === 2 && addType === 'clinical' && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Select Constraint</label>
                    <select
                      value={addConstraintId ?? ''}
                      onChange={(e) => {
                        const v = e.target.value
                        if (!v) {
                          setAddConstraintId(null)
                          return
                        }
                        handleConstraintSelect(v)
                      }}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">Choose a constraint…</option>
                      {constraints.map((c: Constraint) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.type})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Question Text</label>
                    <input
                      type="text"
                      value={addFormData.question_text}
                      onChange={(e) => setAddFormData((p) => ({ ...p, question_text: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Subtext (optional)</label>
                    <input
                      type="text"
                      value={addFormData.subtext}
                      onChange={(e) => setAddFormData((p) => ({ ...p, subtext: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={addFormData.required}
                      onChange={(e) => setAddFormData((p) => ({ ...p, required: e.target.checked }))}
                    />
                    Required
                  </label>
                  {selectedConstraint?.type === 'binary' && (
                    <p className="text-sm text-slate-600">Input: Yes/No Buttons (forced)</p>
                  )}
                  {selectedConstraint?.type === 'range' && (
                    <p className="text-sm text-slate-600">Input: Number Field (forced)</p>
                  )}
                  {selectedConstraint?.type === 'exact' && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-slate-700">Input style</p>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={modal.type === 'edit' ? 'exact-input-edit' : 'exact-input-add'}
                          checked={addFormData.input_type === 'buttons'}
                          onChange={() => setAddFormData((p) => ({ ...p, input_type: 'buttons' }))}
                        />
                        Buttons
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={modal.type === 'edit' ? 'exact-input-edit' : 'exact-input-add'}
                          checked={addFormData.input_type === 'dropdown'}
                          onChange={() => setAddFormData((p) => ({ ...p, input_type: 'dropdown' }))}
                        />
                        Dropdown
                      </label>
                    </div>
                  )}
                  {addError ? <p className="text-sm text-red-600">{addError}</p> : null}
                </div>
              )}

              {addStep === 2 && addType === 'location' && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Question Text</label>
                    <input
                      type="text"
                      value={addFormData.question_text}
                      onChange={(e) => setAddFormData((p) => ({ ...p, question_text: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Subtext (optional)</label>
                    <input
                      type="text"
                      value={addFormData.subtext}
                      onChange={(e) => setAddFormData((p) => ({ ...p, subtext: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={addFormData.required}
                      onChange={(e) => setAddFormData((p) => ({ ...p, required: e.target.checked }))}
                    />
                    Required
                  </label>
                  <div>
                    <p className="mb-2 text-sm font-medium text-slate-700">Locations to show</p>
                    <label className="mr-4 text-sm">
                      <input
                        type="radio"
                        name="loc-filter"
                        checked={addLocationFilter === 'all'}
                        onChange={() => setAddLocationFilter('all')}
                        className="mr-1"
                      />
                      All locations
                    </label>
                    <label className="text-sm">
                      <input
                        type="radio"
                        name="loc-filter"
                        checked={addLocationFilter === 'specific'}
                        onChange={() => setAddLocationFilter('specific')}
                        className="mr-1"
                      />
                      Specific locations
                    </label>
                  </div>
                  {addLocationFilter === 'specific' ? (
                    <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3">
                      {locations.map((loc) => (
                        <label key={loc.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={addLocationIds.includes(loc.id)}
                            onChange={() => toggleLocationId(loc.id)}
                          />
                          {loc.name}
                        </label>
                      ))}
                    </div>
                  ) : null}
                  {addError ? <p className="text-sm text-red-600">{addError}</p> : null}
                </div>
              )}

              {addStep === 2 && addType === 'provider' && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Question Text</label>
                    <input
                      type="text"
                      value={addFormData.question_text}
                      onChange={(e) => setAddFormData((p) => ({ ...p, question_text: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Subtext (optional)</label>
                    <input
                      type="text"
                      value={addFormData.subtext}
                      onChange={(e) => setAddFormData((p) => ({ ...p, subtext: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={addFormData.required}
                      onChange={(e) => setAddFormData((p) => ({ ...p, required: e.target.checked }))}
                    />
                    Required
                  </label>
                  {addError ? <p className="text-sm text-red-600">{addError}</p> : null}
                </div>
              )}

              {addStep === 3 && addType && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-slate-100 p-4">
                    <p className="text-sm font-medium text-slate-900">{addFormData.question_text}</p>
                    {addFormData.subtext.trim() ? (
                      <p className="mt-1 text-xs text-slate-600">{addFormData.subtext}</p>
                    ) : null}
                  </div>

                  {addType === 'clinical' && selectedConstraint?.type === 'binary' && (
                    <div className="flex gap-2">
                      <button type="button" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
                        {selectedConstraint.yes_label || 'Yes'}
                      </button>
                      <button type="button" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
                        {selectedConstraint.no_label || 'No'}
                      </button>
                    </div>
                  )}
                  {addType === 'clinical' && selectedConstraint?.type === 'range' && (
                    <input
                      type="number"
                      readOnly
                      placeholder="Enter a number"
                      className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  )}
                  {addType === 'clinical' && selectedConstraint?.type === 'exact' && addFormData.input_type === 'buttons' && (
                    <div className="flex gap-2">
                      <button type="button" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
                        Option A
                      </button>
                      <button type="button" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
                        Option B
                      </button>
                    </div>
                  )}
                  {addType === 'clinical' && selectedConstraint?.type === 'exact' && addFormData.input_type === 'dropdown' && (
                    <select className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm" disabled>
                      <option>Select…</option>
                    </select>
                  )}

                  {addType === 'location' && (
                    <select className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm" disabled>
                      <option>
                        {addLocationFilter === 'all'
                          ? 'All locations'
                          : addLocationIds.length
                            ? locations
                                .filter((l) => addLocationIds.includes(l.id))
                                .map((l) => l.name)
                                .join(', ') || 'Select locations'
                            : 'Select locations'}
                      </option>
                    </select>
                  )}

                  {addType === 'provider' && (
                    <div className="flex gap-2">
                      <button type="button" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
                        Yes
                      </button>
                      <button type="button" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
                        No
                      </button>
                    </div>
                  )}

                  {addError ? <p className="text-sm text-red-600">{addError}</p> : null}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 p-6">
              <div>
                {addStep > 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAddError('')
                      setAddStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))
                    }}
                    className="text-sm font-medium text-slate-600 hover:text-slate-900"
                  >
                    Back
                  </button>
                ) : null}
              </div>
              <div>
                {addStep < 3 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (addStep === 1) {
                        goNextFromStep1()
                      } else {
                        goNextFromStep2()
                      }
                    }}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    Next →
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={modal.type === 'edit' ? editIsSaving : addIsSaving}
                    onClick={() =>
                      void (modal.type === 'edit' ? handleSaveNonEntryEdit() : handleSaveNewQuestion())
                    }
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {(modal.type === 'edit' ? editIsSaving : addIsSaving) ? (
                      <>
                        <LoadingSpinner size="sm" className="border-white border-t-transparent" />
                        Saving…
                      </>
                    ) : (
                      'Save Question'
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {modal.type === 'edit' && editPayload?.question_type === 'entry' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onMouseDown={() => setModal({ type: null })} />
          <div
            className="relative mx-4 w-full max-w-lg rounded-xl bg-white shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-slate-100 p-6">
              <h2 className="font-semibold text-slate-900">Edit Question</h2>
              <button
                type="button"
                onClick={() => setModal({ type: null })}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Question Text</label>
                <input
                  type="text"
                  value={entryEditForm.question_text}
                  onChange={(e) => setEntryEditForm((p) => ({ ...p, question_text: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Input Type</label>
                <select
                  value={entryEditForm.input_type}
                  onChange={(e) =>
                    setEntryEditForm((p) => ({
                      ...p,
                      input_type: e.target.value as Question['input_type'],
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="buttons">Buttons</option>
                  <option value="dropdown">Dropdown</option>
                  <option value="number">Number</option>
                </select>
              </div>
              {addError ? <p className="text-sm text-red-600">{addError}</p> : null}
            </div>
            <div className="flex justify-end border-t border-slate-100 p-6">
              <button
                type="button"
                disabled={editIsSaving}
                onClick={() => void handleSaveEntryEdit()}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {editIsSaving ? (
                  <>
                    <LoadingSpinner size="sm" className="border-white border-t-transparent" />
                    Saving…
                  </>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modal.type === 'preview' && previewPayload ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onMouseDown={() => setModal({ type: null })} />
          <div
            className="relative mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="font-semibold text-slate-900">Question Preview</h2>
              <button
                type="button"
                onClick={() => setModal({ type: null })}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              This is a preview of how this question appears in the widget
            </div>
            <div className="mb-4 rounded-xl bg-slate-100 p-4">
              <p className="text-sm font-medium text-slate-900">{previewPayload.question_text}</p>
              {previewPayload.subtext ? (
                <p className="mt-1 text-xs text-slate-600">{previewPayload.subtext}</p>
              ) : null}
            </div>
            <WidgetQuestionPreview
              question={previewPayload}
              constraints={constraints}
              locations={locations}
              caseTypes={caseTypes}
            />
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setModal({ type: null })}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={modal.type === 'delete'}
        title="Remove Question"
        message="Remove this question from the flow?"
        confirmLabel="Remove"
        confirmVariant="danger"
        isLoading={deleteLoading}
        onConfirm={handleConfirmDelete}
        onCancel={() => setModal({ type: null })}
      />

      {/* Mounted only while open, so each session starts from clean state
          rather than the component resetting itself from an effect. */}
      {logicTesterOpen ? (
        <LogicTester onClose={() => setLogicTesterOpen(false)} orgId={orgId} />
      ) : null}
    </div>
  )
}
