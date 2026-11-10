import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapPin, Sparkles, X } from 'lucide-react'
import { useToast } from '../../components/ui/toastStore'
import { getCaseTypes, updateCaseTypeMapPosition, updateCaseTypeMapTag } from '../../lib/api/caseTypes'
import {
  BODY_MAP_SPOTS,
  bodyMapSpot,
  framePoint,
  placementOf,
  resolveSpot,
  suggestMapTags,
  type BodyMapSpot,
  type MapTagSuggestion,
} from '../../shared/bodyMap'
import { OUTLINE_PATH, OUTLINE_SIZE } from '../../shared/bodyOutline'
import { useAuthStore } from '../../stores/authStore'
import type { CaseType } from '../../types/database'
import { PlaceOnMapDialog } from './PlaceOnMapDialog'
import { useInvalidateCaseTypes } from './useInvalidateCaseTypes'

/**
 * The case types page's body map section: which case type each spot on the
 * widget's body map selects, and where case types without a built-in spot sit
 * (placed by the admin). A case type with no spot still appears in the widget,
 * as a plain button under the map.
 */

/** A spot's centre in outline coordinates -- the same sum the widget does. */
function spotPoint(spot: BodyMapSpot) {
  return framePoint(spot.view, spot.x, spot.y)
}

/** Read-only marker in a case type's list row; the section below changes it. */
export function MapSpotBadge({ caseType }: { caseType: CaseType }) {
  const spot = resolveSpot(caseType)
  if (!spot) return null
  return (
    <span
      title={spot.custom ? 'On the body map at a spot you placed' : `On the body map at ${spot.label}`}
      className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
    >
      <MapPin className="h-3 w-3" />
      {spot.custom ? 'Body map' : spot.label}
    </span>
  )
}

/** The figure with every spot, filled where a case type is linked. */
function BodyMapPreview({
  holders,
  customs,
  active,
  onPick,
}: {
  holders: Map<string, CaseType>
  customs: CaseType[]
  active: string | null
  onPick: (tag: string) => void
}) {
  return (
    <svg
      viewBox={`0 0 ${OUTLINE_SIZE} ${OUTLINE_SIZE}`}
      role="img"
      aria-label={`Body map preview, ${holders.size} of ${BODY_MAP_SPOTS.length} spots linked${
        customs.length > 0 ? `, plus ${customs.length} you placed` : ''
      }`}
      className="w-full"
    >
      <path d={OUTLINE_PATH} fillRule="evenodd" className="fill-slate-300" />
      {BODY_MAP_SPOTS.map((spot) => {
        const { x, y } = spotPoint(spot)
        const holder = holders.get(spot.tag)
        return (
          <g key={spot.tag} className="cursor-pointer" onClick={() => onPick(spot.tag)}>
            <title>{holder ? `${spot.label}: ${holder.name}` : `${spot.label}: not linked`}</title>
            {active === spot.tag ? <circle cx={x} cy={y} r={38} className="fill-indigo-500/25" /> : null}
            <circle
              cx={x}
              cy={y}
              r={20}
              strokeWidth={6}
              className={holder ? 'fill-indigo-600 stroke-white' : 'fill-white stroke-slate-400'}
            />
          </g>
        )
      })}
      {customs.map((ct) => {
        const spot = resolveSpot(ct)
        if (!spot) return null
        const { x, y } = spotPoint(spot)
        return (
          <g key={ct.id} data-custom-spot={ct.id}>
            <title>{`${ct.name}: placed by you`}</title>
            <circle cx={x} cy={y} r={20} strokeWidth={6} className="fill-emerald-600 stroke-white" />
          </g>
        )
      })}
    </svg>
  )
}

/** A case type the admin placed by hand: where it is, with a way to move or remove it. */
function CustomSpotRow({ caseType, onMove }: { caseType: CaseType; onMove: () => void }) {
  const { toast } = useToast()
  const invalidate = useInvalidateCaseTypes()
  const [saving, setSaving] = useState(false)

  async function remove() {
    setSaving(true)
    const { error } = await updateCaseTypeMapPosition(caseType.id, null)
    setSaving(false)
    await invalidate()
    if (error) {
      toast.error(error)
      return
    }
    toast.success(`${caseType.name} removed from the body map`)
  }

  return (
    <li className="flex items-center gap-2 rounded-lg px-2 py-1.5" data-custom-row={caseType.id}>
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-600" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{caseType.name}</span>
      <button
        type="button"
        onClick={onMove}
        disabled={saving}
        aria-label={`Move ${caseType.name} on the body map`}
        className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Move
      </button>
      <button
        type="button"
        aria-label={`Remove ${caseType.name} from the body map`}
        title="Remove from the body map"
        disabled={saving}
        onClick={() => void remove()}
        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  )
}

function SpotRow({
  spot,
  holder,
  all,
  active,
  onFocus,
}: {
  spot: BodyMapSpot
  holder: CaseType | undefined
  all: CaseType[]
  active: boolean
  onFocus: () => void
}) {
  const { toast } = useToast()
  const invalidate = useInvalidateCaseTypes()
  const [saving, setSaving] = useState(false)

  async function link(caseTypeId: string) {
    setSaving(true)
    // One case type per spot: the current holder is unlinked first, or the
    // unique index rejects the second link.
    const chosen = all.find((ct) => ct.id === caseTypeId)
    let { error } = holder && holder.id !== caseTypeId ? await updateCaseTypeMapTag(holder.id, null) : { error: null }
    if (!error && chosen) {
      error = (await updateCaseTypeMapTag(chosen.id, spot.tag)).error
    }
    setSaving(false)
    await invalidate()
    if (error) {
      toast.error(error)
      return
    }
    toast.success(chosen ? `${chosen.name} linked to ${spot.label}` : `${spot.label} removed from the body map`)
  }

  return (
    <li
      data-spot={spot.tag}
      className={[
        'flex items-center gap-2 rounded-lg px-2 py-1.5',
        active ? 'bg-indigo-50 ring-1 ring-indigo-200' : '',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={[
          'h-2.5 w-2.5 shrink-0 rounded-full',
          holder ? 'bg-indigo-600' : 'border border-slate-400 bg-white',
        ].join(' ')}
      />
      <span className="w-24 shrink-0 text-sm font-medium text-slate-800">{spot.label}</span>
      <select
        aria-label={`Case type for ${spot.label}`}
        value={holder?.id ?? ''}
        disabled={saving}
        onFocus={onFocus}
        onChange={(e) => void link(e.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
      >
        <option value="">Not on the body map</option>
        {all.map((ct) => {
          const elsewhere = ct.map_tag && ct.map_tag !== spot.tag ? bodyMapSpot(ct.map_tag)?.label : undefined
          return (
            <option key={ct.id} value={ct.id}>
              {elsewhere ? `${ct.name} (moves from ${elsewhere})` : ct.name}
            </option>
          )
        })}
      </select>
      <button
        type="button"
        aria-label={`Remove ${spot.label} from the body map`}
        title="Remove from the body map"
        disabled={!holder || saving}
        onClick={() => void link('')}
        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:invisible"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  )
}

export function BodyMapSection() {
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const [active, setActive] = useState<string | null>(null)
  const [placing, setPlacing] = useState<string | null>(null)
  // The plain list, shared with the other pages that read CaseType[]; the
  // list above invalidates it after every add, rename, reorder or archive.
  const { data: caseTypes = [] } = useQuery({
    queryKey: ['case-types', orgId],
    queryFn: () => getCaseTypes(orgId),
    enabled: Boolean(orgId),
  })

  if (caseTypes.length === 0) return null

  const holders = new Map(
    caseTypes.filter((ct) => bodyMapSpot(ct.map_tag)).map((ct) => [ct.map_tag as string, ct]),
  )
  // Case types the admin placed themselves, and the ones with no spot at all.
  const customs = caseTypes.filter((ct) => !bodyMapSpot(ct.map_tag) && placementOf(ct))
  const offMap = caseTypes.filter((ct) => !bodyMapSpot(ct.map_tag) && !placementOf(ct))
  const placingCaseType = caseTypes.find((ct) => ct.id === placing)

  function pick(tag: string) {
    setActive(tag)
    document.querySelector<HTMLSelectElement>(`[data-spot="${tag}"] select`)?.focus()
  }

  return (
    <section aria-labelledby="body-map-heading" className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="body-map-heading" className="text-base font-semibold text-slate-900">
            Body map
          </h2>
          <p className="mt-1 max-w-xl text-sm text-slate-500">
            Choose which case type each spot on the widget&apos;s body map opens. A case type with no spot of its own
            can be placed anywhere on the figure. Removing one only takes it off the figure; the case type still shows
            as a button under it. To hide a case type everywhere, archive it above.
          </p>
        </div>
        <SuggestMapTagsButton all={caseTypes} />
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,240px)_1fr]">
        <div className="mx-auto w-full max-w-[240px]">
          <BodyMapPreview holders={holders} customs={customs} active={active} onPick={pick} />
          <p className="mt-2 text-center text-xs text-slate-500">
            {holders.size} of {BODY_MAP_SPOTS.length} spots linked
            {customs.length > 0 ? `, plus ${customs.length} you placed` : ''}
          </p>
        </div>

        <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2">
          {(['front', 'back'] as const).map((view) => (
            <div key={view}>
              <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {view === 'front' ? 'Front' : 'Back'}
              </h3>
              <ul className="space-y-0.5">
                {BODY_MAP_SPOTS.filter((spot) => spot.view === view).map((spot) => (
                  <SpotRow
                    key={spot.tag}
                    spot={spot}
                    holder={holders.get(spot.tag)}
                    all={caseTypes}
                    active={active === spot.tag}
                    onFocus={() => setActive(spot.tag)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {customs.length > 0 ? (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Placed by you ({customs.length})
          </h3>
          <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">
            {customs.map((ct) => (
              <CustomSpotRow key={ct.id} caseType={ct} onMove={() => setPlacing(ct.id)} />
            ))}
          </ul>
        </div>
      ) : null}

      {offMap.length > 0 ? (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Not on the body map ({offMap.length})
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Shown in the widget as buttons under the figure. Place one on the figure to make it tappable there.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {offMap.map((ct) => (
              <li key={ct.id} className="flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-xs text-slate-700">
                {ct.name}
                <button
                  type="button"
                  onClick={() => setPlacing(ct.id)}
                  aria-label={`Place ${ct.name} on the body map`}
                  className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                >
                  Place on map
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {placingCaseType ? (
        <PlaceOnMapDialog
          key={placingCaseType.id}
          caseType={placingCaseType}
          all={caseTypes}
          onClose={() => setPlacing(null)}
        />
      ) : null}
    </section>
  )
}

/**
 * Proposes spots from case type names and applies only the ones the admin
 * keeps ticked. Nothing is written until they press Apply.
 */
export function SuggestMapTagsButton({ all }: { all: CaseType[] }) {
  const { toast } = useToast()
  const invalidate = useInvalidateCaseTypes()
  const [suggestions, setSuggestions] = useState<MapTagSuggestion[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)

  function open() {
    const found = suggestMapTags(all)
    if (found.length === 0) {
      toast.success('No new matches. Link the remaining case types by hand.')
      return
    }
    setSuggestions(found)
    setSelected(new Set(found.map((s) => s.caseTypeId)))
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function apply() {
    if (!suggestions) return
    const chosen = suggestions.filter((s) => selected.has(s.caseTypeId))
    setApplying(true)
    const results = await Promise.all(chosen.map((s) => updateCaseTypeMapTag(s.caseTypeId, s.tag)))
    setApplying(false)
    await invalidate()
    const failed = results.find((r) => r.error)
    if (failed) {
      toast.error(failed.error as string)
      return
    }
    setSuggestions(null)
    toast.success(`Linked ${chosen.length} case ${chosen.length === 1 ? 'type' : 'types'} to the body map`)
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <Sparkles className="h-4 w-4" />
        Suggest body map matches
      </button>

      {suggestions ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onMouseDown={() => setSuggestions(null)} />
          <div
            role="dialog"
            aria-label="Suggested body map matches"
            className="relative mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Suggested body map matches</h2>
            <p className="mb-4 text-sm text-slate-500">
              Matched from the case type names. Untick anything that is wrong.
            </p>
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {suggestions.map((s) => (
                <li key={s.caseTypeId}>
                  <label className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(s.caseTypeId)}
                      onChange={() => toggle(s.caseTypeId)}
                    />
                    <span className="flex-1 font-medium text-slate-900">{s.caseTypeName}</span>
                    <span className="text-slate-500">→ {bodyMapSpot(s.tag)?.label}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setSuggestions(null)}
                disabled={applying}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void apply()}
                disabled={applying || selected.size === 0}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {applying ? 'Applying…' : `Apply ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
