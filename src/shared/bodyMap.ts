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
 */

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
}

export const BODY_MAP_SPOTS: readonly BodyMapSpot[] = [
  { tag: 'shoulder', label: 'Shoulder', view: 'front', x: 26.49, y: 21.23, keywords: ['shoulder', 'rotator cuff'] },
  { tag: 'clavicle', label: 'Clavicle', view: 'front', x: 60.16, y: 21.26, keywords: ['clavicle', 'collarbone', 'collar bone'] },
  { tag: 'elbow', label: 'Elbow', view: 'front', x: 21.9, y: 39.17, keywords: ['elbow'] },
  { tag: 'hand', label: 'Hand', view: 'front', x: 11.42, y: 53.49, keywords: ['hand', 'finger', 'fingers', 'thumb'] },
  { tag: 'wrist', label: 'Wrist', view: 'front', x: 85.43, y: 48.95, keywords: ['wrist', 'carpal tunnel'] },
  { tag: 'pelvis', label: 'Pelvis', view: 'front', x: 32.35, y: 45.76, keywords: ['pelvis', 'pelvic'] },
  { tag: 'hip', label: 'Hip', view: 'front', x: 68.51, y: 48.26, keywords: ['hip', 'hips'] },
  { tag: 'groin', label: 'Groin', view: 'front', x: 52.81, y: 53.49, keywords: ['groin'] },
  { tag: 'knee', label: 'Knee', view: 'front', x: 58.04, y: 70.15, keywords: ['knee', 'knees', 'acl', 'meniscus'] },
  { tag: 'shin-splints', label: 'Shin Splints', view: 'front', x: 42.33, y: 82.06, keywords: ['shin', 'shins'] },
  { tag: 'ankle', label: 'Ankle', view: 'front', x: 56.35, y: 91.15, keywords: ['ankle', 'ankles'] },
  { tag: 'foot', label: 'Foot', view: 'front', x: 42.85, y: 95.49, keywords: ['foot', 'feet'] },
  { tag: 'toes', label: 'Toes', view: 'front', x: 60.47, y: 98.51, keywords: ['toe', 'toes', 'bunion', 'bunions'] },
  { tag: 'neck', label: 'Neck', view: 'back', x: 49.72, y: 15.22, keywords: ['neck', 'cervical'] },
  { tag: 'low-back', label: 'Low Back', view: 'back', x: 49.72, y: 41.21, keywords: ['low back', 'lower back', 'lumbar'] },
  { tag: 'achilles', label: 'Achilles', view: 'back', x: 53.25, y: 92.16, keywords: ['achilles'] },
  { tag: 'heel', label: 'Heel', view: 'back', x: 44.08, y: 97.62, keywords: ['heel', 'heels', 'plantar'] },
]

export const BODY_MAP_TAGS: readonly string[] = BODY_MAP_SPOTS.map((spot) => spot.tag)

export function bodyMapSpot(tag: string | null | undefined): BodyMapSpot | undefined {
  return tag ? BODY_MAP_SPOTS.find((spot) => spot.tag === tag) : undefined
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
