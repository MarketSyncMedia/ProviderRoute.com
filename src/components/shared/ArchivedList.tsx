import { useState } from 'react'
import { ArchiveRestore, ChevronDown, ChevronRight } from 'lucide-react'

/**
 * The collapsed "Archived providers (3)" list under a page, one Restore button
 * per row. Archiving hides something everywhere and keeps everything about it,
 * so each archivable thing gets the same way back, wherever it is archived.
 */
export default function ArchivedList<T extends { id: string }>({
  label,
  items,
  nameOf,
  detailOf,
  restoringId,
  onRestore,
}: {
  /** Lower case plural, as in "Archived providers (3)". */
  label: string
  items: T[]
  nameOf: (item: T) => string
  detailOf?: (item: T) => string | null
  restoringId: string | null
  onRestore: (item: T) => void
}) {
  const [open, setOpen] = useState(false)

  if (items.length === 0) return null

  return (
    <section className="mt-8">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Archived {label} ({items.length})
      </button>
      {open ? (
        <ul className="mt-3 space-y-2">
          {items.map((item) => {
            const detail = detailOf?.(item)
            return (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5"
              >
                <span className="flex-1 text-sm text-slate-600">
                  {nameOf(item)}
                  {detail ? <span className="ml-2 text-xs text-slate-400">{detail}</span> : null}
                </span>
                <button
                  type="button"
                  aria-label={`Restore ${nameOf(item)}`}
                  disabled={restoringId !== null}
                  onClick={() => onRestore(item)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  <ArchiveRestore className="h-3.5 w-3.5" />
                  {restoringId === item.id ? 'Restoring…' : 'Restore'}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
