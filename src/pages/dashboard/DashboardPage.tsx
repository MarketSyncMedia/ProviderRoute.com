import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, MapPin, Plus, Stethoscope, Upload, Users } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import ImportWizard from '../../components/import/ImportWizard'
import { useToast } from '../../components/ui/toastStore'
import { intentState } from '../../hooks/useNavigationIntent'
import { getWidgets } from '../../lib/api/widgets'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import type { Widget } from '../../types/database'

function formatPublishedAt(iso: string | null): string | null {
  if (!iso) {
    return null
  }
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

interface DashboardData {
  providersCount: number
  locationsCount: number
  caseTypesCount: number
  widgetsCount: number
  widgets: Widget[]
}

async function fetchDashboard(orgId: string): Promise<DashboardData> {
  const [providersRes, locationsRes, caseTypesRes, widgetsCountRes, widgets] = await Promise.all([
    supabase
      .from('providers')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_archived', false),
    supabase
      .from('locations')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_archived', false),
    supabase
      .from('case_types')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_archived', false),
    supabase
      .from('widgets')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .neq('status', 'archived'),
    getWidgets(orgId),
  ])

  return {
    providersCount: providersRes.count ?? 0,
    locationsCount: locationsRes.count ?? 0,
    caseTypesCount: caseTypesRes.count ?? 0,
    widgetsCount: widgetsCountRes.count ?? 0,
    widgets,
  }
}

export default function DashboardPage() {
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const orgName = useAuthStore((s) => s.org?.name ?? '')
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [showImport, setShowImport] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', orgId],
    queryFn: () => fetchDashboard(orgId),
    enabled: Boolean(orgId),
  })

  const displayName = user?.name?.trim() || user?.email || 'there'
  const dashboardLoading = Boolean(orgId) && isLoading

  return (
    <div>
      <section className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Welcome back, {displayName}!</h1>
        <p className="mt-1 text-slate-500">{orgName}</p>
      </section>

      {!orgId || dashboardLoading ? (
        <p className="mb-8 text-sm text-slate-500">Loading dashboard…</p>
      ) : data ? (
        <>
          <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
                <Users className="h-5 w-5 text-indigo-600" aria-hidden />
              </div>
              <p className="mt-3 text-3xl font-bold text-slate-900">{data.providersCount}</p>
              <p className="mt-1 text-sm text-slate-500">Providers</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
                <MapPin className="h-5 w-5 text-emerald-600" aria-hidden />
              </div>
              <p className="mt-3 text-3xl font-bold text-slate-900">{data.locationsCount}</p>
              <p className="mt-1 text-sm text-slate-500">Locations</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50">
                <Stethoscope className="h-5 w-5 text-violet-600" aria-hidden />
              </div>
              <p className="mt-3 text-3xl font-bold text-slate-900">{data.caseTypesCount}</p>
              <p className="mt-1 text-sm text-slate-500">Case Types</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
                <Globe className="h-5 w-5 text-amber-600" aria-hidden />
              </div>
              <p className="mt-3 text-3xl font-bold text-slate-900">{data.widgetsCount}</p>
              <p className="mt-1 text-sm text-slate-500">Widgets</p>
            </div>
          </div>

          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Quick Actions</h2>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setShowImport(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                <Upload className="h-4 w-4" aria-hidden />
                Import Providers
              </button>
              <button
                type="button"
                onClick={() => navigate('/providers', { state: intentState('add-provider') })}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add Provider
              </button>
              <button
                type="button"
                onClick={() => navigate('/widgets', { state: intentState('create-widget') })}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                <Globe className="h-4 w-4" aria-hidden />
                Create Widget
              </button>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 className="font-semibold text-slate-900">Your Widgets</h2>
              <Link to="/widgets" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
                View all →
              </Link>
            </div>

            {data.widgets.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-slate-500">
                No widgets yet. Create your first widget.
              </p>
            ) : (
              <ul>
                {data.widgets.map((widget) => (
                  <li
                    key={widget.id}
                    className="flex items-center gap-4 border-b border-slate-100 px-6 py-4 last:border-0"
                  >
                    <span className="flex-1 text-sm font-medium text-slate-900">{widget.name}</span>
                    {widget.status === 'live' ? (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-600 animate-pulse" aria-hidden />
                        Live
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                        Draft
                      </span>
                    )}
                    <span className="w-40 shrink-0 text-right text-xs text-slate-500">
                      {widget.status === 'live' && widget.published_at
                        ? `Published ${formatPublishedAt(widget.published_at) ?? widget.published_at}`
                        : 'Never published'}
                    </span>
                    <Link
                      to={`/widgets/${widget.id}`}
                      className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      Configure →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <p className="mb-8 text-sm text-slate-500">Unable to load dashboard.</p>
      )}

      <ImportWizard
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onComplete={() => {
          queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] })
          setShowImport(false)
          toast.success('Import complete')
        }}
        orgId={orgId}
      />
    </div>
  )
}
