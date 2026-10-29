import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { Archive, Download, Pencil, Plus } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import ImportWizard from '../../components/import/ImportWizard'
import OfferingModal from '../../components/modals/OfferingModal'
import { emptyOfferingDraft, type OfferingDraft } from '../../components/modals/offeringDraft'
import ArchivedOfferingsView from './ArchivedOfferingsView'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useToast } from '../../components/ui/toastStore'
import {
  archiveAllOfferings,
  archiveOfferings,
  getDataTableOfferings,
  updateOfferingCaseType,
  updateOfferingConstraint,
  updateOfferingLocationIds,
  updateProviderCategories,
} from '../../lib/api/dataTable'
import { createOffering } from '../../lib/api/offerings'
import { getProviders } from '../../lib/api/providers'
import { invalidateOfferingReaders } from '../../lib/invalidateOfferingReaders'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import type { CaseType, Category, Constraint, Location } from '../../types/database'

function getProvider(offering: Record<string, unknown>) {
  const provider = offering.providers
  if (Array.isArray(provider)) return provider[0] ?? null
  return provider ?? null
}

function patchProvider(
  offering: Record<string, unknown>,
  patcher: (provider: Record<string, unknown>) => Record<string, unknown>
) {
  const provider = offering.providers
  if (Array.isArray(provider)) {
    const first = provider[0]
    if (!first || typeof first !== 'object') return offering
    return { ...offering, providers: [patcher(first as Record<string, unknown>), ...provider.slice(1)] }
  }
  if (provider && typeof provider === 'object') {
    return { ...offering, providers: patcher(provider as Record<string, unknown>) }
  }
  return offering
}

type TriState = 'both' | 'yes' | 'no'

function isBinaryYes(value: unknown): boolean {
  return value === 1 || value === '1' || value === true
}

interface ColumnVisibilityState {
  locations: Record<string, boolean>
  constraints: Record<string, boolean>
}

const defaultVisibility = (): ColumnVisibilityState => ({ locations: {}, constraints: {} })

export default function DataTablePage() {
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const orgName = useAuthStore((s) => s.org?.name ?? 'org')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [compactMode, setCompactMode] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const [caseTypeEditorOfferingId, setCaseTypeEditorOfferingId] = useState<string | null>(null)
  const [categoryEditorProviderId, setCategoryEditorProviderId] = useState<string | null>(null)
  const [caseTypeSavedOfferingId, setCaseTypeSavedOfferingId] = useState<string | null>(null)
  const [archiveTargetId, setArchiveTargetId] = useState<string | null>(null)
  const [clearAllOpen, setClearAllOpen] = useState(false)
  const [clearAllInput, setClearAllInput] = useState('')
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false)
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set())
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(defaultVisibility)
  const [showImport, setShowImport] = useState(false)
  const [addOfferingOpen, setAddOfferingOpen] = useState(false)
  const [addOfferingSaving, setAddOfferingSaving] = useState(false)
  const [addOfferingError, setAddOfferingError] = useState('')
  const [view, setView] = useState<'active' | 'archived'>('active')
  const exactDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({})
  const columnVisibilityInitialized = useRef(false)

  const [filterCaseTypeId, setFilterCaseTypeId] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState('')
  const [filterLocation, setFilterLocation] = useState<Record<string, TriState>>({})
  const [filterBinary, setFilterBinary] = useState<Record<string, TriState>>({})
  const [filterRangeMin, setFilterRangeMin] = useState<Record<string, string>>({})
  const [filterRangeMax, setFilterRangeMax] = useState<Record<string, string>>({})
  const [filterExact, setFilterExact] = useState<Record<string, string>>({})

  const [bulkAddLocationId, setBulkAddLocationId] = useState('')
  const [bulkRemoveLocationId, setBulkRemoveLocationId] = useState('')
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const offeringsQueryKey = useMemo(
    () => ['data-table-offerings', orgId] as const,
    [orgId]
  )

  const { data: offerings = [], isLoading: offeringsLoading } = useQuery({
    queryKey: ['data-table-offerings', orgId],
    queryFn: () => getDataTableOfferings(orgId),
    enabled: Boolean(orgId),
  })

  const { data: locations = [], isLoading: locationsLoading } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('locations')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .order('name', { ascending: true })
      return (data ?? []) as Location[]
    },
    enabled: Boolean(orgId),
  })

  const { data: constraints = [], isLoading: constraintsLoading } = useQuery({
    queryKey: ['constraints', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('constraints')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_archived', false)
      return (data ?? []) as Constraint[]
    },
    enabled: Boolean(orgId),
  })

  const { data: caseTypes = [], isLoading: caseTypesLoading } = useQuery({
    queryKey: ['case-types', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('case_types')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_archived', false)
      return (data ?? []) as CaseType[]
    },
    enabled: Boolean(orgId),
  })

  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['categories', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_archived', false)
      return (data ?? []) as Category[]
    },
    enabled: Boolean(orgId),
  })

  // Only needed by the add dialog, so it is not fetched until that opens.
  const { data: providers = [] } = useQuery({
    queryKey: ['providers', orgId],
    queryFn: () => getProviders(orgId),
    enabled: Boolean(orgId) && addOfferingOpen,
  })

  function openAddOffering() {
    setAddOfferingError('')
    setAddOfferingOpen(true)
  }

  async function handleAddOffering(draft: OfferingDraft) {
    setAddOfferingSaving(true)
    setAddOfferingError('')
    const result = await createOffering({
      provider_id: draft.providerId,
      case_type_id: draft.caseTypeId,
      org_id: orgId,
      location_ids: draft.locationIds,
      constraints: draft.constraints,
    })
    setAddOfferingSaving(false)
    if (result.error) {
      setAddOfferingError(result.error)
      return
    }
    await invalidateOfferingReaders(queryClient, orgId)
    setAddOfferingOpen(false)
    toast.success('Offering added')
  }

  // Load compact mode from localStorage once on mount
  useEffect(() => {
    const saved = localStorage.getItem(`pm-compact-${orgId}`)
    setCompactMode(saved === 'true')
  }, [orgId])

  // Save compact mode to localStorage when it changes
  useEffect(() => {
    if (!orgId) return
    localStorage.setItem(`pm-compact-${orgId}`, String(compactMode))
  }, [compactMode, orgId])

  // Load column visibility from localStorage ONCE per orgId — ref guard prevents infinite loop
  useEffect(() => {
    if (!orgId || columnVisibilityInitialized.current) return
    columnVisibilityInitialized.current = true
    try {
      const raw = localStorage.getItem(`pm-columns-${orgId}`)
      if (!raw) {
        setColumnVisibility(defaultVisibility())
        return
      }
      const parsed = JSON.parse(raw) as ColumnVisibilityState
      setColumnVisibility({
        locations: parsed.locations ?? {},
        constraints: parsed.constraints ?? {},
      })
    } catch {
      setColumnVisibility(defaultVisibility())
    }
  }, [orgId])

  // Save column visibility to localStorage when it changes
  useEffect(() => {
    if (!orgId) return
    localStorage.setItem(`pm-columns-${orgId}`, JSON.stringify(columnVisibility))
  }, [columnVisibility, orgId])

  const isLocationVisible = useCallback(
    (locationId: string) => columnVisibility.locations[locationId] !== false,
    [columnVisibility.locations]
  )

  const isConstraintVisible = useCallback(
    (constraintId: string) => columnVisibility.constraints[constraintId] !== false,
    [columnVisibility.constraints]
  )

  const setLocationColumnVisible = (locationId: string, visible: boolean) => {
    setColumnVisibility((prev) => ({
      ...prev,
      locations: { ...prev.locations, [locationId]: visible },
    }))
  }

  const setConstraintColumnVisible = (constraintId: string, visible: boolean) => {
    setColumnVisibility((prev) => ({
      ...prev,
      constraints: { ...prev.constraints, [constraintId]: visible },
    }))
  }

  const filteredOfferings = useMemo(() => {
    const term = searchQuery.trim().toLowerCase()

    return offerings.filter((offering) => {
      const provider = getProvider(offering)
      const providerName = String(provider?.name ?? '').toLowerCase()
      if (term && !providerName.includes(term)) return false

      if (filterCaseTypeId && offering.case_type_id !== filterCaseTypeId) return false

      if (filterCategoryId) {
        const ids: string[] = provider?.category_ids ?? []
        if (!ids.includes(filterCategoryId)) return false
      }

      const locIds: string[] = (offering.location_ids as string[]) ?? []
      for (const loc of locations) {
        const mode = filterLocation[loc.id] ?? 'both'
        if (mode === 'both') continue
        const has = locIds.includes(loc.id)
        if (mode === 'yes' && !has) return false
        if (mode === 'no' && has) return false
      }

      const cons = (offering.constraints ?? {}) as Record<string, unknown>

      for (const c of constraints) {
        if (c.type === 'binary') {
          const mode = filterBinary[c.id] ?? 'both'
          if (mode === 'both') continue
          const yes = isBinaryYes(cons[c.mapped_key])
          if (mode === 'yes' && !yes) return false
          if (mode === 'no' && yes) return false
        } else if (c.type === 'range') {
          const fMin = filterRangeMin[c.id]
          const fMax = filterRangeMax[c.id]
          if ((fMin === undefined || fMin === '') && (fMax === undefined || fMax === '')) continue
          const vmin = cons[c.mapped_key]
          const vmax = c.secondary_mapped_key ? cons[c.secondary_mapped_key] : undefined
          const nMin = typeof vmin === 'number' ? vmin : Number(vmin)
          const nMax = typeof vmax === 'number' ? vmax : Number(vmax)
          if (fMin !== undefined && fMin !== '' && !Number.isNaN(Number(fMin))) {
            if (Number.isNaN(nMin) || nMin < Number(fMin)) return false
          }
          if (fMax !== undefined && fMax !== '' && !Number.isNaN(Number(fMax))) {
            if (Number.isNaN(nMax) || nMax > Number(fMax)) return false
          }
        } else if (c.type === 'exact') {
          const ft = (filterExact[c.id] ?? '').trim().toLowerCase()
          if (!ft) continue
          const val = String(cons[c.mapped_key] ?? '').toLowerCase()
          if (!val.includes(ft)) return false
        }
      }

      return true
    })
  }, [
    offerings,
    searchQuery,
    filterCaseTypeId,
    filterCategoryId,
    locations,
    filterLocation,
    constraints,
    filterBinary,
    filterRangeMin,
    filterRangeMax,
    filterExact,
  ])

  // Clean up selected rows when filtered offerings change
  useEffect(() => {
    const validIds = new Set(filteredOfferings.map((offering) => offering.id as string))
    setSelectedRows((prev) => {
      const next = new Set<string>()
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id)
      })
      // Only update if something actually changed
      if (next.size === prev.size) return prev
      return next
    })
  }, [filteredOfferings])

  const caseTypeMap = useMemo(() => {
    const map = new Map<string, string>()
    caseTypes.forEach((item) => map.set(item.id, item.name))
    return map
  }, [caseTypes])

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>()
    categories.forEach((item) => map.set(item.id, item.name))
    return map
  }, [categories])

  const allFilteredIds = filteredOfferings.map((offering) => offering.id as string)
  const allSelected =
    allFilteredIds.length > 0 && allFilteredIds.every((offeringId) => selectedRows.has(offeringId))

  const startSave = (key: string) => {
    setSavingCells((prev) => new Set(prev).add(key))
  }
  const endSave = (key: string) => {
    setSavingCells((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  const patchOfferingCache = useCallback(
    (offeringId: string, patcher: (offering: Record<string, unknown>) => Record<string, unknown>) => {
      queryClient.setQueryData(offeringsQueryKey, (prev: Record<string, unknown>[] | undefined) =>
        (prev ?? []).map((offering) => (offering.id === offeringId ? patcher(offering) : offering))
      )
    },
    [offeringsQueryKey, queryClient]
  )

  const toggleOfferingLocation = useCallback(
    async (offering: Record<string, unknown>, locationId: string) => {
      const oid = offering.id as string
      const key = `${oid}:loc:${locationId}`
      const current: string[] = [...((offering.location_ids as string[]) ?? [])]
      const has = current.includes(locationId)
      const next = has ? current.filter((id) => id !== locationId) : [...current, locationId]
      const previousOfferings = queryClient.getQueryData<Record<string, unknown>[]>(offeringsQueryKey)

      patchOfferingCache(oid, (cached) => ({ ...cached, location_ids: next }))

      startSave(key)
      const result = await updateOfferingLocationIds(oid, next)
      endSave(key)

      if (result.error) {
        toast.error(result.error)
        queryClient.setQueryData(offeringsQueryKey, previousOfferings)
        return
      }
    },
    [offeringsQueryKey, patchOfferingCache, queryClient, toast]
  )

  const toggleBinaryConstraint = useCallback(
    async (offering: Record<string, unknown>, constraint: Constraint) => {
      const oid = offering.id as string
      const key = `${oid}:con:${constraint.id}:bin`
      const cons = { ...((offering.constraints ?? {}) as Record<string, unknown>) }
      const current = cons[constraint.mapped_key]
      const isYes = isBinaryYes(current)
      const newVal = isYes ? 0 : 1
      const previousOfferings = queryClient.getQueryData<Record<string, unknown>[]>(offeringsQueryKey)

      patchOfferingCache(oid, (cached) => ({
        ...cached,
        constraints: {
          ...((cached.constraints ?? {}) as Record<string, unknown>),
          [constraint.mapped_key]: newVal,
        },
      }))

      startSave(key)
      const result = await updateOfferingConstraint(oid, constraint.mapped_key, newVal)
      endSave(key)

      if (result.error) {
        toast.error(result.error)
        queryClient.setQueryData(offeringsQueryKey, previousOfferings)
        return
      }
    },
    [offeringsQueryKey, patchOfferingCache, queryClient, toast]
  )

  const visibleLocations = useMemo(
    () => locations.filter((l) => isLocationVisible(l.id)),
    [locations, isLocationVisible]
  )
  const visibleConstraints = useMemo(
    () => constraints.filter((c) => isConstraintVisible(c.id)),
    [constraints, isConstraintVisible]
  )

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    const base: ColumnDef<Record<string, unknown>>[] = [
      {
        id: 'select',
        header: () => (
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => {
              const checked = e.target.checked
              setSelectedRows((prev) => {
                const next = new Set(prev)
                if (checked) {
                  allFilteredIds.forEach((id) => next.add(id))
                } else {
                  allFilteredIds.forEach((id) => next.delete(id))
                }
                return next
              })
            }}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selectedRows.has(row.original.id as string)}
            onChange={(e) => {
              const checked = e.target.checked
              const offeringId = row.original.id as string
              setSelectedRows((prev) => {
                const next = new Set(prev)
                if (checked) next.add(offeringId)
                else next.delete(offeringId)
                return next
              })
            }}
          />
        ),
        size: 40,
      },
      {
        id: 'providerName',
        header: 'PROVIDER NAME',
        accessorFn: (row) => String(getProvider(row)?.name ?? ''),
        cell: ({ row }) => (
          <span className="text-sm text-slate-800">{String(getProvider(row.original)?.name ?? 'Unknown')}</span>
        ),
      },
      {
        id: 'caseType',
        header: 'CASE TYPE',
        cell: ({ row }) => {
          const offering = row.original
          const isEditing = caseTypeEditorOfferingId === offering.id
          if (isEditing) {
            return (
              <select
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                value={(offering.case_type_id as string) ?? ''}
                onChange={async (e) => {
                  const nextCaseTypeId = e.target.value
                  const previousOfferings = queryClient.getQueryData<Record<string, unknown>[]>(offeringsQueryKey)
                  patchOfferingCache(offering.id as string, (cached) => ({
                    ...cached,
                    case_type_id: nextCaseTypeId,
                  }))

                  const result = await updateOfferingCaseType(offering.id as string, nextCaseTypeId)
                  if (result.error) {
                    toast.error(result.error)
                    queryClient.setQueryData(offeringsQueryKey, previousOfferings)
                    return
                  }
                  setCaseTypeEditorOfferingId(null)
                  setCaseTypeSavedOfferingId(offering.id as string)
                  toast.success('Case type updated')
                  window.setTimeout(() => setCaseTypeSavedOfferingId(null), 1200)
                }}
                onBlur={() => setCaseTypeEditorOfferingId(null)}
                autoFocus
              >
                {caseTypes.map((caseType) => (
                  <option key={caseType.id} value={caseType.id}>
                    {caseType.name}
                  </option>
                ))}
              </select>
            )
          }

          return (
            <button
              type="button"
              className={[
                'text-left text-sm',
                caseTypeSavedOfferingId === offering.id ? 'text-emerald-600' : 'text-slate-700',
              ].join(' ')}
              onClick={() => setCaseTypeEditorOfferingId(offering.id as string)}
            >
              {caseTypeMap.get(offering.case_type_id as string) ?? 'Unknown'}
            </button>
          )
        },
      },
      {
        id: 'category',
        header: 'CATEGORY',
        cell: ({ row }) => {
          const provider = getProvider(row.original)
          if (!provider?.id) return <span className="text-sm text-slate-500">—</span>
          const providerCategoryIds: string[] = (provider.category_ids as string[]) ?? []
          const isOpen = categoryEditorProviderId === provider.id
          const names = providerCategoryIds
            .map((id: string) => categoryMap.get(id))
            .filter((name: string | undefined): name is string => Boolean(name))

          return (
            <div className="relative">
              <button
                type="button"
                className="flex flex-wrap gap-1 text-left"
                onClick={() => setCategoryEditorProviderId(isOpen ? null : provider.id as string)}
              >
                {names.length === 0 ? (
                  <span className="text-sm text-slate-500">—</span>
                ) : (
                  names.map((name) => (
                    <span
                      key={`${provider.id as string}-${name}`}
                      className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700"
                    >
                      {name}
                    </span>
                  ))
                )}
              </button>
              {isOpen ? (
                <div className="absolute left-0 top-8 z-20 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                  {categories.map((category) => (
                    <label key={category.id} className="flex items-center gap-2 px-2 py-1 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={providerCategoryIds.includes(category.id)}
                        onChange={async (e) => {
                          const next = e.target.checked
                            ? [...providerCategoryIds, category.id]
                            : providerCategoryIds.filter((id: string) => id !== category.id)
                          const providerId = provider.id as string
                          const previousOfferings = queryClient.getQueryData<Record<string, unknown>[]>(offeringsQueryKey)
                          queryClient.setQueryData(
                            offeringsQueryKey,
                            (prev: Record<string, unknown>[] | undefined) =>
                              (prev ?? []).map((cachedOffering) =>
                                (cachedOffering.provider_id as string) === providerId
                                  ? patchProvider(cachedOffering, (cachedProvider) => ({
                                      ...cachedProvider,
                                      category_ids: next,
                                    }))
                                  : cachedOffering
                              )
                          )

                          const result = await updateProviderCategories(provider.id as string, next)
                          if (result.error) {
                            toast.error(result.error)
                            queryClient.setQueryData(offeringsQueryKey, previousOfferings)
                            return
                          }
                          toast.success('Categories updated')
                        }}
                      />
                      {category.name}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          )
        },
      },
    ]

    visibleLocations.forEach((location) => {
      base.push({
        id: `loc-${location.id}`,
        header: () => (
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-indigo-500" />
            {/* FIX: null guard on location.name */}
            LOCATION: {(location.name ?? '').toUpperCase()}
          </span>
        ),
        cell: ({ row }) => {
          const offering = row.original
          const locIds: string[] = (offering.location_ids as string[]) ?? []
          const has = locIds.includes(location.id)
          const key = `${offering.id as string}:loc:${location.id}`
          const saving = savingCells.has(key)

          return (
            <div className="relative inline-block">
              <button
                type="button"
                onClick={() => toggleOfferingLocation(offering, location.id)}
                className={[
                  'rounded-full border px-3 py-1 text-xs font-medium',
                  has
                    ? 'border-green-200 bg-green-100 text-green-700'
                    : 'border-slate-200 bg-slate-100 text-slate-500',
                ].join(' ')}
              >
                {has ? 'YES' : 'NO'}
              </button>
              {saving ? (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-white/70">
                  <LoadingSpinner size="sm" />
                </div>
              ) : null}
            </div>
          )
        },
      })
    })

    visibleConstraints.forEach((constraint) => {
      const dotColor =
        constraint.type === 'binary' ? 'bg-green-500' : constraint.type === 'range' ? 'bg-blue-500' : 'bg-purple-500'

      base.push({
        id: `con-${constraint.id}`,
        header: () => (
          <span className="inline-flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${dotColor}`} />
            {constraint.name}
          </span>
        ),
        cell: ({ row }) => {
          const offering = row.original
          const cons = (offering.constraints ?? {}) as Record<string, unknown>

          if (constraint.type === 'binary') {
            const yes = isBinaryYes(cons[constraint.mapped_key])
            const key = `${offering.id as string}:con:${constraint.id}:bin`
            const saving = savingCells.has(key)
            return (
              <div className="relative inline-block">
                <button
                  type="button"
                  onClick={() => toggleBinaryConstraint(offering, constraint)}
                  className={[
                    'rounded-full border px-3 py-1 text-xs font-medium',
                    yes ? 'border-green-200 bg-green-100 text-green-700' : 'border-slate-200 bg-slate-100 text-slate-500',
                  ].join(' ')}
                >
                  {yes ? 'YES' : 'NO'}
                </button>
                {saving ? (
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-white/70">
                    <LoadingSpinner size="sm" />
                  </div>
                ) : null}
              </div>
            )
          }

          if (constraint.type === 'range') {
            const minKey = constraint.mapped_key
            const maxKey = constraint.secondary_mapped_key ?? ''
            const minVal = cons[minKey]
            const maxVal = maxKey ? cons[maxKey] : ''
            const nMin = typeof minVal === 'number' ? minVal : Number(minVal)
            const nMax = typeof maxVal === 'number' ? maxVal : Number(maxVal)
            const invalid = !Number.isNaN(nMin) && !Number.isNaN(nMax) && nMin > nMax

            return (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  defaultValue={minVal === undefined || minVal === null ? '' : String(minVal)}
                  className={`w-16 rounded border px-1 py-0.5 text-xs ${invalid ? 'border-red-500' : 'border-slate-300'}`}
                  onBlur={async (e) => {
                    const v = e.target.value
                    const num = v === '' ? NaN : Number(v)
                    const nextValue = v === '' ? null : Number.isNaN(num) ? v : num
                    const key = `${offering.id as string}:con:${constraint.id}:rmin`
                    const previousOfferings = queryClient.getQueryData<Record<string, unknown>[]>(offeringsQueryKey)
                    patchOfferingCache(offering.id as string, (cached) => ({
                      ...cached,
                      constraints: {
                        ...((cached.constraints ?? {}) as Record<string, unknown>),
                        [minKey]: nextValue,
                      },
                    }))
                    startSave(key)
                    const result = await updateOfferingConstraint(
                      offering.id as string,
                      minKey,
                      nextValue
                    )
                    endSave(key)
                    if (result.error) {
                      toast.error(result.error)
                      queryClient.setQueryData(offeringsQueryKey, previousOfferings)
                      return
                    }
                  }}
                />
                <input
                  type="number"
                  defaultValue={maxVal === undefined || maxVal === null || maxVal === '' ? '' : String(maxVal)}
                  className={`w-16 rounded border px-1 py-0.5 text-xs ${invalid ? 'border-red-500' : 'border-slate-300'}`}
                  onBlur={async (e) => {
                    if (!maxKey) return
                    const v = e.target.value
                    const num = v === '' ? NaN : Number(v)
                    const nextValue = v === '' ? null : Number.isNaN(num) ? v : num
                    const key = `${offering.id as string}:con:${constraint.id}:rmax`
                    const previousOfferings = queryClient.getQueryData<Record<string, unknown>[]>(offeringsQueryKey)
                    patchOfferingCache(offering.id as string, (cached) => ({
                      ...cached,
                      constraints: {
                        ...((cached.constraints ?? {}) as Record<string, unknown>),
                        [maxKey]: nextValue,
                      },
                    }))
                    startSave(key)
                    const result = await updateOfferingConstraint(
                      offering.id as string,
                      maxKey,
                      nextValue
                    )
                    endSave(key)
                    if (result.error) {
                      toast.error(result.error)
                      queryClient.setQueryData(offeringsQueryKey, previousOfferings)
                      return
                    }
                  }}
                />
              </div>
            )
          }

          const exactKey = `exact-${offering.id as string}-${constraint.id}`
          return (
            <input
              type="text"
              defaultValue={String(cons[constraint.mapped_key] ?? '')}
              className="w-28 rounded border border-slate-300 px-2 py-1 text-xs"
              onBlur={(e) => {
                const val = e.target.value
                const t = exactDebounceRef.current[exactKey]
                if (t) clearTimeout(t)
                exactDebounceRef.current[exactKey] = setTimeout(async () => {
                  const key = `${offering.id as string}:con:${constraint.id}:ex`
                  const previousOfferings = queryClient.getQueryData<Record<string, unknown>[]>(offeringsQueryKey)
                  patchOfferingCache(offering.id as string, (cached) => ({
                    ...cached,
                    constraints: {
                      ...((cached.constraints ?? {}) as Record<string, unknown>),
                      [constraint.mapped_key]: val,
                    },
                  }))
                  startSave(key)
                  const result = await updateOfferingConstraint(offering.id as string, constraint.mapped_key, val)
                  endSave(key)
                  if (result.error) {
                    toast.error(result.error)
                    queryClient.setQueryData(offeringsQueryKey, previousOfferings)
                    return
                  }
                }, 300)
              }}
            />
          )
        },
      })
    })

    base.push({
      id: 'actions',
      header: 'ACTIONS',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate(`/providers/${row.original.provider_id as string}`)}>
            <Pencil className="h-4 w-4 text-slate-500 hover:text-slate-700" />
          </button>
          <button type="button" onClick={() => setArchiveTargetId(row.original.id as string)}>
            <Archive className="h-4 w-4 text-red-400 hover:text-red-600" />
          </button>
        </div>
      ),
      size: 80,
    })

    return base
  }, [
    allFilteredIds,
    allSelected,
    caseTypeEditorOfferingId,
    caseTypeMap,
    caseTypeSavedOfferingId,
    caseTypes,
    categories,
    categoryEditorProviderId,
    categoryMap,
    navigate,
    offeringsQueryKey,
    patchOfferingCache,
    queryClient,
    selectedRows,
    toast,
    visibleLocations,
    visibleConstraints,
    savingCells,
    toggleOfferingLocation,
    toggleBinaryConstraint,
  ])

  // TanStack Table intentionally returns functions that cannot be safely
  // memoized by React Compiler; the table instance is already hook-managed.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredOfferings,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: 50, pageIndex: 0 },
    },
  })

  const headerColumns = table.getHeaderGroups()[0]?.headers ?? []

  const handleExport = () => {
    const date = new Date().toISOString().slice(0, 10)
    const safeOrg = orgName.replace(/[^\w-]+/g, '_')
    const exportRows: Record<string, unknown>[] = []

    for (const offering of filteredOfferings) {
      const provider = getProvider(offering)
      const categoryNames = ((provider?.category_ids as string[]) ?? [])
        .map((cid: string) => categoryMap.get(cid))
        .filter(Boolean)
        .join(', ')

      const row: Record<string, unknown> = {
        'Provider Name': provider?.name ?? '',
        'Case Type': caseTypeMap.get(offering.case_type_id as string) ?? '',
        Category: categoryNames,
      }

      visibleLocations.forEach((loc) => {
        const has = ((offering.location_ids as string[]) ?? []).includes(loc.id)
        row[`Location: ${loc.name ?? ''}`] = has ? 1 : 0
      })

      visibleConstraints.forEach((c) => {
        const cons = (offering.constraints ?? {}) as Record<string, unknown>
        if (c.type === 'binary') {
          row[`Constraint: ${c.name}`] = isBinaryYes(cons[c.mapped_key]) ? 1 : 0
        } else if (c.type === 'range') {
          row[`Constraint: ${c.name} (min)`] = cons[c.mapped_key] ?? ''
          if (c.secondary_mapped_key) {
            row[`Constraint: ${c.name} (max)`] = cons[c.secondary_mapped_key] ?? ''
          }
        } else {
          row[`Constraint: ${c.name}`] = cons[c.mapped_key] ?? ''
        }
      })

      exportRows.push(row)
    }

    const ws = XLSX.utils.json_to_sheet(exportRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Offerings')
    XLSX.writeFile(wb, `${safeOrg}_providers_${date}.xlsx`)
  }

  const runBulkAddLocation = async () => {
    if (!bulkAddLocationId) return
    const ids = Array.from(selectedRows)
    for (const oid of ids) {
      const offering = offerings.find((o) => o.id === oid)
      if (!offering) continue
      const locIds = [...((offering.location_ids as string[]) ?? [])]
      if (!locIds.includes(bulkAddLocationId)) locIds.push(bulkAddLocationId)
      const res = await updateOfferingLocationIds(oid, locIds)
      if (res.error) {
        toast.error(res.error)
        return
      }
    }
    await invalidateOfferingReaders(queryClient, orgId)
    toast.success('Location added to selected offerings')
    setBulkAddLocationId('')
  }

  const runBulkRemoveLocation = async () => {
    if (!bulkRemoveLocationId) return
    const ids = Array.from(selectedRows)
    for (const oid of ids) {
      const offering = offerings.find((o) => o.id === oid)
      if (!offering) continue
      const locIds = ((offering.location_ids as string[]) ?? []).filter((id: string) => id !== bulkRemoveLocationId)
      const res = await updateOfferingLocationIds(oid, locIds)
      if (res.error) {
        toast.error(res.error)
        return
      }
    }
    await invalidateOfferingReaders(queryClient, orgId)
    toast.success('Location removed from selected offerings')
    setBulkRemoveLocationId('')
  }

  const runBulkSetCategory = async () => {
    if (!bulkCategoryId) return
    const seenProviders = new Set<string>()
    for (const oid of selectedRows) {
      const offering = offerings.find((o) => o.id === oid)
      if (!offering) continue
      const pid = offering.provider_id as string
      if (seenProviders.has(pid)) continue
      seenProviders.add(pid)
      const prov = getProvider(offering)
      const current: string[] = [...((prov?.category_ids as string[]) ?? [])]
      if (current.includes(bulkCategoryId)) continue
      const res = await updateProviderCategories(pid, [...current, bulkCategoryId])
      if (res.error) {
        toast.error(res.error)
        return
      }
    }
    await invalidateOfferingReaders(queryClient, orgId)
    toast.success('Category applied to selected providers')
    setBulkCategoryId('')
  }

  const referencesLoadedCount =
    locations.length + constraints.length + caseTypes.length + categories.length

  if (offeringsLoading || locationsLoading || constraintsLoading || caseTypesLoading || categoriesLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-slate-500">Manage offerings and constraint values</p>

      <div className="mt-2 flex gap-1 border-b border-slate-200" role="tablist" aria-label="Offerings view">
        {(['active', 'archived'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={view === tab}
            onClick={() => setView(tab)}
            className={[
              '-mb-px border-b-2 px-3 py-1.5 text-sm',
              view === tab
                ? 'border-indigo-600 font-medium text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {tab === 'active' ? 'Active' : 'Archived'}
          </button>
        ))}
      </div>

      {view === 'archived' ? (
        <ArchivedOfferingsView
          orgId={orgId}
          caseTypes={caseTypes}
          locations={locations}
          constraints={constraints}
        />
      ) : null}

      {/* Kept mounted (just hidden) so filters, sort and column choices survive a trip to the Archived tab. */}
      <div hidden={view === 'archived'}>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={[
            'rounded-lg border px-3 py-1.5 text-sm',
            compactMode ? 'border-slate-400 bg-slate-100' : 'border-slate-300',
          ].join(' ')}
          onClick={() => setCompactMode((v) => !v)}
        >
          Compact
        </button>
        <div className="relative" data-columns-menu>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            onClick={() => setColumnsMenuOpen((v) => !v)}
          >
            Columns
          </button>
          {columnsMenuOpen ? (
            <div className="absolute left-0 z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
              <p className="mb-2 text-xs font-semibold text-slate-500">Locations</p>
              {locations.map((loc) => (
                <label key={loc.id} className="flex items-center gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={isLocationVisible(loc.id)}
                    onChange={(e) => setLocationColumnVisible(loc.id, e.target.checked)}
                  />
                  {loc.name}
                </label>
              ))}
              <p className="mb-2 mt-2 text-xs font-semibold text-slate-500">Constraints</p>
              {constraints.map((c) => (
                <label key={c.id} className="flex items-center gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={isConstraintVisible(c.id)}
                    onChange={(e) => setConstraintColumnVisible(c.id, e.target.checked)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white"
          onClick={openAddOffering}
        >
          <span className="inline-flex items-center gap-1">
            <Plus className="h-4 w-4" /> Add
          </span>
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          onClick={() => setShowImport(true)}
        >
          Import +
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          onClick={handleExport}
        >
          <span className="inline-flex items-center gap-1">
            <Download className="h-4 w-4" /> Export
          </span>
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-red-600"
          onClick={() => {
            setClearAllInput('')
            setClearAllOpen(true)
          }}
        >
          Clear All Data
        </button>
      </div>

      <p className="mt-2 text-sm text-slate-500">
        Showing {filteredOfferings.length} of {offerings.length} offerings
      </p>

      {selectedRows.size > 0 ? (
        <div className="mb-3 mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-indigo-600 px-4 py-3 text-sm text-white">
          <span>{selectedRows.size} rows selected</span>
          <select
            className="rounded border border-white/40 bg-indigo-700 px-2 py-1 text-white"
            value={bulkAddLocationId}
            onChange={(e) => setBulkAddLocationId(e.target.value)}
          >
            <option value="">Add Location…</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
          <button type="button" className="underline" onClick={runBulkAddLocation}>
            Apply
          </button>
          <select
            className="rounded border border-white/40 bg-indigo-700 px-2 py-1 text-white"
            value={bulkRemoveLocationId}
            onChange={(e) => setBulkRemoveLocationId(e.target.value)}
          >
            <option value="">Remove Location…</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
          <button type="button" className="underline" onClick={runBulkRemoveLocation}>
            Apply
          </button>
          <select
            className="rounded border border-white/40 bg-indigo-700 px-2 py-1 text-white"
            value={bulkCategoryId}
            onChange={(e) => setBulkCategoryId(e.target.value)}
          >
            <option value="">Set Category…</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          <button type="button" className="underline" onClick={runBulkSetCategory}>
            Apply
          </button>
          <button
            type="button"
            className="underline"
            onClick={async () => {
              const result = await archiveOfferings(Array.from(selectedRows))
              if (result.error) {
                toast.error(result.error)
                return
              }
              await invalidateOfferingReaders(queryClient, orgId)
              setSelectedRows(new Set())
              toast.success('Selected offerings archived')
            }}
          >
            Delete Selected
          </button>
          <button type="button" className="underline" onClick={() => setSelectedRows(new Set())}>
            Deselect All
          </button>
        </div>
      ) : null}

      <div
        className="overflow-x-auto rounded-xl border border-slate-200 bg-white"
        data-ref-count={referencesLoadedCount}
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest('[data-columns-menu]')) setColumnsMenuOpen(false)
        }}
      >
        <table className="min-w-full">
          <thead className="border-b bg-slate-50">
            <tr>
              {headerColumns.map((header) => {
                const id = header.column.id
                const stickyClass =
                  id === 'providerName'
                    ? 'sticky left-0 z-10 bg-slate-50'
                    : id === 'actions'
                      ? 'sticky right-0 z-10 bg-slate-50'
                      : ''
                const clickableSort = id === 'providerName'
                return (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() ? `${header.getSize()}px` : undefined }}
                    className={`px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-500 ${stickyClass}`}
                  >
                    {clickableSort ? (
                      <button
                        type="button"
                        className="text-left"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                )
              })}
            </tr>
            <tr className="border-b border-slate-200 bg-slate-50">
              {headerColumns.map((header) => {
                const id = header.column.id
                const stickyClass =
                  id === 'providerName'
                    ? 'sticky left-0 z-10 bg-slate-50'
                    : id === 'actions'
                      ? 'sticky right-0 z-10 bg-slate-50'
                      : ''
                return (
                  <td key={`filter-${header.id}`} className={`px-4 py-2 ${stickyClass}`}>
                    {id === 'select' ? null : id === 'providerName' ? (
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search"
                        className="w-full max-w-[140px] rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    ) : id === 'caseType' ? (
                      <select
                        value={filterCaseTypeId}
                        onChange={(e) => setFilterCaseTypeId(e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-xs"
                      >
                        <option value="">All case types</option>
                        {caseTypes.map((ct) => (
                          <option key={ct.id} value={ct.id}>
                            {ct.name}
                          </option>
                        ))}
                      </select>
                    ) : id === 'category' ? (
                      <select
                        value={filterCategoryId}
                        onChange={(e) => setFilterCategoryId(e.target.value)}
                        className="w-full rounded border border-slate-300 px-1 py-1 text-xs"
                      >
                        <option value="">All categories</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    ) : id.startsWith('loc-') ? (
                      <select
                        value={filterLocation[id.replace('loc-', '')] ?? 'both'}
                        onChange={(e) =>
                          setFilterLocation((prev) => ({
                            ...prev,
                            [id.replace('loc-', '')]: e.target.value as TriState,
                          }))
                        }
                        className="w-full rounded border border-slate-300 px-1 py-1 text-xs"
                      >
                        <option value="both">Both</option>
                        <option value="yes">YES</option>
                        <option value="no">NO</option>
                      </select>
                    ) : id.startsWith('con-') ? (
                      (() => {
                        const c = constraints.find((x) => x.id === id.replace('con-', ''))
                        if (!c) return null
                        if (c.type === 'binary') {
                          return (
                            <select
                              value={filterBinary[c.id] ?? 'both'}
                              onChange={(e) =>
                                setFilterBinary((prev) => ({
                                  ...prev,
                                  [c.id]: e.target.value as TriState,
                                }))
                              }
                              className="w-full rounded border border-slate-300 px-1 py-1 text-xs"
                            >
                              <option value="both">Both</option>
                              <option value="yes">YES (1)</option>
                              <option value="no">NO (0)</option>
                            </select>
                          )
                        }
                        if (c.type === 'range') {
                          return (
                            <div className="flex gap-1">
                              <input
                                type="number"
                                placeholder="Min"
                                value={filterRangeMin[c.id] ?? ''}
                                onChange={(e) =>
                                  setFilterRangeMin((prev) => ({ ...prev, [c.id]: e.target.value }))
                                }
                                className="w-14 rounded border border-slate-300 px-1 py-0.5 text-xs"
                              />
                              <input
                                type="number"
                                placeholder="Max"
                                value={filterRangeMax[c.id] ?? ''}
                                onChange={(e) =>
                                  setFilterRangeMax((prev) => ({ ...prev, [c.id]: e.target.value }))
                                }
                                className="w-14 rounded border border-slate-300 px-1 py-0.5 text-xs"
                              />
                            </div>
                          )
                        }
                        return (
                          <input
                            type="text"
                            value={filterExact[c.id] ?? ''}
                            onChange={(e) =>
                              setFilterExact((prev) => ({ ...prev, [c.id]: e.target.value }))
                            }
                            placeholder="Filter"
                            className="w-full rounded border border-slate-300 px-1 py-1 text-xs"
                          />
                        )
                      })()
                    ) : id === 'actions' ? null : null}
                  </td>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="group border-b border-slate-100">
                {row.getVisibleCells().map((cell) => {
                  const cid = cell.column.id
                  const isSelected = selectedRows.has(row.original.id as string)
                  const stickyClass =
                    cid === 'providerName'
                      ? `sticky left-0 z-10 ${isSelected ? 'bg-indigo-50' : 'bg-white'}`
                      : cid === 'actions'
                        ? `sticky right-0 z-10 ${isSelected ? 'bg-indigo-50' : 'bg-white'}`
                        : 'group-hover:bg-slate-50'
                  return (
                    <td
                      key={cell.id}
                      className={['px-4', compactMode ? 'py-1.5' : 'py-3', stickyClass].join(' ')}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-end gap-3 text-sm">
        <button
          type="button"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-50"
        >
          Previous
        </button>
        <span>
          Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>
        <button
          type="button"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-50"
        >
          Next
        </button>
      </div>
      </div>

      <ConfirmDialog
        isOpen={archiveTargetId !== null}
        title="Archive Offering"
        message="Archive this offering? It will be hidden from the matcher and widget, and you can restore it from the Archived tab."
        confirmLabel="Archive"
        confirmVariant="danger"
        onConfirm={async () => {
          if (!archiveTargetId) return
          const result = await archiveOfferings([archiveTargetId])
          if (result.error) {
            toast.error(result.error)
          } else {
            await invalidateOfferingReaders(queryClient, orgId)
            toast.success('Offering archived')
          }
          setArchiveTargetId(null)
        }}
        onCancel={() => setArchiveTargetId(null)}
      />

      <ConfirmDialog
        isOpen={clearAllOpen}
        title="Clear All Data"
        message="Type DELETE to confirm clearing all offerings."
        confirmLabel="Clear All"
        confirmVariant="danger"
        confirmDisabled={clearAllInput !== 'DELETE'}
        onConfirm={async () => {
          const result = await archiveAllOfferings(orgId)
          if (result.error) {
            toast.error(result.error)
            return
          }
          await invalidateOfferingReaders(queryClient, orgId)
          toast.success('All offerings cleared')
          setClearAllOpen(false)
          setClearAllInput('')
          setSelectedRows(new Set())
        }}
        onCancel={() => {
          setClearAllOpen(false)
          setClearAllInput('')
        }}
      >
        <input
          type="text"
          value={clearAllInput}
          onChange={(e) => setClearAllInput(e.target.value)}
          placeholder="Type DELETE"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </ConfirmDialog>

      <ImportWizard
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onComplete={() => {
          void invalidateOfferingReaders(queryClient, orgId)
          setShowImport(false)
          toast.success('Import complete')
        }}
        orgId={orgId}
      />

      {addOfferingOpen ? (
        <OfferingModal
          title="Add Offering"
          providers={providers}
          caseTypes={caseTypes}
          locations={locations}
          constraints={constraints}
          initial={emptyOfferingDraft()}
          saving={addOfferingSaving}
          error={addOfferingError}
          onCancel={() => setAddOfferingOpen(false)}
          onSave={(draft) => void handleAddOffering(draft)}
        />
      ) : null}
    </div>
  )
}
