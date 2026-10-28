import { useState } from 'react'
import { X } from 'lucide-react'
import type { Constraint } from '../../types/database'

export type ConstraintFormSavePayload = Omit<Constraint, 'id' | 'created_at' | 'updated_at'>

import { asConstraintType, asMapsTo, type ConstraintType } from '../../lib/schemaEnums'

interface FormState {
  name: string
  mapped_key: string
  secondary_mapped_key: string
  min_allowed_value: string
  max_allowed_value: string
  yes_label: string
  no_label: string
  yes_maps_to: '0' | '1' | 'both'
  no_maps_to: '0' | '1' | 'both'
}

function defaultForm(): FormState {
  return {
    name: '',
    mapped_key: '',
    secondary_mapped_key: '',
    min_allowed_value: '',
    max_allowed_value: '',
    yes_label: 'Yes',
    no_label: 'No',
    yes_maps_to: 'both',
    no_maps_to: '0',
  }
}

function formFromConstraint(c: Constraint): FormState {
  return {
    name: c.name,
    mapped_key: c.mapped_key,
    secondary_mapped_key: c.secondary_mapped_key ?? '',
    min_allowed_value:
      c.min_allowed_value === null || c.min_allowed_value === undefined ? '' : String(c.min_allowed_value),
    max_allowed_value:
      c.max_allowed_value === null || c.max_allowed_value === undefined ? '' : String(c.max_allowed_value),
    yes_label: c.yes_label || 'Yes',
    no_label: c.no_label || 'No',
    yes_maps_to: asMapsTo(c.yes_maps_to, 'both'),
    no_maps_to: asMapsTo(c.no_maps_to, '0'),
  }
}

function parseOptionalNumber(s: string): number | null {
  const t = s.trim()
  if (t === '') {
    return null
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function buildPayload(
  form: FormState,
  type: ConstraintType,
  initialData: Constraint | undefined,
  isEdit: boolean
): ConstraintFormSavePayload {
  const sort_order = isEdit && initialData ? initialData.sort_order : 0
  const org_id = initialData?.org_id ?? ''

  if (type === 'binary') {
    return {
      org_id,
      name: form.name.trim(),
      type: 'binary',
      mapped_key: form.mapped_key.trim(),
      secondary_mapped_key: null,
      min_allowed_value: null,
      max_allowed_value: null,
      yes_label: form.yes_label.trim() || 'Yes',
      no_label: form.no_label.trim() || 'No',
      yes_maps_to: form.yes_maps_to,
      no_maps_to: form.no_maps_to,
      sort_order,
      is_archived: false,
    }
  }

  if (type === 'range') {
    return {
      org_id,
      name: form.name.trim(),
      type: 'range',
      mapped_key: form.mapped_key.trim(),
      secondary_mapped_key: form.secondary_mapped_key.trim(),
      min_allowed_value: parseOptionalNumber(form.min_allowed_value),
      max_allowed_value: parseOptionalNumber(form.max_allowed_value),
      yes_label: '',
      no_label: '',
      yes_maps_to: 'both',
      no_maps_to: 'both',
      sort_order,
      is_archived: false,
    }
  }

  return {
    org_id,
    name: form.name.trim(),
    type: 'exact',
    mapped_key: form.mapped_key.trim(),
    secondary_mapped_key: null,
    min_allowed_value: null,
    max_allowed_value: null,
    yes_label: '',
    no_label: '',
    yes_maps_to: 'both',
    no_maps_to: 'both',
    sort_order,
    is_archived: false,
  }
}

interface ConstraintModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: ConstraintFormSavePayload) => Promise<void>
  initialData?: Constraint
  title: string
  questionCount?: number
  orgId: string
}

export default function ConstraintModal({
  isOpen,
  onClose,
  onSave,
  initialData,
  title,
  questionCount = 0,
  orgId,
}: ConstraintModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [type, setType] = useState<ConstraintType | null>(null)
  const [formData, setFormData] = useState<FormState>(defaultForm)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const isEdit = Boolean(initialData)

  // Reset the form when the modal opens (or switches which constraint it's
  // editing) during render, rather than from an effect — an effect-based
  // reset paints one stale frame of the previous constraint's data first.
  // Track both the open transition and the id so this fires exactly when
  // the old effect's [isOpen, initialData?.id] dependency array did.
  const currentId = initialData?.id
  const [synced, setSynced] = useState<{ isOpen: boolean; id: string | undefined }>({
    isOpen: false,
    id: undefined,
  })
  if (isOpen && (!synced.isOpen || synced.id !== currentId)) {
    setSynced({ isOpen: true, id: currentId })
    setStep(1)
    setError('')
    setIsSaving(false)
    if (initialData) {
      setType(asConstraintType(initialData.type))
      setFormData(formFromConstraint(initialData))
    } else {
      setType(null)
      setFormData(defaultForm())
    }
  } else if (!isOpen && synced.isOpen) {
    setSynced({ isOpen: false, id: currentId })
  }

  if (!isOpen) {
    return null
  }

  const showWarning = isEdit && questionCount > 0

  function validateStep1(): boolean {
    if (!formData.name.trim() || !type) {
      setError('Name and type are required')
      return false
    }
    setError('')
    return true
  }

  function validateStep2(): boolean {
    if (!type) {
      return false
    }
    if (type === 'binary') {
      if (!formData.mapped_key.trim()) {
        setError('Mapped key is required')
        return false
      }
    } else if (type === 'range') {
      if (!formData.mapped_key.trim() || !formData.secondary_mapped_key.trim()) {
        setError('Min key and max key are required')
        return false
      }
    } else if (type === 'exact') {
      if (!formData.mapped_key.trim()) {
        setError('Mapped key is required')
        return false
      }
    }
    setError('')
    return true
  }

  async function handleSave() {
    if (!type) {
      return
    }
    setError('')
    setIsSaving(true)
    try {
      const payload = buildPayload(formData, type, initialData, isEdit)
      const withOrg = { ...payload, org_id: orgId || payload.org_id }
      await onSave(withOrg)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  const pill = (n: 1 | 2 | 3, label: string) => {
    const active = step === n
    return (
      <span
        className={
          active
            ? 'rounded-full bg-indigo-600 px-3 py-1 text-xs text-white'
            : 'rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500'
        }
      >
        {n} {label}
      </span>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onMouseDown={onClose} />
      <div
        className="relative mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {pill(1, 'Basic Info')}
            {pill(2, 'Configuration')}
            {pill(3, 'Preview')}
          </div>
        </div>

        <div className="px-6 py-4">
          {showWarning ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This constraint is used by {questionCount} questions. Changes will affect widget behavior.
            </div>
          ) : null}

          {error && step !== 3 ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : null}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Type</p>
                <div className="space-y-2">
                  {(
                    [
                      {
                        value: 'binary' as const,
                        border: 'border-green-500',
                        title: 'Binary (Yes/No)',
                        desc: 'Configure custom yes/no filtering',
                      },
                      {
                        value: 'range' as const,
                        border: 'border-blue-500',
                        title: 'Range (Numeric)',
                        desc: 'Filter by min/max numeric range',
                      },
                      {
                        value: 'exact' as const,
                        border: 'border-purple-500',
                        title: 'Exact Match',
                        desc: 'Filter by exact string value',
                      },
                    ] as const
                  ).map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 transition-colors ${
                        type === opt.value ? `${opt.border} bg-white` : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="constraint-type"
                        className="mt-1"
                        checked={type === opt.value}
                        onChange={() => setType(opt.value)}
                      />
                      <div>
                        <div className="text-sm font-medium text-slate-900">{opt.title}</div>
                        <div className="text-xs text-slate-500">{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!formData.name.trim() || !type}
                  onClick={() => {
                    if (validateStep1()) {
                      setStep(2)
                    }
                  }}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 2 && type === 'binary' && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Mapped Key</label>
                <input
                  type="text"
                  value={formData.mapped_key}
                  onChange={(e) => setFormData((f) => ({ ...f, mapped_key: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="sports_only"
                />
                <p className="mt-1 text-xs text-slate-500">JSONB field name, e.g. sports_only</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Option 1 Label</label>
                <input
                  type="text"
                  value={formData.yes_label}
                  onChange={(e) => setFormData((f) => ({ ...f, yes_label: e.target.value }))}
                  placeholder="e.g. Yes, it was a sports injury"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-slate-500">What the patient sees on the first answer button</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Option 2 Label</label>
                <input
                  type="text"
                  value={formData.no_label}
                  onChange={(e) => setFormData((f) => ({ ...f, no_label: e.target.value }))}
                  placeholder="e.g. No, it wasn't a sports injury"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-slate-500">What the patient sees on the second answer button</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  When patient clicks "{formData.yes_label.trim() || 'Yes'}", show:
                </label>
                <select
                  value={formData.yes_maps_to}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, yes_maps_to: e.target.value as FormState['yes_maps_to'] }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="both">All providers (ignore this filter)</option>
                  <option value="1">Only providers where {formData.mapped_key.trim() || 'this field'} = 1 (flag is ON)</option>
                  <option value="0">Only providers where {formData.mapped_key.trim() || 'this field'} = 0 (flag is OFF)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  When patient clicks "{formData.no_label.trim() || 'No'}", show:
                </label>
                <select
                  value={formData.no_maps_to}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, no_maps_to: e.target.value as FormState['no_maps_to'] }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="both">All providers (ignore this filter)</option>
                  <option value="1">Only providers where {formData.mapped_key.trim() || 'this field'} = 1 (flag is ON)</option>
                  <option value="0">Only providers where {formData.mapped_key.trim() || 'this field'} = 0 (flag is OFF)</option>
                </select>
              </div>
              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setError('')
                    setStep(1)
                  }}
                  className="text-sm text-slate-600 hover:text-slate-900"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (validateStep2()) {
                      setStep(3)
                    }
                  }}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 2 && type === 'range' && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Min Key</label>
                <input
                  type="text"
                  value={formData.mapped_key}
                  onChange={(e) => setFormData((f) => ({ ...f, mapped_key: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  placeholder="age_min"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Max Key</label>
                <input
                  type="text"
                  value={formData.secondary_mapped_key}
                  onChange={(e) => setFormData((f) => ({ ...f, secondary_mapped_key: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  placeholder="age_max"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Min Allowed Value (optional)</label>
                <input
                  type="number"
                  value={formData.min_allowed_value}
                  onChange={(e) => setFormData((f) => ({ ...f, min_allowed_value: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Max Allowed Value (optional)</label>
                <input
                  type="number"
                  value={formData.max_allowed_value}
                  onChange={(e) => setFormData((f) => ({ ...f, max_allowed_value: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setError('')
                    setStep(1)
                  }}
                  className="text-sm text-slate-600 hover:text-slate-900"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (validateStep2()) {
                      setStep(3)
                    }
                  }}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 2 && type === 'exact' && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Mapped Key</label>
                <input
                  type="text"
                  value={formData.mapped_key}
                  onChange={(e) => setFormData((f) => ({ ...f, mapped_key: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  placeholder="insurance_type"
                />
              </div>
              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setError('')
                    setStep(1)
                  }}
                  className="text-sm text-slate-600 hover:text-slate-900"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (validateStep2()) {
                      setStep(3)
                    }
                  }}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 3 && type && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">This is how your question input will appear in the widget:</p>

              {type === 'binary' && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-800"
                  >
                    {formData.yes_label.trim() || 'Yes'}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-800"
                  >
                    {formData.no_label.trim() || 'No'}
                  </button>
                </div>
              )}

              {type === 'range' && (
                <input
                  type="number"
                  readOnly
                  placeholder="Enter a number"
                  className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              )}

              {type === 'exact' && (
                <input
                  type="text"
                  readOnly
                  placeholder="Enter value"
                  className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              )}

              {type === 'binary' && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Logic Summary</p>
                  <p className="text-sm text-slate-700">
                    <span className="font-medium text-indigo-700">"{formData.yes_label.trim() || 'Yes'}"</span>
                    {' → '}
                    {formData.yes_maps_to === 'both'
                      ? 'Show all providers (filter ignored)'
                      : formData.yes_maps_to === '1'
                      ? `Only show providers where ${formData.mapped_key.trim() || 'this field'} = 1`
                      : `Only show providers where ${formData.mapped_key.trim() || 'this field'} = 0`}
                  </p>
                  <p className="text-sm text-slate-700">
                    <span className="font-medium text-indigo-700">"{formData.no_label.trim() || 'No'}"</span>
                    {' → '}
                    {formData.no_maps_to === 'both'
                      ? 'Show all providers (filter ignored)'
                      : formData.no_maps_to === '1'
                      ? `Only show providers where ${formData.mapped_key.trim() || 'this field'} = 1`
                      : `Only show providers where ${formData.mapped_key.trim() || 'this field'} = 0`}
                  </p>
                </div>
              )}

              {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              ) : null}

              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setError('')
                    setStep(2)
                  }}
                  className="text-sm text-slate-600 hover:text-slate-900"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleSave}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
