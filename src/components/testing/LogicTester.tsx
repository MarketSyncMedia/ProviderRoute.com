import { useCallback, useMemo, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RotateCcw, X } from 'lucide-react'
import { getCaseTypes } from '../../lib/api/caseTypes'
import { getCategories } from '../../lib/api/categories'
import { getConstraints } from '../../lib/api/constraints'
import { getDataTableOfferings } from '../../lib/api/dataTable'
import { getLocations } from '../../lib/api/locations'
import { getProviders } from '../../lib/api/providers'
import { getQuestions } from '../../lib/api/questions'
import { useAuthStore } from '../../stores/authStore'
import {
  filterBinary,
  filterExact,
  filterRange,
  getUniqueConstraintValues,
  resolveAutoSkip,
} from '../../lib/matcher'
import type { CaseType, Constraint, Location, Offering, Provider } from '../../types/database'

export type OfferingRow = Offering & {
  providers?: { name: string; category_ids: string[]; image_url: string | null }
}

/** Makes Enter in a field do what its Next button does, as the real widget does. */
function enterTo(action: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    action()
  }
}

type Phase = 'questions' | 'zero_results' | 'results'
type LogType = 'info' | 'skip' | 'warning' | 'error' | 'success'

interface LogEntry {
  timestamp: string
  message: string
  type: LogType
}

interface HistoryEntry {
  questionIndex: number
  activeOfferings: OfferingRow[]
  answers: Record<string, unknown>
  selectedCaseTypeId: string | null
  selectedLocationId: string | null
  bypassMode: boolean
  phase: Phase
  bypassResumeIndex: number | null
  offeringsBeforeBypass: OfferingRow[] | null
}

function ts() {
  return new Date().toISOString().slice(11, 23)
}

function dedupeByProvider(offerings: OfferingRow[]): OfferingRow[] {
  const seen = new Set<string>()
  const out: OfferingRow[] = []
  for (const o of offerings) {
    if (!seen.has(o.provider_id)) {
      seen.add(o.provider_id)
      out.push(o)
    }
  }
  return out
}

function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean)
  const a = w[0]?.[0] ?? ''
  const b = w.length > 1 ? w[w.length - 1]?.[0] ?? '' : w[0]?.[1] ?? ''
  return `${a}${b}`.toUpperCase() || name.slice(0, 2).toUpperCase()
}

interface LogicTesterProps {
  onClose: () => void
  orgId: string
}

export default function LogicTester({ onClose, orgId }: LogicTesterProps) {
  const org = useAuthStore((s) => s.org)

  const queryEnabled = Boolean(orgId)

  const { data: questionsData, isPending: questionsPending } = useQuery({
    queryKey: ['questions', orgId],
    queryFn: () => getQuestions(orgId),
    enabled: queryEnabled,
  })

  const { data: providersData, isPending: providersPending } = useQuery({
    queryKey: ['providers', orgId],
    queryFn: () => getProviders(orgId),
    enabled: queryEnabled,
  })

  const { data: offeringsData, isPending: offeringsPending } = useQuery({
    queryKey: ['data-table-offerings', orgId],
    queryFn: () => getDataTableOfferings(orgId) as Promise<OfferingRow[]>,
    enabled: queryEnabled,
  })

  const { data: caseTypesData, isPending: caseTypesPending } = useQuery({
    queryKey: ['case-types', orgId],
    queryFn: () => getCaseTypes(orgId),
    enabled: queryEnabled,
  })

  const { data: categoriesData, isPending: categoriesPending } = useQuery({
    queryKey: ['categories', orgId],
    queryFn: () => getCategories(orgId),
    enabled: queryEnabled,
  })

  const { data: locationsData, isPending: locationsPending } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => getLocations(orgId),
    enabled: queryEnabled,
  })

  const { data: constraintsData, isPending: constraintsPending } = useQuery({
    queryKey: ['constraints', orgId],
    queryFn: () => getConstraints(orgId),
    enabled: queryEnabled,
  })

  const bundle = useMemo(() => {
    if (
      !questionsData ||
      !providersData ||
      !offeringsData ||
      !caseTypesData ||
      !categoriesData ||
      !locationsData ||
      !constraintsData
    ) {
      return null
    }
    return {
      questions: questionsData,
      providers: providersData,
      offerings: offeringsData,
      caseTypes: caseTypesData,
      categories: categoriesData,
      locations: locationsData,
      constraints: constraintsData,
    }
  }, [questionsData, providersData, offeringsData, caseTypesData, categoriesData, locationsData, constraintsData])

  const isLoading =
    queryEnabled &&
    (questionsPending ||
      providersPending ||
      offeringsPending ||
      caseTypesPending ||
      categoriesPending ||
      locationsPending ||
      constraintsPending)

  // Baseline for Reset. State rather than a ref because the session that seeds
  // it can start during render.
  const [snapshot, setSnapshot] = useState<OfferingRow[]>([])

  const [phase, setPhase] = useState<Phase>('questions')
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [activeOfferings, setActiveOfferings] = useState<OfferingRow[]>([])
  const [selectedCaseTypeId, setSelectedCaseTypeId] = useState<string | null>(null)
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [bypassMode, setBypassMode] = useState(false)
  const [bypassResumeIndex, setBypassResumeIndex] = useState<number | null>(null)
  const [offeringsBeforeBypass, setOfferingsBeforeBypass] = useState<OfferingRow[] | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [rangeInput, setRangeInput] = useState('')
  const [exactInput, setExactInput] = useState('')
  const [resultsSearch, setResultsSearch] = useState('')

  const addLog = useCallback((type: LogType, message: string) => {
    setLogs((prev) => [...prev, { timestamp: ts(), message, type }])
  }, [])

  const clearLogs = useCallback(() => setLogs([]), [])

  const exportLogs = useCallback(() => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logic-tester-log-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [logs])

  const constraintMap = useMemo(() => {
    const m = new Map<string, Constraint>()
    bundle?.constraints.forEach((c) => m.set(c.id, c))
    return m
  }, [bundle])

  const categoryMap = useMemo(() => {
    const m = new Map<string, string>()
    bundle?.categories.forEach((c) => m.set(c.id, c.name))
    return m
  }, [bundle])

  const questionSequence = useMemo(() => {
    if (!bundle?.questions.length) {
      return []
    }
    const entries = bundle.questions.filter((q) => q.question_type === 'entry')
    const entry = [...entries].sort((a, b) => a.order_rank - b.order_rank)[0]
    const nonEntry = bundle.questions
      .filter((q) => q.question_type !== 'entry')
      .sort((a, b) => a.order_rank - b.order_rank)
    return entry ? [entry, ...nonEntry] : nonEntry
  }, [bundle])

  /**
   * Where the flow lands starting from `from`, and the log lines that implies.
   *
   * Auto-skipping and the questions -> results transition used to be reactive
   * effects that watched the index and corrected it afterwards. Deciding both
   * here, at the point the flow actually moves, keeps them out of render and
   * keeps each log line tied to the transition that caused it.
   */
  const planAdvance = useCallback(
    (from: number, offerings: OfferingRow[]) => {
      const { nextIndex, skipped } = resolveAutoSkip(
        questionSequence,
        from,
        constraintMap,
        offerings,
      )
      const entries: LogEntry[] = skipped.map((q) => ({
        timestamp: ts(),
        type: 'skip',
        message: `Auto-skipped clinical (no constraint data on offerings): ${q.question_text}`,
      }))

      const finished = nextIndex >= questionSequence.length && questionSequence.length > 0
      if (finished) {
        entries.push({
          timestamp: ts(),
          type: 'success',
          message: 'Question flow complete — showing results',
        })
      }

      return { index: nextIndex, finished, entries }
    },
    [questionSequence, constraintMap],
  )

  /** Move the flow to `from`, applying auto-skip and end-of-flow. */
  const advanceTo = useCallback(
    (from: number, offerings: OfferingRow[]) => {
      const plan = planAdvance(from, offerings)
      setCurrentQuestionIndex(plan.index)
      if (plan.finished) {
        setPhase('results')
      }
      if (plan.entries.length > 0) {
        setLogs((prev) => [...prev, ...plan.entries])
      }
    },
    [planAdvance],
  )

  const startSession = useCallback(() => {
    if (!bundle?.offerings) {
      return
    }
    const copy = JSON.parse(JSON.stringify(bundle.offerings)) as OfferingRow[]
    setSnapshot(JSON.parse(JSON.stringify(bundle.offerings)) as OfferingRow[])
    setActiveOfferings(copy)
    setAnswers({})
    setSelectedCaseTypeId(null)
    setSelectedLocationId(null)
    setBypassMode(false)
    setBypassResumeIndex(null)
    setOfferingsBeforeBypass(null)
    setHistory([])
    setPhase('questions')
    setRangeInput('')
    setExactInput('')
    setResultsSearch('')

    // Built as one absolute assignment rather than appends, so starting a
    // session is idempotent — it can safely run during render.
    const plan = planAdvance(0, copy)
    setCurrentQuestionIndex(plan.index)
    if (plan.finished) {
      setPhase('results')
    }
    setLogs([
      {
        timestamp: ts(),
        message: `Session started — ${copy.length} total offerings loaded`,
        type: 'info',
      },
      ...plan.entries,
    ])
  }, [bundle?.offerings, planAdvance])

  // Start a session as soon as the data lands. The component is mounted only
  // while the tester is open, so this runs once per open.
  const [startedFor, setStartedFor] = useState<OfferingRow[] | null>(null)
  if (bundle?.offerings && bundle.offerings !== startedFor) {
    setStartedFor(bundle.offerings)
    startSession()
  }

  const pushHistory = useCallback(() => {
    setHistory((h) => [
      ...h,
      {
        questionIndex: currentQuestionIndex,
        activeOfferings: JSON.parse(JSON.stringify(activeOfferings)) as OfferingRow[],
        answers: { ...answers },
        selectedCaseTypeId,
        selectedLocationId,
        bypassMode,
        phase,
        bypassResumeIndex,
        offeringsBeforeBypass: offeringsBeforeBypass ? JSON.parse(JSON.stringify(offeringsBeforeBypass)) : null,
      },
    ])
  }, [
    currentQuestionIndex,
    activeOfferings,
    answers,
    selectedCaseTypeId,
    selectedLocationId,
    bypassMode,
    phase,
    bypassResumeIndex,
    offeringsBeforeBypass,
  ])

  const currentQuestion = questionSequence[currentQuestionIndex]

  const handleBack = () => {
    if (history.length === 0) {
      return
    }
    const last = history[history.length - 1]
    setHistory((h) => h.slice(0, -1))
    setCurrentQuestionIndex(last.questionIndex)
    setActiveOfferings(last.activeOfferings)
    setAnswers(last.answers)
    setSelectedCaseTypeId(last.selectedCaseTypeId)
    setSelectedLocationId(last.selectedLocationId)
    setBypassMode(last.bypassMode)
    setPhase(last.phase)
    setBypassResumeIndex(last.bypassResumeIndex)
    setOfferingsBeforeBypass(last.offeringsBeforeBypass)
    addLog('info', 'Restored previous step')
  }

  const handleReset = () => {
    const base = snapshot.length
      ? snapshot
      : bundle?.offerings
        ? (JSON.parse(JSON.stringify(bundle.offerings)) as OfferingRow[])
        : []
    const fresh = JSON.parse(JSON.stringify(base)) as OfferingRow[]
    setSnapshot(JSON.parse(JSON.stringify(base)) as OfferingRow[])
    setActiveOfferings(fresh)
    setAnswers({})
    setSelectedCaseTypeId(null)
    setSelectedLocationId(null)
    setBypassMode(false)
    setBypassResumeIndex(null)
    setOfferingsBeforeBypass(null)
    setHistory([])
    setPhase('questions')
    setRangeInput('')
    setExactInput('')
    setResultsSearch('')

    const plan = planAdvance(0, fresh)
    setCurrentQuestionIndex(plan.index)
    if (plan.finished) {
      setPhase('results')
    }
    setLogs([
      {
        timestamp: ts(),
        message: `Session started — ${base.length} total offerings loaded`,
        type: 'info',
      },
      ...plan.entries,
    ])
  }

  const advanceAfterFilter = (
    nextOfferings: OfferingRow[],
    cname: string,
    prevCount: number
  ) => {
    setActiveOfferings(nextOfferings)
    addLog('success', `Filter applied: ${cname} → ${nextOfferings.length} offerings remaining`)
    if (nextOfferings.length === prevCount) {
      addLog('warning', 'This question had no effect')
    }
    if (nextOfferings.length === 0) {
      addLog('error', 'ZERO RESULTS')
      setPhase('zero_results')
      return
    }
    advanceTo(currentQuestionIndex + 1, nextOfferings)
  }

  const answerEntry = (caseTypeId: string) => {
    pushHistory()
    const prev = activeOfferings.length
    const next = activeOfferings.filter((o) => o.case_type_id === caseTypeId)
    setAnswers((a) => ({ ...a, entry_case_type: caseTypeId }))
    setSelectedCaseTypeId(caseTypeId)
    setActiveOfferings(next)
    addLog('info', `Case type selected — ${next.length} offerings (was ${prev})`)
    advanceTo(currentQuestionIndex + 1, next)
  }

  const answerLocation = (locId: string) => {
    pushHistory()
    setSelectedLocationId(locId)
    setAnswers((a) => ({ ...a, location: locId }))
    addLog('info', `Location preference recorded: ${locId}`)
    advanceTo(currentQuestionIndex + 1, activeOfferings)
  }

  const answerProvider = (yes: boolean) => {
    if (yes) {
      pushHistory()
      setOfferingsBeforeBypass(JSON.parse(JSON.stringify(activeOfferings)) as OfferingRow[])
      setBypassResumeIndex(currentQuestionIndex + 1)
      setBypassMode(true)
      setAnswers((a) => ({ ...a, provider_bypass: true }))
      addLog('info', 'Bypass triggered — skipping to results')
      setPhase('results')
      return
    }
    pushHistory()
    setAnswers((a) => ({ ...a, provider_bypass: false }))
    addLog('info', 'Continuing question flow')
    advanceTo(currentQuestionIndex + 1, activeOfferings)
  }

  const answerClinicalBinary = (pickedYes: boolean) => {
    if (!currentQuestion?.constraint_id) {
      return
    }
    const c = constraintMap.get(currentQuestion.constraint_id)
    if (!c) {
      return
    }
    pushHistory()
    const prev = activeOfferings.length
    const next = filterBinary(activeOfferings, c, pickedYes)
    setAnswers((a) => ({ ...a, [currentQuestion.id]: pickedYes ? 'yes' : 'no' }))
    advanceAfterFilter(next, c.name, prev)
  }

  const answerClinicalRange = () => {
    // An empty box is no answer; Number('') would read it as 0.
    const n = Number(rangeInput)
    if (rangeInput.trim() === '' || !Number.isFinite(n)) {
      return
    }
    if (!currentQuestion?.constraint_id) {
      return
    }
    const c = constraintMap.get(currentQuestion.constraint_id)
    if (!c) {
      return
    }
    pushHistory()
    const prev = activeOfferings.length
    const next = filterRange(activeOfferings, c, n)
    setAnswers((a) => ({ ...a, [currentQuestion.id]: n }))
    setRangeInput('')
    advanceAfterFilter(next, c.name, prev)
  }

  const answerClinicalExactWithValue = (value: string) => {
    if (!currentQuestion?.constraint_id) {
      return
    }
    const c = constraintMap.get(currentQuestion.constraint_id)
    if (!c) {
      return
    }
    pushHistory()
    const prev = activeOfferings.length
    const next = filterExact(activeOfferings, c, value)
    setAnswers((a) => ({ ...a, [currentQuestion.id]: value }))
    setExactInput('')
    advanceAfterFilter(next, c.name, prev)
  }

  const answerClinicalExact = () => {
    const t = exactInput.trim()
    if (!t) {
      return
    }
    answerClinicalExactWithValue(t)
  }

  const handleStartOver = () => {
    handleReset()
  }

  const handleHelpMeChoose = () => {
    if (offeringsBeforeBypass === null || bypassResumeIndex === null) {
      return
    }
    const restored = JSON.parse(JSON.stringify(offeringsBeforeBypass)) as OfferingRow[]
    setActiveOfferings(restored)
    setBypassMode(false)
    setPhase('questions')
    // Resume applies auto-skip too, matching what the old reactive effect did
    // once the index landed.
    advanceTo(bypassResumeIndex, restored)
    setOfferingsBeforeBypass(null)
    setBypassResumeIndex(null)
    addLog('info', 'Resumed question flow after bypass')
  }

  const providerById = useMemo(() => {
    const m = new Map<string, Provider>()
    bundle?.providers.forEach((p) => m.set(p.id, p))
    return m
  }, [bundle?.providers])

  const resultsDeduped = useMemo(() => dedupeByProvider(activeOfferings), [activeOfferings])

  const filteredBypassResults = useMemo(() => {
    const q = resultsSearch.trim().toLowerCase()
    if (!q) {
      return resultsDeduped
    }
    return resultsDeduped.filter((o) => {
      const name = o.providers?.name ?? providerById.get(o.provider_id)?.name ?? ''
      return name.toLowerCase().includes(q)
    })
  }, [resultsDeduped, resultsSearch, providerById])

  const logColor = (t: LogType) => {
    switch (t) {
      case 'info':
        return 'text-green-400'
      case 'skip':
        return 'text-yellow-400'
      case 'warning':
        return 'text-orange-400'
      case 'error':
        return 'text-red-400'
      case 'success':
        return 'text-emerald-300'
      default:
        return 'text-slate-400'
    }
  }

  const renderQuestionInput = () => {
    if (!currentQuestion || !bundle) {
      return null
    }

    if (currentQuestion.question_type === 'entry') {
      return (
        <div className="flex flex-wrap gap-2">
          {bundle.caseTypes.map((ct: CaseType) => (
            <button
              key={ct.id}
              type="button"
              onClick={() => answerEntry(ct.id)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              {ct.name}
            </button>
          ))}
        </div>
      )
    }

    if (currentQuestion.question_type === 'location') {
      return (
        <select
          className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={selectedLocationId ?? ''}
          onChange={(e) => setSelectedLocationId(e.target.value)}
          onKeyDown={enterTo(() => {
            if (selectedLocationId) answerLocation(selectedLocationId)
          })}
        >
          <option value="">Select location…</option>
          {bundle.locations.map((loc: Location) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>
      )
    }

    if (currentQuestion.question_type === 'provider') {
      return (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => answerProvider(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => answerProvider(false)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-50"
          >
            No
          </button>
        </div>
      )
    }

    if (currentQuestion.question_type === 'clinical' && currentQuestion.constraint_id) {
      const c = constraintMap.get(currentQuestion.constraint_id)
      if (!c) {
        return <p className="text-sm text-red-600">Constraint not found</p>
      }
      if (c.type === 'binary') {
        return (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => answerClinicalBinary(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              {c.yes_label || 'Yes'}
            </button>
            <button
              type="button"
              onClick={() => answerClinicalBinary(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-50"
            >
              {c.no_label || 'No'}
            </button>
          </div>
        )
      }
      if (c.type === 'range') {
        return (
          <div className="flex flex-wrap items-end gap-2">
            <input
              type="number"
              value={rangeInput}
              onChange={(e) => setRangeInput(e.target.value)}
              onKeyDown={enterTo(answerClinicalRange)}
              className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Enter a number"
            />
            <button
              type="button"
              onClick={() => answerClinicalRange()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Next
            </button>
          </div>
        )
      }
      if (c.type === 'exact') {
        const opts = getUniqueConstraintValues(activeOfferings, c.mapped_key)
        if (currentQuestion.input_type === 'dropdown') {
          if (opts.length === 0) {
            return (
              <div className="flex flex-wrap items-end gap-2">
                <input
                  type="text"
                  value={exactInput}
                  onChange={(e) => setExactInput(e.target.value)}
                  onKeyDown={enterTo(answerClinicalExact)}
                  className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Answer"
                />
                <button
                  type="button"
                  onClick={() => answerClinicalExact()}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Next
                </button>
              </div>
            )
          }
          return (
            <select
              className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value=""
              onChange={(e) => {
                const v = e.target.value
                if (v) {
                  answerClinicalExactWithValue(v)
                }
              }}
            >
              <option value="">Select…</option>
              {opts.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )
        }
        if (currentQuestion.input_type === 'buttons' && opts.length > 0) {
          return (
            <div className="flex flex-wrap gap-2">
              {opts.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => answerClinicalExactWithValue(opt)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
                >
                  {opt}
                </button>
              ))}
            </div>
          )
        }
        return (
          <div className="flex flex-wrap items-end gap-2">
            <input
              type="text"
              value={exactInput}
              onChange={(e) => setExactInput(e.target.value)}
              onKeyDown={enterTo(answerClinicalExact)}
              className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Answer"
            />
            <button
              type="button"
              onClick={() => answerClinicalExact()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Next
            </button>
          </div>
        )
      }
    }

    return null
  }

  const renderLocationConfirm = () => {
    if (currentQuestion?.question_type !== 'location') {
      return null
    }
    return (
      <button
        type="button"
        disabled={!selectedLocationId}
        onClick={() => selectedLocationId && answerLocation(selectedLocationId)}
        className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        Continue
      </button>
    )
  }

  const renderResults = () => {
    const listCard = (o: OfferingRow) => {
      const p = providerById.get(o.provider_id)
      const name = o.providers?.name ?? p?.name ?? 'Provider'
      const catIds = o.providers?.category_ids ?? p?.category_ids ?? []
      const cats = catIds
        .map((id) => categoryMap.get(id))
        .filter(Boolean) as string[]
      return (
        <div key={o.id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
            {initials(name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-900">{name}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {cats.map((cn) => (
                <span key={cn} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {cn}
                </span>
              ))}
            </div>
          </div>
        </div>
      )
    }

    if (bypassMode) {
      return (
        <div className="space-y-4">
          <input
            type="search"
            placeholder="Search providers…"
            value={resultsSearch}
            onChange={(e) => setResultsSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="space-y-2">
            {filteredBypassResults.map(listCard)}
          </div>
          {bypassResumeIndex !== null && offeringsBeforeBypass ? (
            <button
              type="button"
              onClick={handleHelpMeChoose}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              Help me choose instead
            </button>
          ) : null}
        </div>
      )
    }

    if (!selectedLocationId) {
      const byCat = new Map<string, OfferingRow[]>()
      for (const o of resultsDeduped) {
        const p = providerById.get(o.provider_id)
        const catIds = (o.providers?.category_ids ?? p?.category_ids ?? []) as string[]
        const catNames = catIds.map((id) => categoryMap.get(id) ?? 'Other').sort((a, b) => a.localeCompare(b))
        const key = catNames[0] ?? 'Other'
        const list = byCat.get(key) ?? []
        list.push(o)
        byCat.set(key, list)
      }
      const names = [...byCat.keys()].sort((a, b) => a.localeCompare(b))
      return (
        <div className="space-y-6">
          {names.map((name) => (
            <div key={name}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{name}</h3>
              <div className="space-y-2">
                {(byCat.get(name) ?? []).map(listCard)}
              </div>
            </div>
          ))}
        </div>
      )
    }

    const atLoc = resultsDeduped.filter((o) => o.location_ids.includes(selectedLocationId))
    const outside = resultsDeduped.filter((o) => !o.location_ids.includes(selectedLocationId))

    return (
      <div className="space-y-6">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">At selected location</h3>
          <div className="space-y-2">{atLoc.map(listCard)}</div>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Other locations</h3>
          <div className="space-y-2">{outside.map(listCard)}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div>
          <h1 className="font-bold text-slate-900">Logic Tester</h1>
          <p className="text-sm text-slate-500">Simulation using your real data</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
          <div className="bg-indigo-600 px-4 py-3 text-sm font-semibold text-white">ProviderRoute Preview</div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            {isLoading || !bundle ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : phase === 'zero_results' ? (
              <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-800">No matching providers</p>
                <p className="mt-2 text-sm text-red-700">{org?.fallback_message ?? 'Please try adjusting your answers.'}</p>
                {org?.fallback_phone ? (
                  <p className="mt-1 text-sm text-red-700">{org.fallback_phone}</p>
                ) : null}
                <button
                  type="button"
                  onClick={handleStartOver}
                  className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  Start Over
                </button>
              </div>
            ) : phase === 'results' ? (
              renderResults()
            ) : (
              <>
                {history.length > 0 && phase === 'questions' ? (
                  <button
                    type="button"
                    onClick={handleBack}
                    className="self-start text-sm font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    ← Back
                  </button>
                ) : null}
                {currentQuestion ? (
                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <p className="text-sm font-medium text-slate-900">{currentQuestion.question_text}</p>
                    {currentQuestion.subtext ? (
                      <p className="mt-1 text-xs text-slate-500">{currentQuestion.subtext}</p>
                    ) : null}
                    <div className="mt-4">{renderQuestionInput()}</div>
                    {renderLocationConfirm()}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No questions configured.</p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex w-96 flex-col overflow-hidden bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <span className="text-sm font-semibold text-slate-300">Debug Console</span>
            <div className="flex gap-2">
              <button type="button" onClick={clearLogs} className="text-xs text-slate-500 hover:text-slate-300">
                Clear
              </button>
              <button type="button" onClick={exportLogs} className="text-xs text-slate-500 hover:text-slate-300">
                Export
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 font-mono text-xs">
            {logs.map((log, i) => (
              <div key={i} className={`mb-1 break-words ${logColor(log.type)}`}>
                <span className="text-slate-500">[{log.timestamp}]</span> {log.message}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
