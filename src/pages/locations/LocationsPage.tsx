import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, MapPin, Pencil, Plus } from 'lucide-react'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import EmptyState from '../../components/ui/EmptyState'
import { useToast } from '../../components/ui/toastStore'
import {
  archiveLocation,
  createLocation,
  getLocationOfferingCounts,
  getLocations,
  updateLocation,
} from '../../lib/api/locations'
import { useAuthStore } from '../../stores/authStore'
import type { Location } from '../../types/database'

interface LocationForm {
  name: string
  address: string
  phone: string
  directions_url: string
}

const emptyForm: LocationForm = {
  name: '',
  address: '',
  phone: '',
  directions_url: '',
}

export default function LocationsPage() {
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [modal, setModal] = useState<{ type: 'add' | 'edit' | 'archive' | null; payload?: Location }>({
    type: null,
  })
  const [form, setForm] = useState<LocationForm>(emptyForm)
  const [formError, setFormError] = useState('')
  const [saveLoading, setSaveLoading] = useState(false)
  const [archiveLoading, setArchiveLoading] = useState(false)

  const { data: rows = [], isLoading } = useQuery({
    // Augmented rows -- must not share the plain ['locations', orgId] key that
    // LogicTester, DataTablePage, ProviderProfilePage, QuestionsPage and
    // WidgetBuilderPage read Location[] from.
    queryKey: ['locations-with-counts', orgId],
    queryFn: async () => {
      const locs = (await getLocations(orgId)).filter(Boolean)
      const counts = await getLocationOfferingCounts(locs.map((l) => l.id))
      return locs.map((loc) => ({
        location: loc,
        offeringCount: counts[loc.id] ?? 0,
      }))
    },
    enabled: Boolean(orgId),
  })

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
    setForm(emptyForm)
    setFormError('')
    setModal({ type: 'add' })
  }

  function openEdit(target: Location) {
    setForm({
      name: target.name,
      address: target.address ?? '',
      phone: target.phone ?? '',
      directions_url: target.directions_url ?? '',
    })
    setFormError('')
    setModal({ type: 'edit', payload: target })
  }

  const archivePayload = modal.type === 'archive' ? modal.payload : undefined
  const archiveOfferingCount = archivePayload
    ? rows.find((r) => r.location.id === archivePayload.id)?.offeringCount ?? 0
    : 0

  async function handleSaveAddOrEdit() {
    if (!orgId) {
      setFormError('Organization not found')
      return
    }
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }

    setFormError('')
    setSaveLoading(true)

    if (modal.type === 'edit' && !modal.payload) {
      setSaveLoading(false)
      return
    }

    if (modal.type === 'add') {
      const { error } = await createLocation({
        org_id: orgId,
        name: form.name.trim(),
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        directions_url: form.directions_url.trim() || undefined,
      })
      setSaveLoading(false)
      if (error) {
        setFormError(error)
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['locations-with-counts', orgId] })
      await queryClient.invalidateQueries({ queryKey: ['locations', orgId] })
      setModal({ type: null })
      toast.success('Location added')
      return
    }

    if (modal.type === 'edit' && modal.payload) {
      const { error } = await updateLocation(modal.payload.id, {
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        directions_url: form.directions_url.trim() || null,
      })
      setSaveLoading(false)
      if (error) {
        setFormError(error)
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['locations-with-counts', orgId] })
      await queryClient.invalidateQueries({ queryKey: ['locations', orgId] })
      setModal({ type: null })
      toast.success('Location updated')
    }
  }

  async function handleConfirmArchive() {
    if (modal.type !== 'archive' || !modal.payload) {
      return
    }
    const { id } = modal.payload
    setArchiveLoading(true)
    const { error } = await archiveLocation(id, orgId)
    setArchiveLoading(false)
    if (error) {
      toast.error(error)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['locations-with-counts', orgId] })
    await queryClient.invalidateQueries({ queryKey: ['locations', orgId] })
    await queryClient.invalidateQueries({ queryKey: ['data-table-offerings', orgId] })
    await queryClient.invalidateQueries({ queryKey: ['provider-locations'] })
    setModal({ type: null })
    toast.success('Location archived')
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Manage your office locations</h1>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          onClick={openAdd}
        >
          <Plus className="h-4 w-4" />
          Add Location
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading locations…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<MapPin className="h-10 w-10" />}
          title="No locations yet"
          description="Add your first office location"
          action={
            <button
              type="button"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              onClick={openAdd}
            >
              + Add Location
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Offerings Using</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.filter((row) => row.location != null).map(({ location, offeringCount }) => (
                <tr key={location.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-medium text-slate-900">{location.name}</td>
                  {/* truncate needs a width on a block; on the cell itself it never caps the column */}
                  <td className="px-4 py-3 text-sm text-slate-500" title={location.address ?? ''}>
                    <div className="max-w-xs truncate">{location.address ?? '—'}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500">{location.phone ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                      {offeringCount}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-600"
                        aria-label="Edit location"
                        onClick={() => openEdit(location)}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-red-600"
                        aria-label="Archive location"
                        onClick={() => setModal({ type: 'archive', payload: location })}
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal.type === 'add' || modal.type === 'edit' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onMouseDown={() => setModal({ type: null })} />
          <div
            className="relative mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              {modal.type === 'add' ? 'Add Location' : 'Edit Location'}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Address</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Phone</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Directions URL</label>
                <input
                  type="url"
                  value={form.directions_url}
                  onChange={(e) => setForm((prev) => ({ ...prev, directions_url: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
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
        title="Archive Location"
        message={
          modal.type === 'archive' && modal.payload
            ? `Archive ${modal.payload.name}? This will remove it from ${archiveOfferingCount} offerings and all provider assignments.`
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
