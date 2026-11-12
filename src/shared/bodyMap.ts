/**
 * The spots on the widget's clickable body map, and which case type each one
 * selects. Used by the dashboard (CaseTypesPage, to link a case type to a
 * spot) and the embeddable widget (to draw the spots), so both agree on what
 * a tag means. widget.js imports this file directly, like avatarPalette.ts.
 *
 * The tags are also the allowed values of `case_types.map_tag`; the
 * migration's CHECK constraint must list exactly these, which
 * tests/unit/bodyMap.test.ts enforces.
 *
 * Positions are percentages of each view's figure (0-100, from the top-left),
 * taken from the design mockups, so they hold at any rendered size.
 *
 * Besides these built-in spots, an admin can place a case type anywhere on the
 * figure themselves (a "custom spot", stored on the case type as map_view,
 * map_x, map_y and an optional label position). resolveSpot() turns either
 * kind into the same BodyMapSpot, so the widget and the dashboard draw both
 * the same way.
 */

import { VIEW_FRAMES } from './bodyOutline'

export type BodyMapView = 'front' | 'back'

export interface BodyMapSpot {
  readonly tag: string
  readonly label: string
  readonly view: BodyMapView
  readonly x: number
  readonly y: number
  /**
   * Whole words in a case type name that point at this spot. Used only to
   * suggest links for an admin to review -- never applied without them.
   */
  readonly keywords: readonly string[]
  /**
   * Where this spot's label goes, as percentages of the same view's figure
   * (may be outside 0-100, in the margin beside it). Only custom spots have
   * one; built-in spots use the hand-placed slots in bodyMapLabels.ts.
   */
  readonly labelAt?: { readonly x: number; readonly y: number }
  /** True for a spot an admin placed; its label is the case type's name. */
  readonly custom?: boolean
}

export const BODY_MAP_SPOTS: readonly BodyMapSpot[] = [
  { tag: 'shoulder', label: 'Shoulder', view: 'front', x: 26.49, y: 21.23, keywords: ['shoulder', 'rotator cuff'] },
  { tag: 'clavicle', label: 'Clavicle', view: 'front', x: 60.16, y: 21.26, keywords: ['clavicle', 'collarbone', 'collar bone'] },
  { tag: 'bicep', label: 'Bicep', view: 'front', x: 77, y: 31.5, keywords: ['bicep', 'biceps'] },
  { tag: 'wrist', label: 'Wrist', view: 'front', x: 85.43, y: 48.95, keywords: ['wrist', 'carpal tunnel'] },
  { tag: 'pelvis', label: 'Pelvis', view: 'front', x: 32.35, y: 45.76, keywords: ['pelvis', 'pelvic'] },
  { tag: 'groin', label: 'Groin', view: 'front', x: 52.81, y: 53.49, keywords: ['groin'] },
  { tag: 'knee', label: 'Knee', view: 'front', x: 58.04, y: 70.15, keywords: ['knee', 'knees', 'acl', 'meniscus'] },
  { tag: 'shin-splints', label: 'Shin Splints', view: 'front', x: 42.33, y: 82.06, keywords: ['shin', 'shins'] },
  { tag: 'ankle', label: 'Ankle', view: 'front', x: 56.35, y: 91.15, keywords: ['ankle', 'ankles'] },
  { tag: 'foot', label: 'Foot', view: 'front', x: 42.85, y: 95.49, keywords: ['foot', 'feet'] },
  { tag: 'toes', label: 'Toes', view: 'front', x: 60.47, y: 98.51, keywords: ['toe', 'toes', 'bunion', 'bunions'] },
  { tag: 'elbow', label: 'Elbow', view: 'back', x: 19.27, y: 41.65, keywords: ['elbow'] },
  { tag: 'hand', label: 'Hand', view: 'back', x: 9.9, y: 56, keywords: ['hand', 'finger', 'fingers', 'thumb'] },
  { tag: 'hip', label: 'Hip', view: 'back', x: 62.7, y: 47.1, keywords: ['hip', 'hips'] },
  { tag: 'neck', label: 'Neck', view: 'back', x: 49.72, y: 15.22, keywords: ['neck', 'cervical'] },
  { tag: 'low-back', label: 'Low Back', view: 'back', x: 49.72, y: 41.21, keywords: ['low back', 'lower back', 'lumbar'] },
  { tag: 'achilles', label: 'Achilles', view: 'back', x: 53.25, y: 92.16, keywords: ['achilles'] },
  { tag: 'heel', label: 'Heel', view: 'back', x: 44.08, y: 97.62, keywords: ['heel', 'heels', 'plantar'] },
]

/** Custom spots may put their label this far outside the figure, in percent. */
export const LABEL_MIN = -40
export const LABEL_MAX = 140

export const BODY_MAP_TAGS: readonly string[] = BODY_MAP_SPOTS.map((spot) => spot.tag)

export function bodyMapSpot(tag: string | null | undefined): BodyMapSpot | undefined {
  return tag ? BODY_MAP_SPOTS.find((spot) => spot.tag === tag) : undefined
}

/** A spot's centre in outline coordinates (see bodyOutline.ts). */
export function framePoint(view: BodyMapView, x: number, y: number): { x: number; y: number } {
  const frame = VIEW_FRAMES[view]
  return { x: frame.x + (x / 100) * frame.width, y: frame.y + (y / 100) * frame.height }
}

/** The columns of a case type that say where it sits on the map. */
export interface MapPlacementFields {
  id: string
  name: string
  map_tag?: string | null
  map_view?: string | null
  map_x?: number | null
  map_y?: number | null
  map_label_x?: number | null
  map_label_y?: number | null
}

/** A custom placement: the dot, and optionally where its label goes. */
export interface MapPlacement {
  view: BodyMapView
  x: number
  y: number
  labelX: number | null
  labelY: number | null
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** The custom placement stored on a case type, or null when it has none. */
export function placementOf(ct: MapPlacementFields): MapPlacement | null {
  const { map_view: view, map_x: x, map_y: y } = ct
  if ((view !== 'front' && view !== 'back') || !isNumber(x) || !isNumber(y)) return null
  const hasLabel = isNumber(ct.map_label_x) && isNumber(ct.map_label_y)
  return {
    view,
    x,
    y,
    labelX: hasLabel ? (ct.map_label_x as number) : null,
    labelY: hasLabel ? (ct.map_label_y as number) : null,
  }
}

/** Tag prefix of a custom spot, so it can never collide with a built-in tag. */
export const CUSTOM_SPOT_PREFIX = 'custom-'

/**
 * The spot a case type sits on: its built-in spot if it is linked to one,
 * else the custom spot an admin placed, else null (a plain button in the
 * widget). A tag this build does not know counts as no built-in spot.
 */
export function resolveSpot(ct: MapPlacementFields): BodyMapSpot | null {
  const builtIn = bodyMapSpot(ct.map_tag)
  if (builtIn) return builtIn
  const placement = placementOf(ct)
  if (!placement) return null
  return {
    tag: CUSTOM_SPOT_PREFIX + ct.id,
    label: ct.name,
    view: placement.view,
    x: placement.x,
    y: placement.y,
    keywords: [],
    custom: true,
    labelAt:
      placement.labelX !== null && placement.labelY !== null
        ? { x: placement.labelX, y: placement.labelY }
        : undefined,
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** Which view a point in outline coordinates belongs to: whichever figure is nearer across. */
export function viewAt(outlineX: number): BodyMapView {
  const middle = (VIEW_FRAMES.front.x + VIEW_FRAMES.front.width + VIEW_FRAMES.back.x) / 2
  return outlineX < middle ? 'front' : 'back'
}

/** A click on the outline as a dot position, in percent of the nearer figure. */
export function dotAt(point: { x: number; y: number }): { view: BodyMapView; x: number; y: number } {
  const view = viewAt(point.x)
  const frame = VIEW_FRAMES[view]
  return {
    view,
    x: round2(clamp(((point.x - frame.x) / frame.width) * 100, 0, 100)),
    y: round2(clamp(((point.y - frame.y) / frame.height) * 100, 0, 100)),
  }
}

/** A click on the outline as a label position, in percent of the dot's figure. */
export function labelAtPoint(view: BodyMapView, point: { x: number; y: number }): { x: number; y: number } {
  const frame = VIEW_FRAMES[view]
  return {
    x: round2(clamp(((point.x - frame.x) / frame.width) * 100, LABEL_MIN, LABEL_MAX)),
    y: round2(clamp(((point.y - frame.y) / frame.height) * 100, LABEL_MIN, LABEL_MAX)),
  }
}

/** Longest a name runs on one line before it is split across two. */
const LABEL_LINE_CHARS = 12

/** A custom spot's name as one or two lines, split at the space nearest the middle. */
export function labelLines(name: string): string[] {
  const text = name.trim()
  if (text.length <= LABEL_LINE_CHARS || !text.includes(' ')) return [text]
  let best = -1
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === ' ' && (best === -1 || Math.abs(i - text.length / 2) < Math.abs(best - text.length / 2))) best = i
  }
  return [text.slice(0, best), text.slice(best + 1)]
}

/** Lower case, punctuation to spaces, single-spaced, padded for whole-word search. */
function words(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
}

/** The spots whose keywords appear as whole words in `name`. */
export function spotsMatchingName(name: string): BodyMapSpot[] {
  const haystack = words(name)
  return BODY_MAP_SPOTS.filter((spot) =>
    spot.keywords.some((keyword) => haystack.includes(words(keyword))),
  )
}

export interface MapTagSuggestion {
  caseTypeId: string
  caseTypeName: string
  tag: string
}

/**
 * Proposes a spot for each untagged case type whose name clearly names one.
 *
 * Deliberately conservative, because a wrong link sends patients to the wrong
 * providers: a name matching two spots ("Foot and Ankle"), or a spot matched
 * by two names, or a spot already taken, yields no suggestion and is left for
 * the admin to pick by hand.
 */
export function suggestMapTags(
  caseTypes: ReadonlyArray<{ id: string; name: string; map_tag: string | null }>,
): MapTagSuggestion[] {
  const taken = new Set(caseTypes.map((ct) => ct.map_tag).filter((tag): tag is string => Boolean(tag)))

  const candidates: MapTagSuggestion[] = []
  for (const ct of caseTypes) {
    if (ct.map_tag) continue
    const matches = spotsMatchingName(ct.name)
    if (matches.length !== 1) continue
    const [spot] = matches
    if (taken.has(spot.tag)) continue
    candidates.push({ caseTypeId: ct.id, caseTypeName: ct.name, tag: spot.tag })
  }

  const perTag = new Map<string, number>()
  for (const c of candidates) perTag.set(c.tag, (perTag.get(c.tag) ?? 0) + 1)
  return candidates.filter((c) => perTag.get(c.tag) === 1)
}
