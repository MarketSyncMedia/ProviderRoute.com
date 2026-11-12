import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useNavigationIntent } from '../../hooks/useNavigationIntent'
import { createWidget, getWidgets } from '../../lib/api/widgets'
import { approvedHttpsUrl } from '../../lib/approvedUrl'
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

export default function WidgetsPage() {
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const openCreateOnArrival = useNavigationIntent('create-widget')
  const [modal, setModal] = useState<{ type: 'create' | 'embed' | null; payload?: Widget }>(() => ({
    type: openCreateOnArrival ? 'create' : null,
  }))
  const [createName, setCreateName] = useState('')
  const [createError, setCreateError] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [embedCopied, setEmbedCopied] = useState(false)

  const { data: widgets = [], isLoading } = useQuery({
    queryKey: ['widgets', orgId],
    queryFn: () => getWidgets(orgId),
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

  // Reset the "Copied!" label as the embed dialog opens rather than in an
  // effect watching every modal transition.
  function openEmbed(widget: Widget) {
    setEmbedCopied(false)
    setModal({ type: 'embed', payload: widget })
  }

  async function handleCreateWidget() {
    const name = createName.trim()
    if (name.length < 2) {
      setCreateError('Name must be at least 2 characters')
      return
    }
    if (!orgId) {
      setCreateError('Organization not found')
      return
    }

    setCreateError('')
    setCreateLoading(true)
    const { data, error } = await createWidget(orgId, name)
    setCreateLoading(false)

    if (error || !data) {
      setCreateError(error ?? 'Failed to create widget')
      return
    }

    await queryClient.invalidateQueries({ queryKey: ['widgets', orgId] })
    setModal({ type: null })
    setCreateName('')
    navigate(`/widgets/${data.id}`)
  }

  function openCreateModal() {
    setCreateName('')
    setCreateError('')
    setModal({ type: 'create' })
  }

  const widgetScriptUrl = approvedHttpsUrl(import.meta.env.VITE_WIDGET_SCRIPT_URL)
  const embedScript =
    modal.type === 'embed' && modal.payload && widgetScriptUrl
      ? `<script src="${widgetScriptUrl}" data-widget-id="${modal.payload.id}"></script>`
      : ''

  async function copyEmbedCode() {
    if (!embedScript) {
      return
    }
    try {
      await navigator.clipboard.writeText(embedScript)
      setEmbedCopied(true)
      window.setTimeout(() => setEmbedCopied(false), 2000)
    } catch {
      setEmbedCopied(false)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div />
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + Create Widget
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading widgets…</p>
      ) : widgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center">
          <Globe className="mb-4 h-12 w-12 text-slate-400" aria-hidden />
          <p className="text-lg font-medium text-slate-800">No widgets yet</p>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            Create your first widget to start routing patients.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {widgets.map((widget) => (
            <div
              key={widget.id}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-semibold text-slate-900">{widget.name}</h3>
                {widget.status === 'live' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-600 animate-pulse" aria-hidden />
                    Live
                  </span>
                ) : (
                  <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                    Draft
                  </span>
                )}
              </div>

              {widget.status === 'live' && widget.published_at ? (
                <p className="mt-2 text-xs text-slate-500">
                  Published {formatPublishedAt(widget.published_at) ?? widget.published_at}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div
                  className="h-4 w-4 shrink-0 rounded-full border border-slate-200"
                  style={{ backgroundColor: widget.primary_color ?? '#4F46E5' }}
                  title={widget.primary_color ?? undefined}
                />
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-700">
                  {widget.embed_mode}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/widgets/${widget.id}`)}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Configure
                </button>
                {widget.status === 'live' ? (
                  <button
                    type="button"
                    onClick={() => openEmbed(widget)}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                  >
                    Get Embed Code
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal.type === 'create' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onMouseDown={() => setModal({ type: null })} />
          <div
            className="relative mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Create Widget</h2>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Widget Name</label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="My widget"
                autoFocus
              />
            </div>
            {createError ? (
              <p className="mt-3 text-sm text-red-600">{createError}</p>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModal({ type: null })}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                disabled={createLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateWidget()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                disabled={createLoading}
              >
                {createLoading ? 'Creating…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modal.type === 'embed' && modal.payload ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onMouseDown={() => setModal({ type: null })} />
          <div
            className="relative mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              {modal.payload.name} — Embed Code
            </h2>

            {embedScript ? (
              <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 font-mono text-sm text-green-400">
                {embedScript}
              </pre>
            ) : (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Widget delivery is not configured. Set VITE_WIDGET_SCRIPT_URL to the approved company-owned HTTPS asset URL.
              </p>
            )}

            <button
              type="button"
              onClick={() => void copyEmbedCode()}
              disabled={!embedScript}
              className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {embedCopied ? 'Copied!' : 'Copy Code'}
            </button>

            <div className="mt-6 space-y-2 text-sm text-slate-600">
              <p className="font-medium text-slate-800">Installation instructions</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Copy the script tag above</li>
                <li>Paste before closing {'</body>'} tag</li>
                <li>WordPress: use &quot;Insert Headers and Footers&quot; plugin</li>
              </ol>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setModal({ type: null })}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
