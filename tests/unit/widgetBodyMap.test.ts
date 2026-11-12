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

describe('list view', () => {
  const toggle = () => map.querySelector('.pm-bodymap-toggle') as HTMLButtonElement
  const stage = () => map.querySelector('.pm-bodymap-stage') as HTMLElement
  const list = () => map.querySelector('.pm-bodymap-list') as HTMLElement
  const other = () => map.querySelector('.pm-bodymap-other') as HTMLElement

  it('starts on the diagram, offering to switch to the list', () => {
    expect(toggle().textContent).toBe('Switch to list view')
    expect(stage().hidden).toBe(false)
    expect(list().hidden).toBe(true)
  })

  it('shows every case type as a button, spotted or not, and hides the diagram', () => {
    toggle().click()
    expect(stage().hidden).toBe(true)
    expect(list().hidden).toBe(false)
    expect(other().hidden).toBe(true)
    const names = Array.from(list().querySelectorAll('button')).map((b) => b.textContent)
    expect(names).toEqual(['Knee', 'Neck Pain', 'General Orthopedics'])
  })

  it('selects a case type straight from the list', () => {
    toggle().click()
    ;(list().querySelectorAll('button')[1] as HTMLButtonElement).click()
    expect(onSelect).toHaveBeenCalledWith(caseTypes[1])
  })

  it('flips back to the diagram, as often as they like', () => {
    toggle().click()
    expect(toggle().textContent).toBe('Switch to diagram view')
    toggle().click()
    expect(toggle().textContent).toBe('Switch to list view')
    expect(stage().hidden).toBe(false)
    expect(list().hidden).toBe(true)
    expect(other().hidden).toBe(false)

    toggle().click()
    toggle().click()
    spot('knee').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(map.classList.contains('pm-bodymap-zoomed')).toBe(true)
  })

  it('leaves a zoomed-in spot when switching to the list, so the diagram is fresh on return', () => {
    spot('knee').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    toggle().click()
    expect(map.classList.contains('pm-bodymap-zoomed')).toBe(false)
    expect(confirmPanel().hidden).toBe(true)
    toggle().click()
    expect(map.classList.contains('pm-bodymap-zoomed')).toBe(false)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('can start on the list, and reports each flip so a redraw can keep the choice', () => {
    const onViewChange = vi.fn()
    const redrawn = buildBodyMap(document, caseTypes, onSelect, { listView: true, onViewChange }) as HTMLElement
    const t = redrawn.querySelector('.pm-bodymap-toggle') as HTMLButtonElement
    expect(t.textContent).toBe('Switch to diagram view')
    expect((redrawn.querySelector('.pm-bodymap-stage') as HTMLElement).hidden).toBe(true)

    t.click()
    expect(onViewChange).toHaveBeenLastCalledWith(false)
    t.click()
    expect(onViewChange).toHaveBeenLastCalledWith(true)
  })

  it('keeps hidden parts hidden even though their classes set display', () => {
    expect(bodyMapStyles('#000')).toContain('.pm-bodymap [hidden]{display:none !important;}')
  })
})

describe('Enter key', () => {
  const enter = (target: Element) => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
  }

  it('confirms the zoomed-in spot, like Continue', () => {
    spot('neck').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    enter(button(/Continue/))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(caseTypes[1])
  })

  it('confirms from anywhere in the map while zoomed, not only from the Continue button', () => {
    spot('neck').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    enter(map.querySelector('.pm-bodymap-heading')!)
    expect(onSelect).toHaveBeenCalledWith(caseTypes[1])
  })

  it('does not confirm in the same keystroke that opens a spot', () => {
    enter(spot('knee'))
    expect(map.classList.contains('pm-bodymap-zoomed')).toBe(true)
    expect(onSelect).not.toHaveBeenCalled()
    // The next Enter is the confirmation.
    enter(button(/Continue/))
    expect(onSelect).toHaveBeenCalledWith(caseTypes[0])
  })

  it('leaves Back to go back', () => {
    spot('knee').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    enter(button(/Back/))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('does nothing when no spot is zoomed in on', () => {
    enter(map.querySelector('svg')!)
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('spots the admin placed', () => {
  const placed = {
    id: 'pec',
    name: 'Pectoral',
    map_tag: null,
    map_view: 'front',
    map_x: 45,
    map_y: 27,
    map_label_x: 90,
    map_label_y: 25,
  }
  const withCustom = [...caseTypes, placed]

  it('are placed beside the built-in ones, and no longer listed as buttons', () => {
    const { placed: spots, unplaced } = partitionCaseTypes(withCustom)
    expect(spots.map((s: { spot: { tag: string } }) => s.spot.tag)).toEqual(['knee', 'neck', 'custom-pec'])
    expect(unplaced.map((c: { id: string }) => c.id)).toEqual(['general'])
  })

  it('draw a dot named for the case type and the label the admin chose', () => {
    const custom = buildBodyMap(document, withCustom, onSelect)!
    const dot = custom.querySelector('.pm-bodymap-spot[data-tag="custom-pec"]')!
    expect(dot.getAttribute('aria-label')).toBe('Pectoral')
    const label = custom.querySelector('.pm-bodymap-callout[data-tag="custom-pec"] .pm-bodymap-label')!
    expect(label.textContent).toBe('Pectoral')
    expect(label.getAttribute('text-anchor')).toBe('start')
  })

  it('split a long name over two lines', () => {
    const custom = buildBodyMap(document, [{ ...placed, name: 'Rotator Cuff Tear' }], onSelect)!
    const lines = Array.from(custom.querySelectorAll('.pm-bodymap-label tspan')).map((t) => t.textContent)
    expect(lines).toEqual(['Rotator', 'Cuff Tear'])
  })

  it('still get a label beside the dot when the admin placed none', () => {
    const custom = buildBodyMap(document, [{ ...placed, map_label_x: null, map_label_y: null }], onSelect)!
    expect(custom.querySelector('.pm-bodymap-label')!.textContent).toBe('Pectoral')
  })

  it('make a map out of a case type placed alone', () => {
    expect(buildBodyMap(document, [placed], onSelect)).not.toBeNull()
  })

  it('zoom and select like any other spot', () => {
    const custom = buildBodyMap(document, withCustom, onSelect)!
    document.body.appendChild(custom)
    custom
      .querySelector('.pm-bodymap-spot[data-tag="custom-pec"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(custom.querySelector('.pm-bodymap-heading')!.textContent).toBe('Pectoral')
    const next = Array.from(custom.querySelectorAll('button')).find((b) => /Continue/.test(b.textContent ?? ''))!
    next.click()
    expect(onSelect).toHaveBeenCalledWith(placed)
  })

  it('are listed as buttons, not lost, when the position is incomplete', () => {
    const { placed: spots, unplaced } = partitionCaseTypes([{ ...placed, map_y: null }])
    expect(spots).toEqual([])
    expect(unplaced).toHaveLength(1)
  })
})
