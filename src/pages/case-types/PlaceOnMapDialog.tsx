import { useState, type MouseEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react'
import { useToast } from '../../components/ui/toastStore'
import { updateCaseTypeMapPosition } from '../../lib/api/caseTypes'
import {
  LABEL_MAX,
  LABEL_MIN,
  dotAt,
  framePoint,
  labelAtPoint,
  placementOf,
  resolveSpot,
  type BodyMapSpot,
  type BodyMapView,
} from '../../shared/bodyMap'
import { LABEL_SIZE, labelLayout } from '../../shared/bodyMapLabels'
import { MAP_VIEWBOX, OUTLINE_PATH } from '../../shared/bodyOutline'
import type { CaseType } from '../../types/database'
import { useInvalidateCaseTypes } from './useInvalidateCaseTypes'

/**
 * Where a case type goes on the widget's body map, chosen by the admin instead
 * of by one of the 18 built-in spots: click the figure for the dot, then
 * (optionally) click where its name should be written. The other spots are drawn
 * as they appear in the widget so a clash is visible before saving.
 */

interface Dot {
  view: BodyMapView
  x: number
  y: number
}

type Mode = 'dot' | 'label'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const round2 = (n: number) => Math.round(n * 100) / 100

/** A spot's label and leader line, as the widget draws them (without the tap areas). */
function SpotMark({ spot, tone }: { spot: BodyMapSpot; tone: 'current' | 'other' }) {
  const p = framePoint(spot.view, spot.x, spot.y)
  const layout = labelLayout(spot)
  const lines = layout.lines ?? [spot.label]
  const current = tone === 'current'
  return (
    <g data-spot={spot.tag}>
      <line
        x1={layout.x}
        y1={layout.y - LABEL_SIZE * 0.3}
        x2={p.x}
        y2={p.y}
        strokeWidth={3}
        className={current ? 'stroke-indigo-400' : 'stroke-slate-300'}
      />
      <text
        x={layout.x}
        y={layout.y}
        textAnchor={layout.anchor}
        fontSize={LABEL_SIZE}
        fontWeight={600}
        stroke="white"
        strokeWidth={9}
        strokeLinejoin="round"
        paintOrder="stroke"
        className={current ? 'fill-indigo-700' : 'fill-slate-500'}
      >
        {lines.map((line, i) => (
          <tspan key={line} x={layout.x} dy={i === 0 ? 0 : LABEL_SIZE * 1.05}>
            {line}
          </tspan>
        ))}
      </text>
      <circle
        cx={p.x}
        cy={p.y}
        r={22}
        strokeWidth={6}
        className={current ? 'fill-indigo-600 stroke-white' : 'fill-slate-400 stroke-white'}
      />
    </g>
  )
}

export function PlaceOnMapDialog({
  caseType,
  all,
  onClose,
}: {
  caseType: CaseType
  all: CaseType[]
  onClose: () => void
}) {
  const { toast } = useToast()
  const invalidate = useInvalidateCaseTypes()
  const existing = placementOf(caseType)

  const [dot, setDot] = useState<Dot | null>(existing ? { view: existing.view, x: existing.x, y: existing.y } : null)
  const [label, setLabel] = useState<{ x: number; y: number } | null>(
    existing && existing.labelX !== null && existing.labelY !== null ? { x: existing.labelX, y: existing.labelY } : null,
  )
  const [mode, setMode] = useState<Mode>('dot')
  const [saving, setSaving] = useState(false)

  // Everything else already on the map, so the admin can see what is nearby.
  const others = all
    .filter((ct) => ct.id !== caseType.id)
    .map((ct) => resolveSpot(ct))
    .filter((spot): spot is BodyMapSpot => spot !== null)

  const current: BodyMapSpot | null = dot
    ? {
        tag: `custom-${caseType.id}`,
        label: caseType.name,
        view: dot.view,
        x: dot.x,
        y: dot.y,
        keywords: [],
        custom: true,
        labelAt: label ?? undefined,
      }
    : null

  function onPick(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const point = {
      x: MAP_VIEWBOX.x + ((e.clientX - rect.left) / rect.width) * MAP_VIEWBOX.width,
      y: MAP_VIEWBOX.y + ((e.clientY - rect.top) / rect.height) * MAP_VIEWBOX.height,
    }
    if (mode === 'dot') {
      const next = dotAt(point)
      // Moving the dot to the other figure leaves the label where it was in the
      // wrong view's coordinates, so it goes back to the default beside the dot.
      if (dot && dot.view !== next.view) setLabel(null)
      setDot(next)
      setMode('label')
    } else if (dot) {
      setLabel(labelAtPoint(dot.view, point))
    }
  }

  /** One percent per press, for precision a click cannot give and for keyboard use. */
  function nudge(dx: number, dy: number) {
    if (mode === 'dot' && dot) {
      setDot({ ...dot, x: round2(clamp(dot.x + dx, 0, 100)), y: round2(clamp(dot.y + dy, 0, 100)) })
    } else if (mode === 'label' && dot) {
      const from = label ?? { x: dot.x, y: dot.y }
      setLabel({ x: round2(clamp(from.x + dx, LABEL_MIN, LABEL_MAX)), y: round2(clamp(from.y + dy, LABEL_MIN, LABEL_MAX)) })
    }
  }

  async function save() {
    if (!dot) return
    setSaving(true)
    const { error } = await updateCaseTypeMapPosition(caseType.id, {
      view: dot.view,
      x: dot.x,
      y: dot.y,
      labelX: label?.x ?? null,
      labelY: label?.y ?? null,
    })
    setSaving(false)
    await invalidate()
    if (error) {
      toast.error(error)
      return
    }
    toast.success(`${caseType.name} placed on the body map`)
    onClose()
  }

  const nudgeButton = (name: string, dx: number, dy: number, icon: React.ReactNode) => (
    <button
      type="button"
      aria-label={name}
      title={name}
      disabled={!dot}
      onClick={() => nudge(dx, dy)}
      className="rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
    >
      {icon}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-label={`Place ${caseType.name} on the body map`}
        className="relative mx-4 max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Place {caseType.name} on the body map</h2>
        <p className="mb-3 text-sm text-slate-500">
          {mode === 'dot'
            ? 'Click the figure where patients should tap for this case type.'
            : 'Now click where its name should be written, or save to put it beside the dot.'}
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={mode === 'dot'}
            onClick={() => setMode('dot')}
            className={[
              'rounded-lg border px-3 py-1.5 text-sm font-medium',
              mode === 'dot' ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-700',
            ].join(' ')}
          >
            Place the dot
          </button>
          <button
            type="button"
            aria-pressed={mode === 'label'}
            disabled={!dot}
            onClick={() => setMode('label')}
            className={[
              'rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-40',
              mode === 'label' ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-700',
            ].join(' ')}
          >
            Place the label
          </button>
          <div className="ml-auto flex items-center gap-1" role="group" aria-label={`Nudge the ${mode}`}>
            {nudgeButton('Nudge left', -1, 0, <ArrowLeft className="h-4 w-4" />)}
            {nudgeButton('Nudge up', 0, -1, <ArrowUp className="h-4 w-4" />)}
            {nudgeButton('Nudge down', 0, 1, <ArrowDown className="h-4 w-4" />)}
            {nudgeButton('Nudge right', 1, 0, <ArrowRight className="h-4 w-4" />)}
          </div>
        </div>

        <svg
          viewBox={`${MAP_VIEWBOX.x} ${MAP_VIEWBOX.y} ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
          role="img"
          aria-label="Body map. Click to place."
          className="w-full cursor-crosshair rounded-lg bg-slate-50"
          onClick={onPick}
        >
          <path d={OUTLINE_PATH} fillRule="evenodd" className="fill-slate-300" />
          {others.map((spot) => (
            <SpotMark key={spot.tag} spot={spot} tone="other" />
          ))}
          {current ? <SpotMark spot={current} tone="current" /> : null}
        </svg>
        <p className="mt-2 text-xs text-slate-500">
          Grey spots are already on the map. The widget draws this one just as it appears here.
        </p>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dot}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save placement'}
          </button>
        </div>
      </div>
    </div>
  )
}
