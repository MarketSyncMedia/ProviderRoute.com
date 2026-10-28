import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { GripVertical, Lock } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useToast } from '../../components/ui/toastStore'
import { getCaseTypes } from '../../lib/api/caseTypes'
import { getLocations } from '../../lib/api/locations'
import { getProviders } from '../../lib/api/providers'
import { getQuestions } from '../../lib/api/questions'
import { getWidget, publishWidget, unpublishWidget, updateWidget, uploadWidgetIcon } from '../../lib/api/widgets'
import { reconcileQuestionOrder } from '../../lib/widgetConfig'
import { approvedHttpsUrl } from '../../lib/approvedUrl'
import { normalizeApprovedDomain } from '../../lib/approvedDomain'
import { readableTextColor } from '../../shared/colorContrast'
import { useAuthStore } from '../../stores/authStore'
import type { Question, Widget } from '../../types/database'

type ActiveTab = 'scope' | 'questions' | 'appearance' | 'publish'
type SaveStatus = 'idle' | 'saving' | 'saved'

function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean)
  const a = w[0]?.[0] ?? ''
  const b = w.length > 1 ? w[w.length - 1]?.[0] ?? '' : w[0]?.[1] ?? ''
  return `${a}${b}`.toUpperCase() || name.slice(0, 2).toUpperCase()
}

function omitMeta(c: Partial<Widget>): Partial<Widget> {
  const { id: _i, created_at: _c, updated_at: _u, ...rest } = c as Widget
  return rest
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

// A handful of common symbols (☎ ✈ ✂ etc.) default to plain "text"
// presentation — a colorless glyph that here would inherit the preview
// button's white text color and become invisible. The emoji variation
// selector (U+FE0F) forces color presentation; it's a no-op on characters
// (like 👋) that already always render in color. Mirrors widget.js so the
// preview matches what actually ships.
const EMOJI_VARIATION_SELECTOR = '️'
function withEmojiPresentation(value: string): string {
  return value.endsWith(EMOJI_VARIATION_SELECTOR) ? value : `${value}${EMOJI_VARIATION_SELECTOR}`
}

function normalizeHex(v: string): string | null {
  const s = v.trim()
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) {
    return s
  }
  if (/^[0-9A-Fa-f]{6}$/.test(s)) {
    return `#${s}`
  }
  return null
}

function SortableScopedQuestion({
  question,
  orderNum,
  onToggle,
}: {
  question: Question
  orderNum: number
  onToggle: (checked: boolean) => void
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
      className="mb-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
    >
      <span className="flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded bg-slate-100 px-1.5 text-xs font-medium text-slate-600">
        {orderNum}
      </span>
      <button
        type="button"
        className="touch-none shrink-0 cursor-grab text-slate-300 hover:text-slate-400 active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked
          onChange={(e) => onToggle(e.target.checked)}
          onPointerDown={(e) => e.stopPropagation()}
          className="mt-0.5 rounded border-slate-300 text-indigo-600"
        />
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-slate-900">{question.question_text}</span>
        </div>
      </label>
      <span
        className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${typeBadgeClass(question.question_type)}`}
      >
        {question.question_type}
      </span>
    </div>
  )
}

export default function WidgetBuilderPage() {
  const { id } = useParams<{ id: string }>()
  const organization = useAuthStore((s) => s.org)
  const orgId = organization?.id ?? ''
  const queryClient = useQueryClient()
  const { toast: toastApi } = useToast()

  const [config, setConfig] = useState<Partial<Widget>>({})
  const [activeTab, setActiveTab] = useState<ActiveTab>('scope')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [providerSearch, setProviderSearch] = useState('')
  const [providerScopeUi, setProviderScopeUi] = useState<'all' | 'specific'>('all')
  const [caseTypeScopeUi, setCaseTypeScopeUi] = useState<'all' | 'specific'>('all')
  const [locationScopeUi, setLocationScopeUi] = useState<'all' | 'specific'>('all')
  const [modal, setModal] = useState<{ type: 'publish' | 'unpublish' | null }>({ type: null })
  const [actionLoading, setActionLoading] = useState(false)
  const [embedCopied, setEmbedCopied] = useState(false)
  const [iconUploading, setIconUploading] = useState(false)

  // The last config known to match the server. State, not a ref: it is written
  // during hydration (in render), and a ref write there is not safe under
  // concurrent rendering.
  const [lastPersisted, setLastPersisted] = useState<string | null>(null)
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const { data: widget, isPending: widgetPending } = useQuery({
    queryKey: ['widget', id],
    queryFn: () => getWidget(id!),
    enabled: Boolean(id),
  })

  const { data: providers = [], isPending: providersPending } = useQuery({
    queryKey: ['providers', orgId],
    queryFn: () => getProviders(orgId),
    enabled: Boolean(orgId),
  })

  const { data: caseTypes = [], isPending: caseTypesPending } = useQuery({
    queryKey: ['case-types', orgId],
    queryFn: () => getCaseTypes(orgId),
    enabled: Boolean(orgId),
  })

  const { data: locations = [], isPending: locationsPending } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => getLocations(orgId),
    enabled: Boolean(orgId),
  })

  const { data: questions = [], isPending: questionsPending } = useQuery({
    queryKey: ['questions', orgId],
    queryFn: () => getQuestions(orgId),
    enabled: Boolean(orgId),
  })

  const scopeDataPending =
    Boolean(widget) && (providersPending || caseTypesPending || locationsPending || questionsPending)

  // Hydrate the editor from the fetched widget during render rather than in a
  // layout effect. The persisted baseline has to be set before the autosave
  // effect below runs, otherwise hydration itself looks like an edit and gets
  // written straight back; doing both in render keeps that ordering guaranteed
  // rather than relying on layout-effects-before-passive-effects.
  const [hydratedWidgetId, setHydratedWidgetId] = useState<string | null>(null)
  if (widget && widget.id !== hydratedWidgetId) {
    const scoped = widget.scoped_question_ids ?? []
    const hydrated: Partial<Widget> = {
      ...widget,
      scoped_question_ids: scoped,
      question_order: reconcileQuestionOrder(widget.question_order, scoped),
    }

    setHydratedWidgetId(widget.id)
    setConfig(hydrated)
    setNameDraft(widget.name)
    setLastPersisted(JSON.stringify(hydrated))
    setProviderScopeUi(widget.scoped_provider_ids.length > 0 ? 'specific' : 'all')
    setCaseTypeScopeUi(widget.scoped_case_type_ids.length > 0 ? 'specific' : 'all')
    setLocationScopeUi(widget.scoped_location_ids.length > 0 ? 'specific' : 'all')
  }

  useEffect(() => {
    if (!id) {
      return
    }
    const serialized = JSON.stringify(config)
    if (!lastPersisted || serialized === lastPersisted) {
      return
    }

    const handle = window.setTimeout(async () => {
      setSaveStatus('saving')
      const { error } = await updateWidget(id, omitMeta(config))
      if (!error) {
        setLastPersisted(serialized)
        setSaveStatus('saved')
        if (saveStatusTimeoutRef.current) {
          clearTimeout(saveStatusTimeoutRef.current)
        }
        saveStatusTimeoutRef.current = setTimeout(() => {
          setSaveStatus('idle')
          saveStatusTimeoutRef.current = null
        }, 2000)
      } else {
        setSaveStatus('idle')
      }
    }, 500)

    return () => clearTimeout(handle)
    // Re-running when the baseline moves is what stops the loop: after a save
    // sets it to the serialized config, the equality check above returns early.
  }, [config, id, lastPersisted])

  const filteredProviders = useMemo(() => {
    const q = providerSearch.trim().toLowerCase()
    if (!q) {
      return providers
    }
    return providers.filter((p) => p.name.toLowerCase().includes(q))
  }, [providers, providerSearch])

  const entryQuestion = useMemo(() => {
    const entries = questions.filter((q) => q.question_type === 'entry').sort((a, b) => a.order_rank - b.order_rank)
    return entries[0] ?? null
  }, [questions])

  const nonEntryQuestions = useMemo(
    () => questions.filter((q) => q.question_type !== 'entry').sort((a, b) => a.order_rank - b.order_rank),
    [questions]
  )

  const questionById = useMemo(() => {
    const m = new Map<string, Question>()
    questions.forEach((q) => m.set(q.id, q))
    return m
  }, [questions])

  const scopedSet = useMemo(() => new Set(config.scoped_question_ids ?? []), [config.scoped_question_ids])

  const selectedOrderIds = useMemo(() => {
    const order = (config.question_order ?? []) as string[]
    const scoped = config.scoped_question_ids ?? []
    const filtered = order.filter((qid) => scoped.includes(qid))
    for (const qid of scoped) {
      if (!filtered.includes(qid)) {
        filtered.push(qid)
      }
    }
    return filtered
  }, [config.question_order, config.scoped_question_ids])

  const unselectedNonEntry = useMemo(
    () => nonEntryQuestions.filter((q) => !scopedSet.has(q.id)),
    [nonEntryQuestions, scopedSet]
  )

  const toggleQuestion = useCallback((qid: string, checked: boolean) => {
    setConfig((c) => {
      const cur = c.scoped_question_ids ?? []
      let order = (c.question_order ?? []) as string[]
      if (checked) {
        const next = [...new Set([...cur, qid])]
        if (!order.includes(qid)) {
          order = [...order, qid]
        }
        return { ...c, scoped_question_ids: next, question_order: order }
      }
      return {
        ...c,
        scoped_question_ids: cur.filter((x) => x !== qid),
        question_order: order.filter((x) => x !== qid),
      }
    })
  }, [])

  function handleQuestionsDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) {
      return
    }
    const ids = [...selectedOrderIds]
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) {
      return
    }
    const next = arrayMove(ids, oldIndex, newIndex)
    setConfig((c) => ({ ...c, question_order: next }))
  }

  const startEditName = useCallback(() => {
    setNameDraft(config.name ?? '')
    setEditingName(true)
  }, [config.name])

  const commitName = useCallback(() => {
    const trimmed = nameDraft.trim()
    if (trimmed.length > 0) {
      setConfig((c) => ({ ...c, name: trimmed }))
    }
    setEditingName(false)
  }, [nameDraft])

  const status = config.status ?? widget?.status ?? 'draft'
  const primaryColor = config.primary_color ?? widget?.primary_color ?? '#4F46E5'
  const brandTextColor = readableTextColor(primaryColor)
  const greeting = (config.greeting_text ?? widget?.greeting_text ?? '').trim() || 'Find a Provider'
  const buttonText = (config.button_text ?? widget?.button_text ?? '').trim() || 'Find a Provider'
  const buttonSubtext = (config.button_subtext ?? widget?.button_subtext ?? '').trim()
  const buttonIconType = config.button_icon_type ?? widget?.button_icon_type ?? 'none'
  const buttonIconValue = config.button_icon_value ?? widget?.button_icon_value ?? ''
  const buttonAnimation = config.button_animation ?? widget?.button_animation ?? 'none'
  const embedMode = config.embed_mode ?? widget?.embed_mode ?? 'floating'

  const reqProvidersOk =
    providerScopeUi === 'all' ||
    (providerScopeUi === 'specific' && (config.scoped_provider_ids ?? []).length >= 1)
  const reqCaseTypesOk =
    caseTypeScopeUi === 'all' ||
    (caseTypeScopeUi === 'specific' && (config.scoped_case_type_ids ?? []).length >= 1)
  const reqEntryOk = Boolean(entryQuestion)
  const allRequirementsMet = reqProvidersOk && reqCaseTypesOk && reqEntryOk

  const widgetScriptUrl = approvedHttpsUrl(import.meta.env.VITE_WIDGET_SCRIPT_URL)
  const embedScript = id && widgetScriptUrl
    ? `<script src="${widgetScriptUrl}" data-widget-id="${id}"></script>`
    : ''

  async function handleIconUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !id || !orgId) {
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toastApi.error('Image must be under 5MB')
      return
    }
    setIconUploading(true)
    const { url, error } = await uploadWidgetIcon(id, orgId, file)
    setIconUploading(false)
    if (error || !url) {
      toastApi.error(error ?? 'Failed to upload image')
      return
    }
    setConfig((c) => ({ ...c, button_icon_value: url }))
  }

  async function copyEmbedCode() {
    if (!embedScript) {
      return
    }
    try {
      await navigator.clipboard.writeText(embedScript)
      setEmbedCopied(true)
      window.setTimeout(() => setEmbedCopied(false), 2000)
    } catch {
      setEmbedCopied(false)
    }
  }

  async function handlePublishConfirm() {
    if (!id) {
      return
    }
    if (!organization?.allowed_domains?.some(normalizeApprovedDomain)) {
      toastApi.error('Add at least one approved website domain in Settings before publishing')
      return
    }
    const disclaimerText = (config.disclaimer_text ?? widget?.disclaimer_text ?? '').trim()
    if (!disclaimerText) {
      toastApi.error('Add the required privacy disclaimer before publishing')
      return
    }
    const privacyUrl = approvedHttpsUrl(config.privacy_url ?? widget?.privacy_url)
    if (!privacyUrl) {
      toastApi.error('Add an absolute HTTPS privacy notice URL before publishing')
      return
    }
    setActionLoading(true)
    const entryQuestionId = questions.find((q) => q.question_type === 'entry')?.id
    const scopedQuestionIdsBase = config.scoped_question_ids ?? []
    const scopedQuestionIds =
      entryQuestionId && !scopedQuestionIdsBase.includes(entryQuestionId)
        ? [...scopedQuestionIdsBase, entryQuestionId]
        : scopedQuestionIdsBase
    const snapshot = {
      scoped_provider_ids: config.scoped_provider_ids ?? [],
      scoped_case_type_ids: config.scoped_case_type_ids ?? [],
      scoped_location_ids: config.scoped_location_ids ?? [],
      scoped_question_ids: scopedQuestionIds,
      question_order: config.question_order ?? [],
      primary_color: config.primary_color ?? widget?.primary_color ?? '#4F46E5',
      button_text: config.button_text ?? widget?.button_text ?? 'Find a Provider',
      greeting_text: config.greeting_text ?? widget?.greeting_text ?? '',
      disclaimer_text: disclaimerText,
      privacy_url: privacyUrl,
      embed_mode: config.embed_mode ?? widget?.embed_mode ?? 'floating',
      show_worth_the_drive: config.show_worth_the_drive ?? widget?.show_worth_the_drive ?? true,
      open_delay_enabled: config.open_delay_enabled ?? widget?.open_delay_enabled ?? false,
      open_delay_seconds: config.open_delay_seconds ?? widget?.open_delay_seconds ?? 5,
      button_animation: config.button_animation ?? widget?.button_animation ?? 'none',
      button_subtext: config.button_subtext ?? widget?.button_subtext ?? null,
      button_icon_type: config.button_icon_type ?? widget?.button_icon_type ?? 'none',
      button_icon_value: config.button_icon_value ?? widget?.button_icon_value ?? null,
    }
    const { error } = await publishWidget(id, snapshot)
    setActionLoading(false)
    if (error) {
      toastApi.error(error)
      return
    }
    // Publishing already persisted this, so move the baseline with it —
    // otherwise the autosave effect sees a diff and writes straight back.
    const published: Partial<Widget> = {
      ...config,
      status: 'live' as const,
      published_at: new Date().toISOString(),
      published_snapshot: snapshot,
    }
    setConfig(published)
    setLastPersisted(JSON.stringify(published))
    await queryClient.invalidateQueries({ queryKey: ['widget', id] })
    await queryClient.invalidateQueries({ queryKey: ['widgets', orgId] })
    setModal({ type: null })
    toastApi.success('Widget is now live!')
  }

  async function handleUnpublishConfirm() {
    if (!id) {
      return
    }
    setActionLoading(true)
    const { error } = await unpublishWidget(id)
    setActionLoading(false)
    if (error) {
      toastApi.error(error)
      return
    }
    const unpublished: Partial<Widget> = {
      ...config,
      status: 'draft' as const,
      published_at: null,
      published_snapshot: null,
    }
    setConfig(unpublished)
    setLastPersisted(JSON.stringify(unpublished))
    await queryClient.invalidateQueries({ queryKey: ['widget', id] })
    await queryClient.invalidateQueries({ queryKey: ['widgets', orgId] })
    setModal({ type: null })
    toastApi.success('Widget unpublished.')
  }

  if (!id) {
    return (
      <div className="text-center text-sm text-slate-600">
        <p>Invalid widget.</p>
        <Link to="/widgets" className="mt-2 inline-block text-indigo-600 hover:text-indigo-800">
          Back to widgets
        </Link>
      </div>
    )
  }

  if (widgetPending) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!widget) {
    return (
      <div className="text-center text-sm text-slate-600">
        <p>Widget not found</p>
        <Link to="/widgets" className="mt-2 inline-block text-indigo-600 hover:text-indigo-800">
          Back to widgets
        </Link>
      </div>
    )
  }

  if (scopeDataPending) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="-m-6 flex h-[calc(100vh-7rem)] flex-col">
      <header className="z-10 flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link to="/widgets" className="shrink-0 text-sm font-medium text-indigo-600 hover:text-indigo-800">
            My Widgets →
          </Link>
          {editingName ? (
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitName()
                }
                if (e.key === 'Escape') {
                  setEditingName(false)
                  setNameDraft(config.name ?? '')
                }
              }}
              className="min-w-0 max-w-md rounded border border-slate-300 px-2 py-1 text-lg font-semibold text-slate-900"
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={startEditName}
              className="truncate text-left text-lg font-semibold text-slate-900 hover:text-indigo-700"
            >
              {config.name ?? widget.name}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {status === 'live' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
              <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
              Live
            </span>
          ) : (
            <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
              Draft
            </span>
          )}
          <span className="text-sm text-slate-500">
            {saveStatus === 'saving' && 'Saving…'}
            {saveStatus === 'saved' && 'Saved'}
            {saveStatus === 'idle' && ''}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <nav className="flex gap-6 border-b border-slate-200 px-6 pt-4">
            {(
              [
                ['scope', 'Scope'],
                ['questions', 'Questions'],
                ['appearance', 'Appearance'],
                ['publish', 'Publish'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={
                  activeTab === key
                    ? '-mb-px border-b-2 border-indigo-600 pb-3 text-sm font-medium text-indigo-600'
                    : 'pb-3 text-sm text-slate-500 hover:text-slate-700'
                }
              >
                {label}
              </button>
            ))}
          </nav>

          {activeTab === 'scope' ? (
            <div className="px-6 pb-6">
              <section>
                <h3 className="text-sm font-medium text-slate-900">Who can this widget route?</h3>
                <div className="mt-3 space-y-3">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="provider-scope"
                      checked={providerScopeUi === 'all'}
                      onChange={() => {
                        setProviderScopeUi('all')
                        setConfig((c) => ({
                          ...c,
                          scoped_provider_ids: [],
                        }))
                      }}
                      className="text-indigo-600"
                    />
                    <span className="text-sm text-slate-800">All providers</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="provider-scope"
                      checked={providerScopeUi === 'specific'}
                      onChange={() => setProviderScopeUi('specific')}
                      className="text-indigo-600"
                    />
                    <span className="text-sm text-slate-800">Select specific providers</span>
                  </label>
                </div>

                {providerScopeUi === 'specific' ? (
                  <div className="mt-4">
                    <input
                      type="search"
                      value={providerSearch}
                      onChange={(e) => setProviderSearch(e.target.value)}
                      placeholder="Search providers…"
                      className="mb-3 w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
                      {filteredProviders.map((p) => {
                        const selected = (config.scoped_provider_ids ?? []).includes(p.id)
                        return (
                          <label
                            key={p.id}
                            className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(e) => {
                                const checked = e.target.checked
                                setConfig((c) => {
                                  const cur = c.scoped_provider_ids ?? []
                                  const next = checked
                                    ? [...new Set([...cur, p.id])]
                                    : cur.filter((x) => x !== p.id)
                                  return { ...c, scoped_provider_ids: next }
                                })
                              }}
                              className="rounded border-slate-300 text-indigo-600"
                            />
                            {p.image_url ? (
                              <img
                                src={p.image_url}
                                alt=""
                                className="h-8 w-8 shrink-0 rounded-full object-cover"
                              />
                            ) : (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                                {initials(p.name)}
                              </div>
                            )}
                            <span className="text-sm text-slate-800">{p.name}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="mt-6">
                <h3 className="text-sm font-medium text-slate-900">Case types</h3>
                <div className="mt-3 space-y-3">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="case-scope"
                      checked={caseTypeScopeUi === 'all'}
                      onChange={() => {
                        setCaseTypeScopeUi('all')
                        setConfig((c) => ({
                          ...c,
                          scoped_case_type_ids: [],
                        }))
                      }}
                      className="text-indigo-600"
                    />
                    <span className="text-sm text-slate-800">All case types</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="case-scope"
                      checked={caseTypeScopeUi === 'specific'}
                      onChange={() => setCaseTypeScopeUi('specific')}
                      className="text-indigo-600"
                    />
                    <span className="text-sm text-slate-800">Select specific</span>
                  </label>
                </div>

                {caseTypeScopeUi === 'specific' ? (
                  <div className="mt-4 max-h-56 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
                    {caseTypes.map((ct) => {
                      const selected = (config.scoped_case_type_ids ?? []).includes(ct.id)
                      return (
                        <label key={ct.id} className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(e) => {
                              const checked = e.target.checked
                              setConfig((c) => {
                                const cur = c.scoped_case_type_ids ?? []
                                const next = checked
                                  ? [...new Set([...cur, ct.id])]
                                  : cur.filter((x) => x !== ct.id)
                                return { ...c, scoped_case_type_ids: next }
                              })
                            }}
                            className="rounded border-slate-300 text-indigo-600"
                          />
                          <span className="text-sm text-slate-800">{ct.name}</span>
                        </label>
                      )
                    })}
                  </div>
                ) : null}
              </section>

              <section className="mt-6">
                <h3 className="text-sm font-medium text-slate-900">Locations</h3>
                <div className="mt-3 space-y-3">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="location-scope"
                      checked={locationScopeUi === 'all'}
                      onChange={() => {
                        setLocationScopeUi('all')
                        setConfig((c) => ({
                          ...c,
                          scoped_location_ids: [],
                        }))
                      }}
                      className="text-indigo-600"
                    />
                    <span className="text-sm text-slate-800">All locations</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="location-scope"
                      checked={locationScopeUi === 'specific'}
                      onChange={() => setLocationScopeUi('specific')}
                      className="text-indigo-600"
                    />
                    <span className="text-sm text-slate-800">Select specific</span>
                  </label>
                </div>

                {locationScopeUi === 'specific' ? (
                  <div className="mt-4 max-h-56 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
                    {locations.map((loc) => {
                      const selected = (config.scoped_location_ids ?? []).includes(loc.id)
                      return (
                        <label key={loc.id} className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(e) => {
                              const checked = e.target.checked
                              setConfig((c) => {
                                const cur = c.scoped_location_ids ?? []
                                const next = checked
                                  ? [...new Set([...cur, loc.id])]
                                  : cur.filter((x) => x !== loc.id)
                                return { ...c, scoped_location_ids: next }
                              })
                            }}
                            className="rounded border-slate-300 text-indigo-600"
                          />
                          <span className="text-sm text-slate-800">{loc.name}</span>
                        </label>
                      )
                    })}
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}

          {activeTab === 'questions' ? (
            <div className="px-6 pb-6">
              <h3 className="text-sm font-medium text-slate-900">Which questions will patients answer?</h3>
              <p className="mb-4 mt-1 text-xs text-slate-500">Entry question is always included</p>

              {entryQuestion ? (
                <div className="mb-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  <span className="flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded bg-slate-100 px-1.5 text-xs font-medium text-slate-600">
                    1
                  </span>
                  <Lock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <input type="checkbox" checked disabled className="rounded border-slate-300 text-indigo-600" />
                  <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">
                    {entryQuestion.question_text}
                  </span>
                  <span className="shrink-0 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                    Entry
                  </span>
                </div>
              ) : (
                <p className="mb-4 text-sm text-amber-700">No entry question found for this organization.</p>
              )}

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleQuestionsDragEnd}>
                <SortableContext items={selectedOrderIds} strategy={verticalListSortingStrategy}>
                  {selectedOrderIds.map((qid, idx) => {
                    const q = questionById.get(qid)
                    if (!q) {
                      return null
                    }
                    return (
                      <SortableScopedQuestion
                        key={qid}
                        question={q}
                        orderNum={idx + 2}
                        onToggle={(checked) => toggleQuestion(qid, checked)}
                      />
                    )
                  })}
                </SortableContext>
              </DndContext>

              {unselectedNonEntry.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {unselectedNonEntry.map((q) => (
                    <div
                      key={q.id}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5"
                    >
                      <span className="w-6 shrink-0" />
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={false}
                          onChange={() => toggleQuestion(q.id, true)}
                          className="rounded border-slate-300 text-indigo-600"
                        />
                        <span className="text-sm font-medium text-slate-900">{q.question_text}</span>
                      </label>
                      <span
                        className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${typeBadgeClass(q.question_type)}`}
                      >
                        {q.question_type}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === 'appearance' ? (
            <div className="px-6 pb-6">
              <h3 className="mb-4 text-sm font-medium text-slate-900">Customize how your widget looks</h3>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Primary Color</label>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setConfig((c) => ({ ...c, primary_color: e.target.value }))}
                      className="h-10 w-10 cursor-pointer rounded-lg border border-slate-200 p-0.5"
                    />
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => {
                        const n = normalizeHex(e.target.value)
                        if (n) {
                          setConfig((c) => ({ ...c, primary_color: n }))
                        } else {
                          setConfig((c) => ({ ...c, primary_color: e.target.value }))
                        }
                      }}
                      onBlur={(e) => {
                        const n = normalizeHex(e.target.value)
                        if (n) {
                          setConfig((c) => ({ ...c, primary_color: n }))
                        }
                      }}
                      className="w-32 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                      placeholder="#4F46E5"
                    />
                  </div>
                </div>

                <div>
                  <span className="mb-2 block text-sm font-medium text-slate-700">Embed Mode</span>
                  <div className="space-y-2">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="embed-mode"
                        checked={embedMode === 'floating'}
                        onChange={() => setConfig((c) => ({ ...c, embed_mode: 'floating' }))}
                        className="text-indigo-600"
                      />
                      <span className="text-sm text-slate-800">Floating Button</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="embed-mode"
                        checked={embedMode === 'inline'}
                        onChange={() => setConfig((c) => ({ ...c, embed_mode: 'inline' }))}
                        className="text-indigo-600"
                      />
                      <span className="text-sm text-slate-800">Inline Container</span>
                    </label>
                  </div>
                </div>

                {embedMode === 'floating' ? (
                  <>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Button Text</label>
                      <input
                        type="text"
                        value={config.button_text ?? widget.button_text ?? 'Find a Provider'}
                        onChange={(e) => setConfig((c) => ({ ...c, button_text: e.target.value }))}
                        className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder="Find a Provider"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Button Subtext (optional)</label>
                      <input
                        type="text"
                        value={config.button_subtext ?? widget.button_subtext ?? ''}
                        onChange={(e) =>
                          setConfig((c) => ({ ...c, button_subtext: e.target.value || null }))
                        }
                        className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder="Takes less than 60 seconds"
                      />
                      <p className="mt-1 text-xs text-slate-500">A smaller line under the button text.</p>
                    </div>

                    <div>
                      <span className="mb-2 block text-sm font-medium text-slate-700">Button Icon</span>
                      <div className="flex flex-wrap gap-4">
                        {(
                          [
                            ['none', 'None'],
                            ['emoji', 'Emoji'],
                            ['image', 'Photo'],
                          ] as const
                        ).map(([value, label]) => (
                          <label key={value} className="flex cursor-pointer items-center gap-2">
                            <input
                              type="radio"
                              name="button-icon-type"
                              checked={(config.button_icon_type ?? widget.button_icon_type ?? 'none') === value}
                              onChange={() => setConfig((c) => ({ ...c, button_icon_type: value }))}
                              className="text-indigo-600"
                            />
                            <span className="text-sm text-slate-800">{label}</span>
                          </label>
                        ))}
                      </div>
                      {(config.button_icon_type ?? widget.button_icon_type) === 'emoji' ? (
                        <input
                          type="text"
                          value={config.button_icon_value ?? (widget.button_icon_type === 'emoji' ? widget.button_icon_value ?? '' : '')}
                          onChange={(e) => setConfig((c) => ({ ...c, button_icon_value: e.target.value }))}
                          // maxLength counts UTF-16 code units, not emoji — a
                          // family or skin-toned emoji is a multi-character ZWJ
                          // sequence that needs well over 8 units. A low limit
                          // here truncates mid-sequence and breaks it.
                          maxLength={32}
                          className="mt-3 w-20 rounded-lg border border-slate-300 px-3 py-2 text-center text-lg"
                          placeholder="👋"
                        />
                      ) : null}
                      {(config.button_icon_type ?? widget.button_icon_type) === 'image' ? (
                        <div className="mt-3 flex items-center gap-3">
                          {(() => {
                            const iconUrl =
                              config.button_icon_value ??
                              (widget.button_icon_type === 'image' ? widget.button_icon_value : null)
                            return iconUrl ? (
                              <img src={iconUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                            ) : null
                          })()}
                          <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                            {iconUploading ? 'Uploading…' : 'Upload Photo'}
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png,.webp"
                              className="hidden"
                              onChange={(e) => void handleIconUpload(e)}
                              disabled={iconUploading}
                            />
                          </label>
                        </div>
                      ) : null}
                      <p className="mt-1 text-xs text-slate-500">
                        Shown to the left of the button text — a waving-hand emoji or a real photo can make it feel
                        like there&apos;s a person on the other end.
                      </p>
                    </div>

                    <div>
                      <span className="mb-2 block text-sm font-medium text-slate-700">Hover Animation</span>
                      <select
                        value={config.button_animation ?? widget.button_animation ?? 'none'}
                        onChange={(e) =>
                          setConfig((c) => ({
                            ...c,
                            button_animation: e.target.value as Widget['button_animation'],
                          }))
                        }
                        className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="none">None</option>
                        <option value="shake">Shake</option>
                        <option value="wobble">Wobble</option>
                        <option value="pulse">Pulse</option>
                        <option value="bounce">Bounce</option>
                      </select>
                      <p className="mt-1 text-xs text-slate-500">A subtle motion when someone hovers the button.</p>
                    </div>

                    <div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={config.open_delay_enabled ?? widget.open_delay_enabled ?? false}
                          onClick={() =>
                            setConfig((c) => ({
                              ...c,
                              open_delay_enabled: !(c.open_delay_enabled ?? widget.open_delay_enabled ?? false),
                            }))
                          }
                          className={[
                            'relative h-6 w-11 shrink-0 rounded-full transition',
                            config.open_delay_enabled ?? widget.open_delay_enabled ? 'bg-indigo-600' : 'bg-slate-200',
                          ].join(' ')}
                        >
                          <span
                            className={[
                              'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                              config.open_delay_enabled ?? widget.open_delay_enabled ? 'translate-x-5' : 'translate-x-0',
                            ].join(' ')}
                          />
                        </button>
                        <span className="text-sm text-slate-800">Delay before the button appears</span>
                      </div>
                      {config.open_delay_enabled ?? widget.open_delay_enabled ? (
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={300}
                            value={config.open_delay_seconds ?? widget.open_delay_seconds ?? 5}
                            onChange={(e) => {
                              const n = Math.max(0, Math.min(300, Math.round(Number(e.target.value) || 0)))
                              setConfig((c) => ({ ...c, open_delay_seconds: n }))
                            }}
                            className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                          <span className="text-sm text-slate-600">seconds before it pops up</span>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Greeting Text</label>
                  <textarea
                    rows={3}
                    value={config.greeting_text ?? widget.greeting_text ?? ''}
                    onChange={(e) => setConfig((c) => ({ ...c, greeting_text: e.target.value }))}
                    className="w-full max-w-lg rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Privacy Disclaimer (required)</label>
                  <textarea
                    rows={2}
                    value={config.disclaimer_text ?? widget.disclaimer_text ?? ''}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        disclaimer_text: e.target.value || null,
                      }))
                    }
                    className="w-full max-w-lg rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <p className="mt-1 max-w-lg text-xs text-slate-500">
                    Explain how answers are used; the approved notice is linked separately below.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Privacy Notice URL (required)</label>
                  <input
                    type="url"
                    inputMode="url"
                    placeholder="https://www.example.com/privacy"
                    value={config.privacy_url ?? widget.privacy_url ?? ''}
                    onChange={(e) => setConfig((c) => ({ ...c, privacy_url: e.target.value || null }))}
                    className="w-full max-w-lg rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={config.show_worth_the_drive ?? widget.show_worth_the_drive ?? false}
                      onClick={() =>
                        setConfig((c) => ({
                          ...c,
                          show_worth_the_drive: !(c.show_worth_the_drive ?? widget.show_worth_the_drive ?? false),
                        }))
                      }
                      className={[
                        'relative h-6 w-11 shrink-0 rounded-full transition',
                        config.show_worth_the_drive ?? widget.show_worth_the_drive ? 'bg-indigo-600' : 'bg-slate-200',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                          config.show_worth_the_drive ?? widget.show_worth_the_drive ? 'translate-x-5' : 'translate-x-0',
                        ].join(' ')}
                      />
                    </button>
                    <span className="text-sm text-slate-800">Show providers outside the selected location</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    When on, a patient who picks a location still sees matching providers at other locations, in a
                    clearly-labeled "Not at [location]" section below the local results — never mixed in as if they
                    were local. Turn this off to only ever show providers at the selected location.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'publish' ? (
            <div className="px-6 pb-6">
              {status === 'live' ? (
                <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-900">
                  LIVE — Widget is active
                </div>
              ) : (
                <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm font-medium text-yellow-900">
                  DRAFT — Widget is not yet live
                </div>
              )}

              {status === 'draft' ? (
                <>
                  <ul className="mb-6 space-y-2 text-sm text-slate-700">
                    <li className="flex items-center gap-2">
                      {reqProvidersOk ? (
                        <span className="text-green-600" aria-hidden>
                          ✓
                        </span>
                      ) : (
                        <span className="text-slate-400">○</span>
                      )}
                      At least 1 provider in scope
                    </li>
                    <li className="flex items-center gap-2">
                      {reqCaseTypesOk ? (
                        <span className="text-green-600" aria-hidden>
                          ✓
                        </span>
                      ) : (
                        <span className="text-slate-400">○</span>
                      )}
                      At least 1 case type in scope
                    </li>
                    <li className="flex items-center gap-2">
                      {reqEntryOk ? (
                        <span className="text-green-600" aria-hidden>
                          ✓
                        </span>
                      ) : (
                        <span className="text-slate-400">○</span>
                      )}
                      Entry question configured
                    </li>
                  </ul>
                  <button
                    type="button"
                    disabled={!allRequirementsMet}
                    onClick={() => setModal({ type: 'publish' })}
                    className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Publish Widget
                  </button>
                </>
              ) : (
                <>
                  {embedScript ? (
                    <pre className="mb-3 overflow-x-auto rounded-xl bg-slate-900 p-4 font-mono text-sm text-green-400">
                      {embedScript}
                    </pre>
                  ) : (
                    <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                      Widget delivery is not configured. Set VITE_WIDGET_SCRIPT_URL to the approved company-owned HTTPS asset URL.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void copyEmbedCode()}
                    className="mb-6 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                  >
                    {embedCopied ? 'Copied!' : 'Copy Code'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModal({ type: 'unpublish' })}
                    className="w-full rounded-lg border-2 border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Unpublish Widget
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>

        <aside className="w-full shrink-0 overflow-y-auto border-t border-slate-200 bg-slate-50 lg:w-96 lg:border-l lg:border-t-0">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Preview</h2>
            <p className="text-xs text-slate-500">Updates as you configure</p>
          </div>

          {embedMode === 'floating' ? (
            <div className="relative m-4 min-h-[220px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="min-h-[180px] bg-slate-50 p-4">
                <p className="text-sm text-slate-500">How the button will look on your site</p>
                {config.open_delay_enabled ?? widget.open_delay_enabled ? (
                  <p className="mt-1 text-xs text-slate-400">
                    Hover the button below — on the live site it won&apos;t appear for{' '}
                    {config.open_delay_seconds ?? widget.open_delay_seconds ?? 5}s.
                  </p>
                ) : null}
              </div>
              {buttonAnimation !== 'none' ? (
                <style>{[
                  '@keyframes pmp-shake{10%,90%{transform:translateX(-1px);}20%,80%{transform:translateX(2px);}30%,50%,70%{transform:translateX(-3px);}40%,60%{transform:translateX(3px);}}',
                  '@keyframes pmp-wobble{0%{transform:rotate(0);}15%{transform:rotate(-3deg);}30%{transform:rotate(2.5deg);}45%{transform:rotate(-2deg);}60%{transform:rotate(1.5deg);}75%{transform:rotate(-1deg);}100%{transform:rotate(0);}}',
                  '@keyframes pmp-pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.04);}}',
                  '@keyframes pmp-bounce{0%,100%{transform:translateY(0);}30%{transform:translateY(-4px);}50%{transform:translateY(0);}70%{transform:translateY(-2px);}100%{transform:translateY(0);}}',
                  '.pmp-anim-shake:hover{animation:pmp-shake 0.5s ease-in-out;}',
                  '.pmp-anim-wobble:hover{animation:pmp-wobble 0.6s ease-in-out;}',
                  '.pmp-anim-pulse:hover{animation:pmp-pulse 0.8s ease-in-out infinite;}',
                  '.pmp-anim-bounce:hover{animation:pmp-bounce 0.6s ease-in-out;}',
                ].join('\n')}</style>
              ) : null}
              {/* A picture of the launcher, not a control: a <button> here looked clickable and did nothing. */}
              <div
                aria-hidden
                className={[
                  'absolute bottom-4 right-4 flex cursor-default items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium shadow-lg',
                  buttonAnimation !== 'none' ? `pmp-anim-${buttonAnimation}` : '',
                ].join(' ')}
                style={{ backgroundColor: primaryColor, color: brandTextColor }}
              >
                {buttonIconType === 'emoji' && buttonIconValue ? (
                  <span aria-hidden className="text-lg leading-none">
                    {withEmojiPresentation(buttonIconValue)}
                  </span>
                ) : null}
                {buttonIconType === 'image' && buttonIconValue ? (
                  <img src={buttonIconValue} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
                ) : null}
                <span className="flex flex-col items-center text-center leading-tight">
                  <span>{buttonText}</span>
                  {buttonSubtext ? (
                    <span className="text-[11px] font-medium">{buttonSubtext}</span>
                  ) : null}
                </span>
              </div>
            </div>
          ) : (
            <div className="m-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div
                className="px-4 py-3 text-sm font-semibold"
                style={{ backgroundColor: primaryColor, color: brandTextColor }}
              >
                {greeting}
              </div>
              <div className="p-4 text-sm text-slate-600">How the header will look on your site</div>
            </div>
          )}

          <p className="mx-4 mb-4 text-xs text-slate-500">
            To try the question flow with your real data, use{' '}
            <Link to="/questions" className="font-medium text-indigo-600 hover:text-indigo-700">
              Test Logic on the Questions page
            </Link>
            .
          </p>
        </aside>
      </div>

      <ConfirmDialog
        isOpen={modal.type === 'publish'}
        title="Publish Widget"
        message="Make this widget live? Your embed code will become active."
        confirmLabel="Publish Now"
        confirmVariant="primary"
        isLoading={actionLoading}
        onConfirm={() => void handlePublishConfirm()}
        onCancel={() => setModal({ type: null })}
      />

      <ConfirmDialog
        isOpen={modal.type === 'unpublish'}
        title="Unpublish Widget"
        message="This widget will stop working on your website."
        confirmLabel="Unpublish"
        confirmVariant="danger"
        isLoading={actionLoading}
        onConfirm={() => void handleUnpublishConfirm()}
        onCancel={() => setModal({ type: null })}
      />
    </div>
  )
}
