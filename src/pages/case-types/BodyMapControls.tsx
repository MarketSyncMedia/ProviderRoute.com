import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useToast } from '../../components/ui/toastStore'
import { updateCaseTypeMapTag } from '../../lib/api/caseTypes'
import { BODY_MAP_SPOTS, bodyMapSpot, suggestMapTags, type MapTagSuggestion } from '../../shared/bodyMap'
import { useAuthStore } from '../../stores/authStore'
import type { CaseType } from '../../types/database'

/**
 * Linking case types to spots on the widget's body map. A case type with no
 * spot still appears in the widget, as a plain button under the map.
 */

/** Refresh the case types page and every other reader of the plain list. */
function useInvalidateCaseTypes() {
  const queryClient = useQueryClient()
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['case-types-with-counts', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['case-types', orgId] }),
    ])
}

export function MapSpotSelect({ caseType, all }: { caseType: CaseType; all: CaseType[] }) {
  const { toast } = useToast()
  const invalidate = useInvalidateCaseTypes()
  const [saving, setSaving] = useState(false)

  // A spot selects one case type, so spots held by another case type are
  // shown but disabled -- the admin unlinks that one first.
  const holder = new Map(
    all.filter((ct) => ct.id !== caseType.id && ct.map_tag).map((ct) => [ct.map_tag as string, ct.name]),
  )

  async function onChange(value: string) {
    setSaving(true)
    const { error } = await updateCaseTypeMapTag(caseType.id, value || null)
    setSaving(false)
    if (error) {
      toast.error(error)
      return
    }
    await invalidate()
    toast.success(value ? `${caseType.name} linked to ${bodyMapSpot(value)?.label}` : `${caseType.name} unlinked`)
  }

  return (
    <select
      aria-label={`Body map spot for ${caseType.name}`}
      value={caseType.map_tag ?? ''}
      disabled={saving}
      onChange={(e) => void onChange(e.target.value)}
      className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
    >
      <option value="">No body map spot</option>
      {(['front', 'back'] as const).map((view) => (
        <optgroup key={view} label={view === 'front' ? 'Front' : 'Back'}>
          {BODY_MAP_SPOTS.filter((spot) => spot.view === view).map((spot) => (
            <option key={spot.tag} value={spot.tag} disabled={holder.has(spot.tag)}>
              {holder.has(spot.tag) ? `${spot.label} (used by ${holder.get(spot.tag)})` : spot.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
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
