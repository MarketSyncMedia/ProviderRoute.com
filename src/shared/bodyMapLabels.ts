/**
 * Where the widget draws each built-in spot's label, in outline coordinates
 * (see bodyOutline.ts), and the label text size. Shared so the case types
 * page can draw the same labels when an admin places a new spot among them.
 *
 * These slots were placed by hand in the white space around the figures --
 * beside the head, between the arms, beside and below the legs -- so the text
 * can be large without covering the body or another label. A leader line joins
 * each label to its dot. `lines` splits a label that is too wide for its gap.
 * Spots an admin places themselves choose their own label position instead
 * (see resolveSpot in bodyMap.ts).
 */

import { framePoint, labelLines, type BodyMapSpot } from './bodyMap'

/** Label text size, in outline units (about 12-13px at the widget's width). */
export const LABEL_SIZE = 46

export interface LabelSlot {
  readonly x: number
  readonly y: number
  readonly anchor: 'start' | 'middle' | 'end'
  readonly lines?: readonly string[]
}

export const BODY_MAP_LABELS: Readonly<Record<string, LabelSlot>> = {
  shoulder: { x: 205, y: 190, anchor: 'end' },
  clavicle: { x: 470, y: 190, anchor: 'start' },
  bicep: { x: 565, y: 365, anchor: 'start' },
  elbow: { x: 140, y: 440, anchor: 'end' },
  pelvis: { x: 140, y: 575, anchor: 'end' },
  hand: { x: 120, y: 810, anchor: 'middle' },
  wrist: { x: 610, y: 615, anchor: 'start' },
  hip: { x: 560, y: 480, anchor: 'start' },
  groin: { x: 385, y: 748, anchor: 'start' },
  knee: { x: 450, y: 866, anchor: 'start' },
  'shin-splints': { x: 235, y: 975, anchor: 'end', lines: ['Shin', 'Splints'] },
  ankle: { x: 490, y: 1090, anchor: 'start' },
  foot: { x: 235, y: 1160, anchor: 'end' },
  toes: { x: 490, y: 1190, anchor: 'start' },
  neck: { x: 990, y: 170, anchor: 'start' },
  'low-back': { x: 1110, y: 470, anchor: 'start', lines: ['Low', 'Back'] },
  achilles: { x: 1000, y: 1080, anchor: 'start' },
  heel: { x: 760, y: 1190, anchor: 'end' },
}

/**
 * Where a spot's label goes, in outline coordinates. Built-in spots have the
 * hand-placed slots above; one the admin placed uses the label position they
 * chose, or sits beside its dot -- on whichever side has more room -- when
 * they did not choose one. Used by the widget and the case types page alike.
 */
export function labelLayout(spot: BodyMapSpot): LabelSlot {
  const p = framePoint(spot.view, spot.x, spot.y)
  if (!spot.custom) return BODY_MAP_LABELS[spot.tag] ?? { x: p.x + 40, y: p.y + 14, anchor: 'start' }
  const lines = labelLines(spot.label)
  if (spot.labelAt) {
    const at = framePoint(spot.view, spot.labelAt.x, spot.labelAt.y)
    return { x: at.x, y: at.y, anchor: spot.labelAt.x < spot.x ? 'end' : 'start', lines }
  }
  const right = spot.x < 60
  return { x: p.x + (right ? 40 : -40), y: p.y + 14, anchor: right ? 'start' : 'end', lines }
}
