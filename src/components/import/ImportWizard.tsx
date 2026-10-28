import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileText, Upload, X } from 'lucide-react'
import { getCaseTypes } from '../../lib/api/caseTypes'
import { getCategories } from '../../lib/api/categories'
import { createConstraint, getConstraints } from '../../lib/api/constraints'
import { createLocation, getLocations } from '../../lib/api/locations'
import { getProviders } from '../../lib/api/providers'
import { detectConflicts, executeImportRun, type ConflictItem } from '../../lib/import/importExecution'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../ui/LoadingSpinner'
import { useToast } from '../ui/toastStore'
import { parseFile, type ParseResult } from '../../lib/parsers/fileParser'
import type { CaseType, Category, Constraint, Location, Provider } from '../../types/database'

export type ColumnRole =
  | ''
  | 'provider_name'
  | 'case_type'
  | 'category'
  | 'location'
  | 'constraint'
  | 'booking_link'
  | 'phone'
  | 'ignore'

export interface ColumnMapping {
  excelHeader: string
  role: ColumnRole
  locationId?: string
  constraintId?: string
  rangePosition?: 'min' | 'max'
  locationScope?: string | 'all'
}

interface ImportWizardProps {
  isOpen: boolean
  onClose: () => void
  onComplete: () => void
  orgId: string
}

function headersEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  return a.every((h, i) => h === b[i])
}

const INITIAL_INLINE_CONSTRAINT = {
  name: '',
  type: '' as '' | 'binary' | 'range' | 'exact',
  mapped_key: '',
  secondary_mapped_key: '',
  yes_label: '',
  no_label: '',
  yes_maps_to: '',
  no_maps_to: '',
  min_allowed_value: '',
  max_allowed_value: '',
}

// Stable singleton, not a fresh `[]` literal each render — see
// ProviderProfilePage's EMPTY_PROVIDER_LOCATIONS for why that distinction
// matters when a default feeds a render-time state comparison.
const EMPTY_CONFLICTS: ConflictItem[] = []

const MAP_ROLE_OPTIONS: { value: ColumnRole; label: string }[] = [
  { value: '', label: '-- Select mapping --' },
  { value: 'provider_name', label: 'Provider Name' },
  { value: 'case_type', label: 'Case Type' },
  { value: 'category', label: 'Category' },
  { value: 'location', label: 'Location' },
  { value: 'constraint', label: 'Constraint' },
  { value: 'booking_link', label: 'Booking Link' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'ignore', label: 'Ignore this column' },
]

export default function ImportWizard({ isOpen, onClose, onComplete, orgId }: ImportWizardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const templateAppliedRef = useRef(false)
  const { toast } = useToast()

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [file, setFile] = useState<File | null>(null)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [mappings, setMappings] = useState<ColumnMapping[]>([])
  const [parseLoading, setParseLoading] = useState(false)

  const [orgLocations, setOrgLocations] = useState<Location[]>([])
  const [orgConstraints, setOrgConstraints] = useState<Constraint[]>([])
  const [existingProviders, setExistingProviders] = useState<Provider[]>([])
  const [orgCaseTypes, setOrgCaseTypes] = useState<CaseType[]>([])
  const [orgCategories, setOrgCategories] = useState<Category[]>([])

  const [resolvedConflicts, setResolvedConflicts] = useState<Record<string, 'merge' | 'separate' | 'skip'>>({})
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importSuccess, setImportSuccess] = useState(false)
  const [importStats, setImportStats] = useState({
    providersCreated: 0,
    providersUpdated: 0,
    offeringsUpserted: 0,
    newCaseTypes: 0,
    newCategories: 0,
  })
  const [mappingTemplateBanner, setMappingTemplateBanner] = useState(false)

  const [inlineModal, setInlineModal] = useState<{ type: 'location' | 'constraint' | null; targetHeader: string }>({
    type: null,
    targetHeader: '',
  })
  const [inlineLocationForm, setInlineLocationForm] = useState({ name: '', address: '', phone: '' })
  const [inlineConstraintForm, setInlineConstraintForm] = useState(() => ({ ...INITIAL_INLINE_CONSTRAINT }))
  const [isSavingInline, setIsSavingInline] = useState(false)
  const [inlineError, setInlineError] = useState('')

  // Reset all wizard state when it closes, during render rather than from
  // an effect — an effect-based reset here paints one extra stale frame
  // before clearing, and it's a synchronous setState-in-effect besides.
  // Keeps the effect below focused on its one real job: fetching org data
  // when the wizard opens.
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (!isOpen && wasOpen) {
    setWasOpen(false)
    setStep(1)
    setFile(null)
    setParseResult(null)
    setMappings([])
    setParseLoading(false)
    setInlineModal({ type: null, targetHeader: '' })
    setInlineLocationForm({ name: '', address: '', phone: '' })
    setInlineConstraintForm({ ...INITIAL_INLINE_CONSTRAINT })
    setIsSavingInline(false)
    setInlineError('')
    setExistingProviders([])
    setOrgCaseTypes([])
    setOrgCategories([])
    setResolvedConflicts({})
    setIsImporting(false)
    setImportError('')
    setImportSuccess(false)
    setImportStats({
      providersCreated: 0,
      providersUpdated: 0,
      offeringsUpserted: 0,
      newCaseTypes: 0,
      newCategories: 0,
    })
    setMappingTemplateBanner(false)
  } else if (isOpen && !wasOpen) {
    setWasOpen(true)
  }

  // Refs can't be mutated during render (unlike state, a ref write survives
  // a discarded/replayed render), so this one small piece of the close-reset
  // stays in an effect.
  useEffect(() => {
    if (!isOpen) {
      templateAppliedRef.current = false
    }
  }, [isOpen])

  // Escape closes like the backdrop does, but never mid-import: a stray key
  // press should not hide an import that is still writing.
  useEffect(() => {
    if (!isOpen || inlineModal.type !== null || isImporting) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, inlineModal.type, isImporting, onClose])

  useEffect(() => {
    if (!isOpen || !orgId) {
      return
    }

    let cancelled = false
    void (async () => {
      const [locs, cons, provs, cts, cats] = await Promise.all([
        getLocations(orgId),
        getConstraints(orgId),
        getProviders(orgId),
        getCaseTypes(orgId),
        getCategories(orgId),
      ])
      if (!cancelled) {
        setOrgLocations(locs)
        setOrgConstraints(cons)
        setExistingProviders(provs)
        setOrgCaseTypes(cts)
        setOrgCategories(cats)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isOpen, orgId])

  const handleFile = useCallback(async (f: File | undefined) => {
    if (!f) {
      return
    }
    templateAppliedRef.current = false
    setMappingTemplateBanner(false)
    setParseLoading(true)
    setFile(f)
    const result = await parseFile(f)
    setParseLoading(false)
    setParseResult(result)

    if (result.errors.length === 0 && result.headers.length > 0) {
      setMappings(
        result.headers.map((h) => ({
          excelHeader: h,
          role: '',
        }))
      )
    } else {
      setMappings([])
    }
  }, [])

  const parseOk = useMemo(
    () =>
      parseResult !== null &&
      parseResult.errors.length === 0 &&
      parseResult.headers.length > 0 &&
      parseResult.rowCount > 0,
    [parseResult]
  )

  const providerNameCount = useMemo(() => mappings.filter((m) => m.role === 'provider_name').length, [mappings])

  const step2Valid = providerNameCount === 1

  const updateMapping = useCallback((index: number, patch: Partial<ColumnMapping>) => {
    setMappings((prev) =>
      prev.map((row, i) => {
        if (i !== index) {
          return row
        }
        const next = { ...row, ...patch }
        if (patch.role !== undefined && patch.role !== 'location') {
          delete next.locationId
        }
        if (patch.role !== undefined && patch.role !== 'constraint') {
          delete next.constraintId
          delete next.rangePosition
        }
        if (patch.role && patch.role !== 'booking_link' && patch.role !== 'phone') {
          delete next.locationScope
        }
        if (patch.constraintId !== undefined) {
          const c = orgConstraints.find((x) => x.id === patch.constraintId)
          if (c) {
            if (c.type !== 'range') {
              delete next.rangePosition
            } else if (next.rangePosition === undefined) {
              next.rangePosition = 'min'
            }
          }
        }
        return next
      })
    )
  }, [orgConstraints])

  const previewRows = useMemo(() => {
    if (!parseResult?.rows.length) {
      return []
    }
    return parseResult.rows.slice(0, 3)
  }, [parseResult])

  useEffect(() => {
    if (step !== 2 || !parseResult?.headers.length || !orgId || templateAppliedRef.current) {
      return
    }

    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('import_history')
        .select('mapping_template, created_at')
        .eq('org_id', orgId)
        .not('mapping_template', 'is', null)
        .order('created_at', { ascending: false })

      if (cancelled) {
        return
      }
      if (!data?.length) {
        setMappingTemplateBanner(false)
        templateAppliedRef.current = true
        return
      }

      for (const row of data) {
        const mt = row.mapping_template as { headers?: string[]; mappings?: ColumnMapping[] } | null
        if (
          mt?.headers &&
          headersEqual(mt.headers, parseResult.headers) &&
          mt.mappings &&
          mt.mappings.length === parseResult.headers.length
        ) {
          setMappings(mt.mappings)
          setMappingTemplateBanner(true)
          templateAppliedRef.current = true
          return
        }
      }
      if (!cancelled) {
        setMappingTemplateBanner(false)
        templateAppliedRef.current = true
      }
    })()

    return () => {
      cancelled = true
    }
  }, [step, parseResult, orgId])

  // Pure derivation of already-available data — no external system involved,
  // so this is a useMemo rather than an effect writing to state.
  const conflicts = useMemo(() => {
    // From step 3 onward, not step 3 only: the preview (4) and the import
    // itself (5) both read this. Scoping it to step 3 silently emptied it the
    // moment the user advanced, so every resolution they had just made was
    // discarded and each conflicting row was imported as a new provider.
    if (step < 3 || !parseResult?.rows.length) {
      return EMPTY_CONFLICTS
    }
    const providerHeader = mappings.find((m) => m.role === 'provider_name')?.excelHeader
    if (!providerHeader) {
      return EMPTY_CONFLICTS
    }
    return detectConflicts(parseResult.rows, providerHeader, existingProviders)
  }, [step, parseResult, mappings, existingProviders])

  const conflictSignature = useMemo(
    () => conflicts.map((c) => `${c.rowIndex}-${c.existingProvider.id}-${c.matchType}`).join('|'),
    [conflicts]
  )

  // resolvedConflicts tracks per-row resolutions for the current conflict
  // set — reset it during render when that set changes, rather than from
  // an effect reacting to a value that render-time logic already produced.
  const [syncedConflictSignature, setSyncedConflictSignature] = useState(conflictSignature)
  if (conflictSignature !== syncedConflictSignature) {
    setSyncedConflictSignature(conflictSignature)
    setResolvedConflicts({})
  }

  const step3CanContinue = useMemo(() => {
    if (conflicts.length === 0) {
      return true
    }
    return conflicts.every((c) => resolvedConflicts[String(c.rowIndex)] !== undefined)
  }, [conflicts, resolvedConflicts])

  const previewStats = useMemo(() => {
    if (!parseResult?.rows.length) {
      return {
        newProviders: 0,
        updatedProviders: 0,
        skippedRows: 0,
        newCaseTypes: 0,
        newCategories: 0,
        totalOfferings: 0,
      }
    }

    const providerHeader = mappings.find((m) => m.role === 'provider_name')?.excelHeader
    const caseTypeHeader = mappings.find((m) => m.role === 'case_type')?.excelHeader
    const categoryHeader = mappings.find((m) => m.role === 'category')?.excelHeader

    const conflictByRow = new Map(conflicts.map((c) => [c.rowIndex, c]))
    const orgCtLower = new Set(orgCaseTypes.map((c) => c.name.trim().toLowerCase()))
    const orgCatLower = new Set(orgCategories.map((c) => c.name.trim().toLowerCase()))

    let newProviders = 0
    let updatedProviders = 0
    let skippedRows = 0
    const newCtSet = new Set<string>()
    const newCatSet = new Set<string>()
    let totalOfferings = 0

    for (let i = 0; i < parseResult.rows.length; i += 1) {
      const row = parseResult.rows[i]
      const prov = providerHeader ? (row[providerHeader] ?? '').trim() : ''
      if (!prov) {
        skippedRows += 1
        continue
      }

      const c = conflictByRow.get(i)
      const res = c ? resolvedConflicts[String(i)] : undefined

      if (c && res === 'skip') {
        skippedRows += 1
        continue
      }

      if (c && res === 'merge') {
        updatedProviders += 1
      } else if (c && res === 'separate') {
        newProviders += 1
      } else if (!c) {
        newProviders += 1
      } else {
        skippedRows += 1
        continue
      }

      const caseVal = caseTypeHeader ? (row[caseTypeHeader] ?? '').trim() : ''
      if (!caseVal) {
        continue
      }

      if (!orgCtLower.has(caseVal.toLowerCase())) {
        newCtSet.add(caseVal.trim())
      }

      const catVal = categoryHeader ? (row[categoryHeader] ?? '').trim() : ''
      if (catVal && !orgCatLower.has(catVal.toLowerCase())) {
        newCatSet.add(catVal.trim())
      }

      totalOfferings += 1
    }

    return {
      newProviders,
      updatedProviders,
      skippedRows,
      newCaseTypes: newCtSet.size,
      newCategories: newCatSet.size,
      totalOfferings,
    }
  }, [parseResult, mappings, conflicts, resolvedConflicts, orgCaseTypes, orgCategories])

  const previewWarnings = useMemo(() => {
    if (!parseResult?.rows.length) {
      return [] as string[]
    }
    const warnings: string[] = []
    const providerHeader = mappings.find((m) => m.role === 'provider_name')?.excelHeader

    for (let i = 0; i < parseResult.rows.length; i += 1) {
      const row = parseResult.rows[i]
      const prov = providerHeader ? (row[providerHeader] ?? '').trim() : ''
      if (!prov) {
        warnings.push(`Row ${i + 1}: empty provider name`)
      }
    }

    const binaryMappings = mappings
      .filter((m) => m.role === 'constraint' && m.constraintId)
      .map((m) => {
        const c = orgConstraints.find((x) => x.id === m.constraintId)
        return c?.type === 'binary' ? { header: m.excelHeader, constraint: c } : null
      })
      .filter((x): x is { header: string; constraint: Constraint } => x !== null)

    for (let i = 0; i < parseResult.rows.length; i += 1) {
      const row = parseResult.rows[i]
      for (const bm of binaryMappings) {
        const val = (row[bm.header] ?? '').trim()
        if (val !== '' && val !== '0' && val !== '1') {
          warnings.push(`Row ${i + 1}: "${bm.constraint.name}" expects 0 or 1, got "${val}"`)
        }
      }
    }

    const rangeIds = new Set(
      mappings
        .filter((m) => m.role === 'constraint' && m.constraintId)
        .map((m) => {
          const c = orgConstraints.find((x) => x.id === m.constraintId)
          return c?.type === 'range' ? m.constraintId : null
        })
        .filter((x): x is string => x !== null)
    )

    for (const cid of rangeIds) {
      const minM = mappings.find((m) => m.constraintId === cid && m.rangePosition === 'min')
      const maxM = mappings.find((m) => m.constraintId === cid && m.rangePosition === 'max')
      const c = orgConstraints.find((x) => x.id === cid)
      if (!minM || !maxM) {
        continue
      }
      for (let i = 0; i < parseResult.rows.length; i += 1) {
        const row = parseResult.rows[i]
        const minV = Number(row[minM.excelHeader] ?? '')
        const maxV = Number(row[maxM.excelHeader] ?? '')
        if (Number.isFinite(minV) && Number.isFinite(maxV) && minV > maxV) {
          warnings.push(
            `Row ${i + 1}: range "${c?.name ?? 'constraint'}" min (${minV}) is greater than max (${maxV})`
          )
        }
      }
    }

    return warnings
  }, [parseResult, mappings, orgConstraints])

  const executeImport = useCallback(async () => {
    if (!parseResult || !file || !orgId) {
      return
    }
    setIsImporting(true)
    setImportError('')
    setImportSuccess(false)
    try {
      const result = await executeImportRun({
        orgId,
        filename: file.name,
        headers: parseResult.headers,
        rows: parseResult.rows,
        mappings,
        orgConstraints,
        orgCaseTypes,
        orgCategories,
        conflicts,
        resolvedConflicts,
      })
      setImportStats({
        providersCreated: result.providersCreated,
        providersUpdated: result.providersUpdated,
        offeringsUpserted: result.offeringsUpserted,
        newCaseTypes: result.newCaseTypesCount,
        newCategories: result.newCategoriesCount,
      })
      setImportSuccess(true)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }, [
    parseResult,
    file,
    orgId,
    mappings,
    orgConstraints,
    orgCaseTypes,
    orgCategories,
    conflicts,
    resolvedConflicts,
  ])

  const handleTryImportAgain = useCallback(() => {
    setStep(4)
    setImportError('')
    setImportSuccess(false)
  }, [])

  const closeInlineLocationModal = useCallback(() => {
    setInlineModal({ type: null, targetHeader: '' })
    setInlineLocationForm({ name: '', address: '', phone: '' })
    setInlineError('')
  }, [])

  const closeInlineConstraintModal = useCallback(() => {
    setInlineModal({ type: null, targetHeader: '' })
    setInlineConstraintForm({ ...INITIAL_INLINE_CONSTRAINT })
    setInlineError('')
  }, [])

  const handleCreateLocation = useCallback(async () => {
    const name = inlineLocationForm.name.trim()
    if (!name) {
      setInlineError('Location name is required')
      return
    }
    if (!orgId) {
      setInlineError('Organization not found')
      return
    }

    setIsSavingInline(true)
    setInlineError('')
    const { data, error } = await createLocation({
      org_id: orgId,
      name,
      address: inlineLocationForm.address.trim() || undefined,
      phone: inlineLocationForm.phone.trim() || undefined,
    })
    setIsSavingInline(false)

    if (error || !data) {
      setInlineError(error ?? 'Failed to create location')
      return
    }

    setOrgLocations((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))

    const header = inlineModal.targetHeader
    const idx = parseResult?.headers.indexOf(header) ?? -1
    if (idx >= 0) {
      updateMapping(idx, { role: 'location', locationId: data.id })
    }

    closeInlineLocationModal()
    toast.success('Location created')
  }, [closeInlineLocationModal, inlineLocationForm, inlineModal.targetHeader, orgId, parseResult?.headers, toast, updateMapping])

  const handleCreateConstraint = useCallback(async () => {
    const name = inlineConstraintForm.name.trim()
    const type = inlineConstraintForm.type
    const mappedKey = inlineConstraintForm.mapped_key.trim()

    if (!name) {
      setInlineError('Constraint name is required')
      return
    }
    if (!type) {
      setInlineError('Constraint type is required')
      return
    }
    if (!mappedKey) {
      setInlineError('Mapped key is required')
      return
    }
    if (type === 'range' && !inlineConstraintForm.secondary_mapped_key.trim()) {
      setInlineError('Secondary mapped key is required for range constraints')
      return
    }
    if (!orgId) {
      setInlineError('Organization not found')
      return
    }

    setIsSavingInline(true)
    setInlineError('')

    const yesLabel = inlineConstraintForm.yes_label.trim() || 'Yes'
    const noLabel = inlineConstraintForm.no_label.trim() || 'No'
    const yesMaps = (inlineConstraintForm.yes_maps_to || 'both') as '0' | '1' | 'both'
    const noMaps = (inlineConstraintForm.no_maps_to || '0') as '0' | '1' | 'both'

    const payload: Omit<Constraint, 'id' | 'created_at' | 'updated_at'> = {
      org_id: orgId,
      name,
      type,
      mapped_key: mappedKey,
      secondary_mapped_key: type === 'range' ? inlineConstraintForm.secondary_mapped_key.trim() : null,
      min_allowed_value:
        type === 'range' && inlineConstraintForm.min_allowed_value !== ''
          ? Number(inlineConstraintForm.min_allowed_value)
          : null,
      max_allowed_value:
        type === 'range' && inlineConstraintForm.max_allowed_value !== ''
          ? Number(inlineConstraintForm.max_allowed_value)
          : null,
      yes_label: type === 'binary' ? yesLabel : 'Yes',
      no_label: type === 'binary' ? noLabel : 'No',
      yes_maps_to: type === 'binary' ? yesMaps : 'both',
      no_maps_to: type === 'binary' ? noMaps : '0',
      sort_order: 0,
      is_archived: false,
    }

    const { data, error } = await createConstraint(payload)
    setIsSavingInline(false)

    if (error || !data) {
      setInlineError(error ?? 'Failed to create constraint')
      return
    }

    setOrgConstraints((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))

    const header = inlineModal.targetHeader
    const idx = parseResult?.headers.indexOf(header) ?? -1
    if (idx >= 0) {
      updateMapping(idx, {
        role: 'constraint',
        constraintId: data.id,
        rangePosition: data.type === 'range' ? 'min' : undefined,
      })
    }

    closeInlineConstraintModal()
    toast.success('Constraint created')
  }, [closeInlineConstraintModal, inlineConstraintForm, inlineModal.targetHeader, orgId, parseResult?.headers, toast, updateMapping])

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={() => {
        if (inlineModal.type === null) {
          onClose()
        }
      }}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {inlineModal.type === 'location' ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/95">
            <div className="mx-4 w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
              <h3 className="mb-4 font-semibold text-slate-900">Create New Location</h3>
              {inlineError ? (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{inlineError}</div>
              ) : null}
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-slate-700">Location Name (required)</label>
                <input
                  type="text"
                  value={inlineLocationForm.name}
                  onChange={(e) => setInlineLocationForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-slate-700">Address (optional)</label>
                <input
                  type="text"
                  value={inlineLocationForm.address}
                  onChange={(e) => setInlineLocationForm((f) => ({ ...f, address: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-slate-700">Phone (optional)</label>
                <input
                  type="text"
                  value={inlineLocationForm.phone}
                  onChange={(e) => setInlineLocationForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="mt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeInlineLocationModal}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingInline}
                  onClick={() => void handleCreateLocation()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSavingInline ? <LoadingSpinner size="sm" className="border-white border-t-transparent" /> : null}
                  Create Location
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {inlineModal.type === 'constraint' ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/95">
            <div className="mx-4 max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
              <h3 className="mb-4 font-semibold text-slate-900">Create New Constraint</h3>
              {inlineError ? (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{inlineError}</div>
              ) : null}
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-slate-700">Name (required)</label>
                <input
                  type="text"
                  value={inlineConstraintForm.name}
                  onChange={(e) => setInlineConstraintForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="mb-4">
                <span className="mb-2 block text-sm font-medium text-slate-700">Type (required)</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setInlineConstraintForm((f) => ({ ...f, type: 'binary' }))}
                    className={[
                      'flex-1 rounded-lg border-2 px-3 py-3 text-left text-sm',
                      inlineConstraintForm.type === 'binary'
                        ? 'border-green-500 bg-green-50 text-green-900'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    Binary (Yes/No)
                  </button>
                  <button
                    type="button"
                    onClick={() => setInlineConstraintForm((f) => ({ ...f, type: 'range' }))}
                    className={[
                      'flex-1 rounded-lg border-2 px-3 py-3 text-left text-sm',
                      inlineConstraintForm.type === 'range'
                        ? 'border-blue-500 bg-blue-50 text-blue-900'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    Range (Numeric)
                  </button>
                  <button
                    type="button"
                    onClick={() => setInlineConstraintForm((f) => ({ ...f, type: 'exact' }))}
                    className={[
                      'flex-1 rounded-lg border-2 px-3 py-3 text-left text-sm',
                      inlineConstraintForm.type === 'exact'
                        ? 'border-purple-500 bg-purple-50 text-purple-900'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    Exact Match
                  </button>
                </div>
              </div>
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-slate-700">Mapped Key (required)</label>
                <input
                  type="text"
                  value={inlineConstraintForm.mapped_key}
                  onChange={(e) => setInlineConstraintForm((f) => ({ ...f, mapped_key: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="e.g. sports_only"
                />
                <p className="mt-1 text-xs text-slate-500">e.g. sports_only</p>
              </div>

              {inlineConstraintForm.type === 'binary' ? (
                <>
                  <div className="mb-2">
                    <label className="mb-1 block text-sm font-medium text-slate-700">Yes Label (default &quot;Yes&quot;)</label>
                    <input
                      type="text"
                      value={inlineConstraintForm.yes_label}
                      onChange={(e) => setInlineConstraintForm((f) => ({ ...f, yes_label: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Yes"
                    />
                  </div>
                  <div className="mb-2">
                    <label className="mb-1 block text-sm font-medium text-slate-700">No Label (default &quot;No&quot;)</label>
                    <input
                      type="text"
                      value={inlineConstraintForm.no_label}
                      onChange={(e) => setInlineConstraintForm((f) => ({ ...f, no_label: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="No"
                    />
                  </div>
                  <div className="mb-2">
                    <label className="mb-1 block text-sm text-slate-700">When YES is clicked, show:</label>
                    <select
                      value={inlineConstraintForm.yes_maps_to || 'both'}
                      onChange={(e) =>
                        setInlineConstraintForm((f) => ({ ...f, yes_maps_to: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="both">both</option>
                      <option value="1">1</option>
                      <option value="0">0</option>
                    </select>
                  </div>
                  <div className="mb-4">
                    <label className="mb-1 block text-sm text-slate-700">When NO is clicked, show:</label>
                    <select
                      value={inlineConstraintForm.no_maps_to || '0'}
                      onChange={(e) =>
                        setInlineConstraintForm((f) => ({ ...f, no_maps_to: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="both">both</option>
                      <option value="1">1</option>
                      <option value="0">0</option>
                    </select>
                  </div>
                </>
              ) : null}

              {inlineConstraintForm.type === 'range' ? (
                <>
                  <div className="mb-2">
                    <label className="mb-1 block text-sm font-medium text-slate-700">Secondary Mapped Key (required)</label>
                    <input
                      type="text"
                      value={inlineConstraintForm.secondary_mapped_key}
                      onChange={(e) =>
                        setInlineConstraintForm((f) => ({ ...f, secondary_mapped_key: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="e.g. age_max"
                    />
                  </div>
                  <div className="mb-2">
                    <label className="mb-1 block text-sm font-medium text-slate-700">Min Allowed Value</label>
                    <input
                      type="number"
                      value={inlineConstraintForm.min_allowed_value}
                      onChange={(e) =>
                        setInlineConstraintForm((f) => ({ ...f, min_allowed_value: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="mb-4">
                    <label className="mb-1 block text-sm font-medium text-slate-700">Max Allowed Value</label>
                    <input
                      type="number"
                      value={inlineConstraintForm.max_allowed_value}
                      onChange={(e) =>
                        setInlineConstraintForm((f) => ({ ...f, max_allowed_value: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </>
              ) : null}

              <div className="mt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeInlineConstraintModal}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingInline}
                  onClick={() => void handleCreateConstraint()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSavingInline ? <LoadingSpinner size="sm" className="border-white border-t-transparent" /> : null}
                  Create Constraint
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <header className="flex flex-shrink-0 items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="font-semibold text-slate-900">Import Providers</h2>
            <span className="mt-2 inline-block rounded-full bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-700">
              Step {step} of 5
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {step === 1 ? (
            <div>
              <div
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    fileInputRef.current?.click()
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  void handleFile(e.dataTransfer.files[0])
                }}
                className="relative cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-12 text-center hover:border-indigo-400 hover:bg-indigo-50"
              >
                {parseLoading ? (
                  <p className="text-sm text-slate-600">Parsing file…</p>
                ) : (
                  <>
                    <Upload className="mx-auto mb-4 h-12 w-12 text-slate-400" aria-hidden />
                    <p className="font-medium text-slate-600">Drag your CSV or Excel file here</p>
                    <p className="mt-1 text-sm text-indigo-600">or click to browse</p>
                    <p className="mt-2 text-xs text-slate-400">Accepts .csv, .xlsx, .xls</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  void handleFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />

              {parseResult && parseResult.errors.length > 0 ? (
                <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4">
                  <p className="text-sm font-medium text-red-800">Could not parse file</p>
                  <ul className="mt-2 list-inside list-disc text-sm text-red-700">
                    {parseResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {parseOk && file && parseResult ? (
                <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="h-5 w-5 shrink-0 text-green-700" aria-hidden />
                    <span className="text-sm font-medium text-green-900">{file.name}</span>
                    <span className="rounded-full bg-green-200 px-2 py-0.5 text-xs font-medium text-green-800">
                      {parseResult.rowCount} rows found
                    </span>
                  </div>
                  {previewRows.length > 0 ? (
                    <div className="mt-3 overflow-x-auto rounded-lg border border-green-200 bg-white">
                      <table className="w-full min-w-max text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50">
                            {parseResult.headers.map((h) => (
                              <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-slate-700">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.map((row, ri) => (
                            <tr key={ri} className="border-b border-slate-100 last:border-0">
                              {parseResult.headers.map((h) => (
                                <td key={h} className="whitespace-nowrap px-2 py-1.5 text-slate-600">
                                  {row[h] ?? ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 2 && parseResult ? (
            <div>
              {mappingTemplateBanner ? (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Mapping template detected — auto-filled from your last import. Review and confirm.
                </div>
              ) : null}
              <div className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                      <th className="border-b border-slate-200 px-4 py-3 text-left">Your Column</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-left">Maps To</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-left">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.headers.map((header, index) => {
                      const mapping = mappings[index]
                      if (!mapping) {
                        return null
                      }
                      const selectedConstraint =
                        mapping.constraintId && mapping.role === 'constraint'
                          ? orgConstraints.find((c) => c.id === mapping.constraintId)
                          : undefined

                      return (
                        <tr key={header} className="border-b border-slate-100 last:border-0">
                          <td className="px-4 py-3 align-top text-sm font-medium text-slate-700">{header}</td>
                          <td className="px-4 py-3 align-top">
                            <select
                              value={mapping.role}
                              onChange={(e) => {
                                const role = e.target.value as ColumnMapping['role']
                                updateMapping(index, { role })
                              }}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            >
                              {MAP_ROLE_OPTIONS.map((opt) => (
                                <option key={opt.label} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3 align-top">
                            {mapping.role === 'location' ? (
                              <select
                                value={mapping.locationId ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value
                                  if (v === '__create_new__') {
                                    setInlineModal({ type: 'location', targetHeader: header })
                                    setInlineLocationForm({ name: '', address: '', phone: '' })
                                    setInlineError('')
                                    return
                                  }
                                  updateMapping(index, { locationId: v || undefined })
                                }}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                              >
                                <option value="">— Select location —</option>
                                {orgLocations.map((loc) => (
                                  <option key={loc.id} value={loc.id}>
                                    {loc.name}
                                  </option>
                                ))}
                                <option value="__create_new__">＋ Create New Location</option>
                              </select>
                            ) : null}

                            {mapping.role === 'constraint' ? (
                              <div className="space-y-4">
                                <select
                                  value={mapping.constraintId ?? ''}
                                  onChange={(e) => {
                                    const v = e.target.value
                                    if (v === '__create_new__') {
                                      setInlineModal({ type: 'constraint', targetHeader: header })
                                      setInlineConstraintForm({ ...INITIAL_INLINE_CONSTRAINT })
                                      setInlineError('')
                                      return
                                    }
                                    const c = orgConstraints.find((x) => x.id === v)
                                    updateMapping(index, {
                                      constraintId: v || undefined,
                                      rangePosition: c?.type === 'range' ? 'min' : undefined,
                                    })
                                  }}
                                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                >
                                  <option value="">— Select constraint —</option>
                                  {orgConstraints.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name} ({c.type})
                                    </option>
                                  ))}
                                  <option value="__create_new__">＋ Create New Constraint</option>
                                </select>
                                {selectedConstraint?.type === 'range' ? (
                                  <fieldset className="space-y-2">
                                    <legend className="text-xs text-slate-600">This column is:</legend>
                                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                                      <input
                                        type="radio"
                                        name={`range-${header}`}
                                        checked={mapping.rangePosition === 'min'}
                                        onChange={() => updateMapping(index, { rangePosition: 'min' })}
                                        className="text-indigo-600"
                                      />
                                      Min value
                                    </label>
                                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                                      <input
                                        type="radio"
                                        name={`range-${header}`}
                                        checked={mapping.rangePosition === 'max'}
                                        onChange={() => updateMapping(index, { rangePosition: 'max' })}
                                        className="text-indigo-600"
                                      />
                                      Max value
                                    </label>
                                  </fieldset>
                                ) : null}
                              </div>
                            ) : null}

                            {mapping.role === 'booking_link' || mapping.role === 'phone' ? (
                              <select
                                value={mapping.locationScope ?? ''}
                                onChange={(e) => updateMapping(index, { locationScope: e.target.value })}
                                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                              >
                                <option value="">— Select location —</option>
                                <option value="all">All locations</option>
                                {orgLocations.map((loc) => (
                                  <option key={loc.id} value={loc.id}>
                                    {loc.name}
                                  </option>
                                ))}
                              </select>
                            ) : null}

                            {mapping.role !== 'location' &&
                            mapping.role !== 'constraint' &&
                            mapping.role !== 'booking_link' &&
                            mapping.role !== 'phone' ? (
                              <span className="text-sm text-slate-400">—</span>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {!step2Valid ? (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  You must map exactly one column to Provider Name before continuing
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              {conflicts.length === 0 ? (
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-6 text-center">
                  <p className="font-medium text-green-900">No duplicates detected. Ready to import!</p>
                </div>
              ) : (
                <div>
                  <h3 className="mb-2 text-lg font-semibold text-slate-900">
                    We found potential duplicates. How would you like to handle them?
                  </h3>
                  {conflicts.some((c) => c.matchType === 'exact') ? (
                    <div className="mb-4">
                      <button
                        type="button"
                        onClick={() => {
                          const next = { ...resolvedConflicts }
                          conflicts
                            .filter((c) => c.matchType === 'exact')
                            .forEach((c) => {
                              next[String(c.rowIndex)] = 'merge'
                            })
                          setResolvedConflicts(next)
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                      >
                        Auto-merge all exact matches
                      </button>
                    </div>
                  ) : null}
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-max text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
                          <th className="px-3 py-2">Incoming Name</th>
                          <th className="px-3 py-2">Existing Match</th>
                          <th className="px-3 py-2">Match Type</th>
                          <th className="px-3 py-2">Resolution</th>
                        </tr>
                      </thead>
                      <tbody>
                        {conflicts.map((c) => (
                          <tr key={`${c.rowIndex}-${c.existingProvider.id}`} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-2 font-medium text-slate-800">{c.incomingName}</td>
                            <td className="px-3 py-2 text-slate-700">{c.existingProvider.name}</td>
                            <td className="px-3 py-2">
                              {c.matchType === 'exact' ? (
                                <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                  Exact Match
                                </span>
                              ) : (
                                <span className="inline-flex rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                                  Similar Name
                                  {c.similarity !== undefined
                                    ? ` (${Math.round(c.similarity * 100)}%)`
                                    : ''}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                                  <input
                                    type="radio"
                                    name={`resolution-${c.rowIndex}`}
                                    checked={resolvedConflicts[String(c.rowIndex)] === 'merge'}
                                    onChange={() =>
                                      setResolvedConflicts((prev) => ({
                                        ...prev,
                                        [String(c.rowIndex)]: 'merge',
                                      }))
                                    }
                                    className="text-indigo-600"
                                  />
                                  Merge (update existing)
                                </label>
                                <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                                  <input
                                    type="radio"
                                    name={`resolution-${c.rowIndex}`}
                                    checked={resolvedConflicts[String(c.rowIndex)] === 'separate'}
                                    onChange={() =>
                                      setResolvedConflicts((prev) => ({
                                        ...prev,
                                        [String(c.rowIndex)]: 'separate',
                                      }))
                                    }
                                    className="text-indigo-600"
                                  />
                                  Keep Separate (create new)
                                </label>
                                <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                                  <input
                                    type="radio"
                                    name={`resolution-${c.rowIndex}`}
                                    checked={resolvedConflicts[String(c.rowIndex)] === 'skip'}
                                    onChange={() =>
                                      setResolvedConflicts((prev) => ({
                                        ...prev,
                                        [String(c.rowIndex)]: 'skip',
                                      }))
                                    }
                                    className="text-indigo-600"
                                  />
                                  Skip row
                                </label>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : null}
          {step === 4 && parseResult ? (
            <div>
              <h3 className="mb-4 text-lg font-semibold text-slate-900">Preview import</h3>
              <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-center">
                  <p className="text-xs font-medium uppercase text-slate-500">New providers</p>
                  <p className="text-2xl font-semibold text-slate-900">{previewStats.newProviders}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-center">
                  <p className="text-xs font-medium uppercase text-slate-500">Updated providers</p>
                  <p className="text-2xl font-semibold text-slate-900">{previewStats.updatedProviders}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-center">
                  <p className="text-xs font-medium uppercase text-slate-500">Skipped</p>
                  <p className="text-2xl font-semibold text-slate-900">{previewStats.skippedRows}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-center">
                  <p className="text-xs font-medium uppercase text-slate-500">New case types</p>
                  <p className="text-2xl font-semibold text-slate-900">{previewStats.newCaseTypes}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-center">
                  <p className="text-xs font-medium uppercase text-slate-500">New categories</p>
                  <p className="text-2xl font-semibold text-slate-900">{previewStats.newCategories}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-center">
                  <p className="text-xs font-medium uppercase text-slate-500">Total offerings</p>
                  <p className="text-2xl font-semibold text-slate-900">{previewStats.totalOfferings}</p>
                </div>
              </div>

              {previewWarnings.length > 0 ? (
                <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  <p className="mb-2 font-medium">Warnings</p>
                  <ul className="max-h-40 list-inside list-disc space-y-1 overflow-y-auto text-xs">
                    {previewWarnings.slice(0, 40).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                  {previewWarnings.length > 40 ? (
                    <p className="mt-2 text-xs text-amber-800">…and {previewWarnings.length - 40} more</p>
                  ) : null}
                </div>
              ) : null}

              <div className="overflow-x-auto text-xs">
                <table className="w-full min-w-max border border-slate-200">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      {parseResult.headers.map((h) => (
                        <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-slate-700">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.rows.slice(0, 20).map((row, ri) => (
                      <tr key={ri} className="border-b border-slate-100 last:border-0">
                        {parseResult.headers.map((h) => (
                          <td key={h} className="whitespace-nowrap px-2 py-1.5 text-slate-600">
                            {row[h] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={() => {
                  setStep(5)
                  setImportError('')
                  setImportSuccess(false)
                  setIsImporting(true)
                  void executeImport()
                }}
                className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Import →
              </button>
            </div>
          ) : null}
          {step === 5 ? (
            <div className="min-h-[240px]">
              {isImporting && !importSuccess && !importError ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <LoadingSpinner size="lg" className="mx-auto mb-4" />
                  <p className="text-center text-lg font-medium text-slate-800">Importing your data…</p>
                </div>
              ) : null}

              {importError ? (
                <div>
                  <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{importError}</div>
                  <button
                    type="button"
                    onClick={handleTryImportAgain}
                    className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    Try Again
                  </button>
                </div>
              ) : null}

              {importSuccess ? (
                <div className="py-4">
                  <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-green-500" aria-hidden />
                  <h3 className="mb-2 text-center text-2xl font-bold text-slate-900">Import Complete!</h3>
                  <p className="mb-6 text-center text-slate-600">
                    {importStats.providersCreated} providers added, {importStats.providersUpdated} updated,{' '}
                    {importStats.offeringsUpserted} offerings imported
                  </p>
                  <button
                    type="button"
                    onClick={onComplete}
                    className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    Done
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="flex flex-shrink-0 justify-between border-t border-slate-200 px-6 py-4">
          <div>
            {step > 1 && !(step === 5 && isImporting) && !(step === 5 && importSuccess) ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4 | 5) : s))}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Back
              </button>
            ) : (
              <span />
            )}
          </div>
          {step === 1 || step === 2 || step === 3 ? (
            <button
              type="button"
              disabled={
                (step === 1 && (!parseOk || parseLoading)) ||
                (step === 2 && !step2Valid) ||
                (step === 3 && !step3CanContinue)
              }
              onClick={() => {
                setStep((s) => (s < 5 ? ((s + 1) as 1 | 2 | 3 | 4 | 5) : s))
              }}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          ) : (
            <span />
          )}
        </footer>
      </div>
    </div>
  )
}
