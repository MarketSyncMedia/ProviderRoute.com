import { useState } from 'react'
import type { CaseType, Constraint, Location, Provider } from '../../types/database'
import type { OfferingDraft } from './offeringDraft'

interface OfferingModalProps {
  title: string
  /** When given, the admin picks the provider; otherwise it is fixed by `initial.providerId`. */
  providers?: Provider[]
  caseTypes: CaseType[]
  locations: Location[]
  constraints: Constraint[]
  initial: OfferingDraft
  saving: boolean
  /** Server-side error from the last save attempt. */
  error: string
  onCancel: () => void
  onSave: (draft: OfferingDraft) => void
}

/**
 * Add/edit form for one offering, shared by the provider profile and the data
 * table. Mount it fresh for each open so `initial` seeds the draft.
 */
export default function OfferingModal({
  title,
  providers,
  caseTypes,
  locations,
  constraints,
  initial,
  saving,
  error,
  onCancel,
  onSave,
}: OfferingModalProps) {
  const [draft, setDraft] = useState<OfferingDraft>(initial)
  const [validationError, setValidationError] = useState('')

  const setConstraintValue = (key: string, value: unknown) =>
    setDraft((prev) => ({ ...prev, constraints: { ...prev.constraints, [key]: value } }))

  function handleSave() {
    if (providers && !draft.providerId) {
      setValidationError('Provider is required')
      return
    }
    if (!draft.caseTypeId) {
      setValidationError('Case type is required')
      return
    }
    setValidationError('')
    onSave(draft)
  }

  const shownError = validationError || error

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="absolute inset-0" onMouseDown={onCancel} />
      <div
        role="dialog"
        aria-label={title}
        className="relative mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-900">{title}</h2>

        {shownError ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{shownError}</div>
        ) : null}

        {providers ? (
          <div className="mb-4">
            <label htmlFor="offering-provider" className="mb-1 block text-sm font-medium text-slate-700">
              Provider
            </label>
            <select
              id="offering-provider"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={draft.providerId}
              onChange={(e) => setDraft((prev) => ({ ...prev, providerId: e.target.value }))}
            >
              <option value="">Select provider...</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <label htmlFor="offering-case-type" className="mb-1 block text-sm font-medium text-slate-700">
            Case Type
          </label>
          <select
            id="offering-case-type"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={draft.caseTypeId}
            onChange={(e) => setDraft((prev) => ({ ...prev, caseTypeId: e.target.value }))}
          >
            <option value="">Select case type...</option>
            {caseTypes.map((caseType) => (
              <option key={caseType.id} value={caseType.id}>
                {caseType.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4">
          <label className="mb-2 block text-sm font-medium text-slate-700">Locations</label>
          <div className="space-y-2">
            {locations.map((location) => (
              <label key={location.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.locationIds.includes(location.id)}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setDraft((prev) => ({
                      ...prev,
                      locationIds: checked
                        ? [...prev.locationIds, location.id]
                        : prev.locationIds.filter((existingId) => existingId !== location.id),
                    }))
                  }}
                />
                {location.name}
              </label>
            ))}
          </div>
        </div>

        {constraints.length > 0 ? (
          <div className="mt-4">
            <label className="mb-2 block text-sm font-medium text-slate-700">Constraints</label>
            <div className="space-y-3">
              {constraints.map((constraint) => (
                <div key={constraint.id}>
                  <p className="mb-1 text-sm text-slate-700">{constraint.name}</p>
                  {constraint.type === 'binary' ? (
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={draft.constraints[constraint.mapped_key] === 1}
                        onChange={(e) => setConstraintValue(constraint.mapped_key, e.target.checked ? 1 : 0)}
                      />
                      Enabled
                    </label>
                  ) : null}
                  {constraint.type === 'range' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        placeholder="Min"
                        value={String(draft.constraints[constraint.mapped_key] ?? '')}
                        onChange={(e) => setConstraintValue(constraint.mapped_key, e.target.value)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                      <input
                        type="number"
                        placeholder="Max"
                        value={String(draft.constraints[constraint.secondary_mapped_key ?? ''] ?? '')}
                        onChange={(e) => setConstraintValue(constraint.secondary_mapped_key ?? '', e.target.value)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                  ) : null}
                  {constraint.type === 'exact' ? (
                    <input
                      type="text"
                      value={String(draft.constraints[constraint.mapped_key] ?? '')}
                      onChange={(e) => setConstraintValue(constraint.mapped_key, e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
