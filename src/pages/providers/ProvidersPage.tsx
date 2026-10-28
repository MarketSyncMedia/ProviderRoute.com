import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Upload, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useNavigationIntent } from '../../hooks/useNavigationIntent'
import ImportWizard from '../../components/import/ImportWizard'
import EmptyState from '../../components/ui/EmptyState'
import { useToast } from '../../components/ui/toastStore'
import { getProviders, createProvider } from '../../lib/api/providers'
import { supabase } from '../../lib/supabase'
import { AVATAR_COLORS, avatarColorIndex, initialsForName } from '../../shared/avatarPalette'
import { readableTextColor } from '../../shared/colorContrast'
import { useAuthStore } from '../../stores/authStore'
import type { Category } from '../../types/database'

interface AddProviderForm {
  name: string
  subtitle: string
  npi: string
  email: string
  bio_link: string
}

export default function ProvidersPage() {
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const openAddOnArrival = useNavigationIntent('add-provider')
  const [modal, setModal] = useState<{ type: 'add' | null }>(() => ({ type: openAddOnArrival ? 'add' : null }))
  const [searchQuery, setSearchQuery] = useState('')
  const [addForm, setAddForm] = useState<AddProviderForm>({
    name: '',
    subtitle: '',
    npi: '',
    email: '',
    bio_link: '',
  })
  const [addError, setAddError] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [showImport, setShowImport] = useState(false)

  const { data: providers = [] } = useQuery({
    queryKey: ['providers', orgId],
    queryFn: () => getProviders(orgId),
    enabled: Boolean(orgId),
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .order('name', { ascending: true })
      return (data ?? []) as Category[]
    },
    enabled: Boolean(orgId),
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModal({ type: null })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (modal.type) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [modal.type])

  const filteredProviders = useMemo(
    () =>
      providers.filter((provider) =>
        provider.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
      ),
    [providers, searchQuery]
  )

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>()
    categories.forEach((category) => map.set(category.id, category.name))
    return map
  }, [categories])

  async function handleAddProvider() {
    if (!orgId) {
      setAddError('Organization not found')
      return
    }

    if (!addForm.name.trim()) {
      setAddError('Provider name is required')
      return
    }

    setAddError('')
    setAddLoading(true)

    const result = await createProvider({
      org_id: orgId,
      name: addForm.name.trim(),
      subtitle: addForm.subtitle.trim() || undefined,
      npi: addForm.npi.trim() || undefined,
      email: addForm.email.trim() || undefined,
      bio_link: addForm.bio_link.trim() || undefined,
    })

    if (result.error) {
      setAddError(result.error)
      setAddLoading(false)
      return
    }

    await queryClient.invalidateQueries({ queryKey: ['providers', orgId] })
    setModal({ type: null })
    setAddForm({ name: '', subtitle: '', npi: '', email: '', bio_link: '' })
    setAddLoading(false)
    toast.success('Provider added')
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search providers"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64 rounded-lg border border-slate-300 py-2 pl-10 pr-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => setShowImport(true)}
          >
            <Upload className="h-4 w-4" />
            Import
          </button>
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
            onClick={() => setModal({ type: 'add' })}
          >
            <Plus className="h-4 w-4" />
            Add Provider
          </button>
        </div>
      </div>

      {filteredProviders.length === 0 ? (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title="No providers yet"
          description="Import your data or add a provider manually"
          action={showImport ? <span className="text-xs text-slate-400">Opening import...</span> : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredProviders.map((provider) => {
            const initials = initialsForName(provider.name)
            const avatarColor = AVATAR_COLORS[avatarColorIndex(provider.name)]
            const providerCategories = provider.category_ids
              .map((categoryId) => categoryNameById.get(categoryId))
              .filter((name): name is string => Boolean(name))

            return (
              <div
                key={provider.id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md"
              >
                <div className="mb-4 flex justify-center">
                  {provider.image_url ? (
                    <img
                      src={provider.image_url}
                      alt={provider.name}
                      className="h-20 w-20 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className={`flex h-20 w-20 items-center justify-center rounded-full text-xl font-bold ${avatarColor.tw}`}
                      style={{ color: readableTextColor(avatarColor.hex) }}
                    >
                      {initials}
                    </div>
                  )}
                </div>

                <h3 className="text-center font-semibold text-slate-900">{provider.name}</h3>
                {provider.subtitle ? (
                  <p className="mt-0.5 text-center text-sm text-slate-500">{provider.subtitle}</p>
                ) : null}

                {providerCategories.length > 0 ? (
                  <div className="mt-2 flex flex-wrap justify-center gap-1">
                    {providerCategories.map((categoryName) => (
                      <span
                        key={`${provider.id}-${categoryName}`}
                        className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700"
                      >
                        {categoryName}
                      </span>
                    ))}
                  </div>
                ) : null}

                <button
                  type="button"
                  className="mt-4 w-full rounded-lg border border-slate-300 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => navigate(`/providers/${provider.id}`)}
                >
                  Edit
                </button>
              </div>
            )
          })}
        </div>
      )}

      {modal.type === 'add' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onMouseDown={() => setModal({ type: null })} />
          <div
            className="relative mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold">Add Provider</h2>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Provider Name</label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Subtitle</label>
                <input
                  type="text"
                  value={addForm.subtitle}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, subtitle: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">NPI</label>
                <input
                  type="text"
                  value={addForm.npi}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, npi: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, email: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Bio Link</label>
                <input
                  type="url"
                  value={addForm.bio_link}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, bio_link: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {addError ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {addError}
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModal({ type: null })}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
                disabled={addLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddProvider}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
                disabled={addLoading}
              >
                {addLoading ? 'Adding...' : 'Add Provider'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ImportWizard
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onComplete={() => {
          queryClient.invalidateQueries({ queryKey: ['providers', orgId] })
          setShowImport(false)
          toast.success('Import complete')
        }}
        orgId={orgId}
      />
    </div>
  )
}
