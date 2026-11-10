import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LABEL_MAX,
  LABEL_MIN,
  bodyMapSpot,
  dotAt,
  framePoint,
  labelAtPoint,
  labelLines,
  placementOf,
  resolveSpot,
  viewAt,
} from '../../src/shared/bodyMap'
import { BODY_MAP_LABELS, labelLayout } from '../../src/shared/bodyMapLabels'
import { VIEW_FRAMES } from '../../src/shared/bodyOutline'

/**
 * Spots an admin places themselves, for case types that have no built-in spot.
 * A case type stores view / x / y (percent of that figure) and optionally a
 * label position; resolveSpot() makes it the same kind of spot the built-in 18
 * are, so the widget and the case types page draw both alike.
 */

const ct = (over: Record<string, unknown> = {}) => ({ id: 'ct1', name: 'Pectoral', ...over })

describe('placementOf', () => {
  it('reads the dot and the label from a case type', () => {
    expect(
      placementOf(ct({ map_view: 'front', map_x: 45, map_y: 27.5, map_label_x: 5, map_label_y: 25 })),
    ).toEqual({ view: 'front', x: 45, y: 27.5, labelX: 5, labelY: 25 })
  })

  it('has no label until both coordinates are set', () => {
    expect(placementOf(ct({ map_view: 'back', map_x: 1, map_y: 2 }))).toEqual({
      view: 'back',
      x: 1,
      y: 2,
      labelX: null,
      labelY: null,
    })
    expect(placementOf(ct({ map_view: 'back', map_x: 1, map_y: 2, map_label_x: 5, map_label_y: null }))?.labelX).toBeNull()
  })

  it('is null when anything about the dot is missing or invalid', () => {
    expect(placementOf(ct())).toBeNull()
    expect(placementOf(ct({ map_view: 'side', map_x: 1, map_y: 2 }))).toBeNull()
    expect(placementOf(ct({ map_view: 'front', map_x: 1, map_y: null }))).toBeNull()
    expect(placementOf(ct({ map_view: 'front', map_x: Number.NaN, map_y: 2 }))).toBeNull()
  })
})

describe('resolveSpot', () => {
  it('returns the built-in spot for a linked case type', () => {
    expect(resolveSpot(ct({ map_tag: 'knee' }))).toBe(bodyMapSpot('knee'))
  })

  it('prefers the built-in spot if a row somehow has both', () => {
    expect(resolveSpot(ct({ map_tag: 'knee', map_view: 'front', map_x: 1, map_y: 2 }))?.tag).toBe('knee')
  })

  it('makes a custom spot labelled with the case type name', () => {
    expect(resolveSpot(ct({ map_view: 'front', map_x: 45, map_y: 27, map_label_x: 5, map_label_y: 25 }))).toEqual({
      tag: 'custom-ct1',
      label: 'Pectoral',
      view: 'front',
      x: 45,
      y: 27,
      keywords: [],
      custom: true,
      labelAt: { x: 5, y: 25 },
    })
  })

  it('treats an unknown tag with no placement as no spot, and one with a placement as custom', () => {
    expect(resolveSpot(ct({ map_tag: 'jaw' }))).toBeNull()
    expect(resolveSpot(ct({ map_tag: 'jaw', map_view: 'back', map_x: 1, map_y: 2 }))?.custom).toBe(true)
  })

  it('is null for a case type with no spot at all', () => {
    expect(resolveSpot(ct())).toBeNull()
    expect(resolveSpot(ct({ map_tag: null, map_view: null }))).toBeNull()
  })
})

describe('clicks on the outline', () => {
  it('belong to whichever figure is nearer across', () => {
    expect(viewAt(VIEW_FRAMES.front.x + 10)).toBe('front')
    expect(viewAt(VIEW_FRAMES.back.x + 10)).toBe('back')
  })

  it('become a dot position that draws back where it was clicked', () => {
    const click = framePoint('back', 37.5, 62.25)
    const dot = dotAt(click)
    expect(dot).toEqual({ view: 'back', x: 37.5, y: 62.25 })
    const again = framePoint(dot.view, dot.x, dot.y)
    expect(again.x).toBeCloseTo(click.x, 1)
    expect(again.y).toBeCloseTo(click.y, 1)
  })

  it('keep the dot on the figure when the click lands in the margin', () => {
    expect(dotAt({ x: -40, y: -50 })).toEqual({ view: 'front', x: 0, y: 0 })
    expect(dotAt({ x: 1294, y: 1254 })).toEqual({ view: 'back', x: 100, y: 100 })
  })

  it('let a label sit in the margin beside the figure, but not off the drawing', () => {
    expect(labelAtPoint('front', framePoint('front', -20, 30)).x).toBe(-20)
    expect(labelAtPoint('front', { x: -5000, y: 99999 })).toEqual({ x: LABEL_MIN, y: LABEL_MAX })
  })
})

describe('labelLines', () => {
  it('keeps a short name on one line', () => {
    expect(labelLines('Pectoral')).toEqual(['Pectoral'])
    expect(labelLines('  Hand  ')).toEqual(['Hand'])
  })

  it('splits a long name at the space nearest the middle', () => {
    expect(labelLines('Rotator Cuff Tear')).toEqual(['Rotator', 'Cuff Tear'])
    expect(labelLines('Plantar Fasciitis')).toEqual(['Plantar', 'Fasciitis'])
  })

  it('leaves a long single word alone', () => {
    expect(labelLines('Tendinopathies')).toEqual(['Tendinopathies'])
  })
})

describe('labelLayout', () => {
  const dot = { view: 'front' as const, x: 45, y: 27 }

  it('uses the hand-placed slot of a built-in spot', () => {
    expect(labelLayout(bodyMapSpot('shoulder')!)).toBe(BODY_MAP_LABELS.shoulder)
  })

  it('puts a custom label where the admin chose, on the side it lies from the dot', () => {
    const left = labelLayout({ ...dot, tag: 'custom-a', label: 'Pectoral', keywords: [], custom: true, labelAt: { x: 5, y: 25 } })
    const right = labelLayout({ ...dot, tag: 'custom-a', label: 'Pectoral', keywords: [], custom: true, labelAt: { x: 90, y: 25 } })
    expect(left.anchor).toBe('end')
    expect(right.anchor).toBe('start')
    const at = framePoint('front', 5, 25)
    expect(left).toMatchObject({ x: at.x, y: at.y, lines: ['Pectoral'] })
  })

  it('puts a custom label beside its dot, on the roomier side, when none was chosen', () => {
    const p = framePoint('front', 45, 27)
    const inner = labelLayout({ ...dot, tag: 'custom-a', label: 'Pectoral', keywords: [], custom: true })
    expect(inner).toMatchObject({ anchor: 'start', x: p.x + 40 })
    const q = framePoint('front', 80, 27)
    const outer = labelLayout({ ...dot, x: 80, tag: 'custom-a', label: 'Pectoral', keywords: [], custom: true })
    expect(outer).toMatchObject({ anchor: 'end', x: q.x - 40 })
  })
})

describe('the database check', () => {
  it('allows the label range the app clamps to', () => {
    // The latest migration that defines the check is the one in force.
    const dir = resolve(import.meta.dirname, '../../supabase/migrations')
    const defining = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .filter((sql) => /ADD CONSTRAINT case_types_map_position_check/.test(sql))
    expect(defining.length).toBeGreaterThan(0)
    const check = defining.at(-1)!
    expect(check).toContain(`BETWEEN ${LABEL_MIN} AND ${LABEL_MAX}`)
    expect(check).toContain(`map_view IN ('front', 'back')`)
  })
})
