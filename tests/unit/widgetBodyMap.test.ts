import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BODY_MAP_TAGS } from '../../src/shared/bodyMap'
import { LABELS, bodyMapStyles, buildBodyMap, partitionCaseTypes } from '../../widget/src/bodyMap.js'

/**
 * The widget's body map (widget/src/bodyMap.js). The flow under test: tap a
 * spot, it zooms in and asks to confirm; Continue selects the case type, Back
 * returns to the full map without selecting anything.
 */

type CaseType = { id: string; name: string; map_tag: string | null }

const caseTypes: CaseType[] = [
  { id: 'knee', name: 'Knee', map_tag: 'knee' },
  { id: 'neck', name: 'Neck Pain', map_tag: 'neck' },
  { id: 'general', name: 'General Orthopedics', map_tag: null },
]

let onSelect: ReturnType<typeof vi.fn>
let map: HTMLElement

function spot(tag: string) {
  return map.querySelector(`.pm-bodymap-spot[data-tag="${tag}"]`) as SVGGElement
}
function callout(tag: string) {
  return map.querySelector(`.pm-bodymap-callout[data-tag="${tag}"]`) as SVGGElement
}
function confirmPanel() {
  return map.querySelector('.pm-bodymap-confirm') as HTMLElement
}
function button(text: RegExp) {
  return Array.from(map.querySelectorAll('button')).find((b) => text.test(b.textContent ?? '')) as HTMLButtonElement
}

beforeEach(() => {
  document.body.innerHTML = ''
  onSelect = vi.fn()
  map = buildBodyMap(document, caseTypes, onSelect) as HTMLElement
  document.body.appendChild(map)
})

describe('partitionCaseTypes', () => {
  it('pairs tagged case types with their spot and keeps the rest', () => {
    const { placed, unplaced } = partitionCaseTypes(caseTypes)
    expect(placed.map((p: { spot: { tag: string } }) => p.spot.tag)).toEqual(['knee', 'neck'])
    expect(unplaced.map((c: CaseType) => c.id)).toEqual(['general'])
  })

  it('treats a tag this widget build does not know as no spot, not as missing', () => {
    const { placed, unplaced } = partitionCaseTypes([{ id: 'x', name: 'Jaw', map_tag: 'jaw' }])
    expect(placed).toEqual([])
    expect(unplaced.map((c: CaseType) => c.id)).toEqual(['x'])
  })
})

describe('label layout', () => {
  it('places a label for every spot', () => {
    expect(Object.keys(LABELS).sort()).toEqual([...BODY_MAP_TAGS].sort())
  })

  it('hides spots while zoomed with visibility, never display', () => {
    // Toggling display on the other spots left Chrome not painting the chosen
    // spot's pulse after zooming back out.
    const css = bodyMapStyles('#000')
    expect(css).toContain('.pm-bodymap-zoomed .pm-bodymap-spot{visibility:hidden;}')
    expect(css).not.toMatch(/pm-bodymap-zoomed [^{]*spot[^{]*\{display:/)
  })
})

describe('buildBodyMap', () => {
  it('returns null when no case type has a spot, so the widget keeps its list', () => {
    expect(buildBodyMap(document, [{ id: 'a', name: 'A', map_tag: null }], onSelect)).toBeNull()
    expect(buildBodyMap(document, [], onSelect)).toBeNull()
  })

  it('draws one spot per linked case type, labelled with the case type name', () => {
    const spots = map.querySelectorAll('.pm-bodymap-spot')
    expect(spots).toHaveLength(2)
    expect(spot('knee').getAttribute('aria-label')).toBe('Knee')
    expect(spot('knee').getAttribute('role')).toBe('button')
    expect(callout('knee').textContent).toBe('Knee')
  })

  it('opens the zoom from a tap on the label or its leader line, not only the dot', () => {
    callout('neck').querySelector('.pm-bodymap-label')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(map.querySelector('.pm-bodymap-heading')!.textContent).toBe('Neck Pain')
    button(/Back/).click()

    callout('knee').querySelector('.pm-bodymap-leader-hit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(map.querySelector('.pm-bodymap-heading')!.textContent).toBe('Knee')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('highlights the dot and its label together, whichever one is hovered', () => {
    const lit = () => [
      spot('knee').classList.contains('pm-bodymap-spot-hover'),
      callout('knee').classList.contains('pm-bodymap-callout-hover'),
    ]

    spot('knee').dispatchEvent(new MouseEvent('mouseenter'))
    expect(lit()).toEqual([true, true])
    spot('knee').dispatchEvent(new MouseEvent('mouseleave'))
    expect(lit()).toEqual([false, false])

    callout('knee').dispatchEvent(new MouseEvent('mouseenter'))
    expect(lit()).toEqual([true, true])
    callout('knee').dispatchEvent(new MouseEvent('mouseleave'))
    expect(lit()).toEqual([false, false])

    // Only the hovered spot lights up.
    spot('knee').dispatchEvent(new MouseEvent('mouseenter'))
    expect(callout('neck').classList.contains('pm-bodymap-callout-hover')).toBe(false)
  })

  it('keeps labels under the dots, so a dot wins a tap that also hits a neighbouring label', () => {
    const svg = map.querySelector('svg')!
    const layers = Array.from(svg.children).map((el) => el.getAttribute('class'))
    expect(layers.indexOf('pm-bodymap-labels')).toBeLessThan(layers.indexOf('pm-bodymap-dots'))
    // Labels are decoration for screen readers; the dots carry the names.
    expect(map.querySelector('.pm-bodymap-labels')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('splits a label across lines where its gap is narrow', () => {
    const shin = buildBodyMap(document, [{ id: 's', name: 'Shin Splints', map_tag: 'shin-splints' }], onSelect)!
    const lines = Array.from(shin.querySelectorAll('.pm-bodymap-label tspan')).map((t) => t.textContent)
    expect(lines).toEqual(['Shin', 'Splints'])
  })

  it('lists case types without a spot as plain buttons that select directly', () => {
    const other = button(/General Orthopedics/)
    other.click()
    expect(onSelect).toHaveBeenCalledWith(caseTypes[2])
  })

  it('zooms in and asks to confirm instead of selecting on tap', () => {
    expect(confirmPanel().hidden).toBe(true)

    spot('knee').dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onSelect).not.toHaveBeenCalled()
    expect(map.classList.contains('pm-bodymap-zoomed')).toBe(true)
    expect(confirmPanel().hidden).toBe(false)
    expect(map.querySelector('.pm-bodymap-heading')!.textContent).toBe('Knee')
    expect((map.querySelector('.pm-bodymap-zoom') as HTMLElement).style.transform).toContain('scale(')
  })

  it('selects the case type on Continue', () => {
    spot('neck').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button(/Continue/).click()
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(caseTypes[1])
  })

  it('returns to the full map on Back without selecting anything', () => {
    spot('knee').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button(/Back/).click()

    expect(onSelect).not.toHaveBeenCalled()
    expect(map.classList.contains('pm-bodymap-zoomed')).toBe(false)
    expect(confirmPanel().hidden).toBe(true)
    expect((map.querySelector('.pm-bodymap-zoom') as HTMLElement).style.transform).toBe('')
  })

  it('keeps Back and Continue inside the figure, so zooming never moves the list under a finger', () => {
    const stage = map.querySelector('.pm-bodymap-stage')!
    expect(stage.contains(button(/Back/))).toBe(true)
    expect(stage.contains(button(/Continue/))).toBe(true)
  })

  it('ignores taps on other spots while zoomed', () => {
    spot('knee').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    spot('neck').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button(/Continue/).click()
    expect(onSelect).toHaveBeenCalledWith(caseTypes[0])
  })

  it('works from the keyboard', () => {
    expect(spot('knee').getAttribute('tabindex')).toBe('0')
    spot('knee').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(map.classList.contains('pm-bodymap-zoomed')).toBe(true)
    // Spots leave the tab order while zoomed, and come back on Back.
    expect(spot('neck').getAttribute('tabindex')).toBe('-1')
    button(/Back/).click()
    expect(spot('neck').getAttribute('tabindex')).toBe('0')
  })
})
