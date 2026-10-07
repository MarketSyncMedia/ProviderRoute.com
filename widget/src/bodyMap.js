import { BODY_MAP_SPOTS } from '../../src/shared/bodyMap'
import { OUTLINE_PATH, OUTLINE_SIZE, VIEW_FRAMES } from './bodyOutline'

/**
 * The clickable body map shown in place of the case type list when the org has
 * linked case types to spots (case_types.map_tag).
 *
 * Tapping a spot zooms in on it and asks to confirm; Continue hands the case
 * type to `onSelect`, which is the same path a list button takes, so matching
 * and analytics do not change. Case types with no spot are listed as plain
 * buttons under the map, so nothing becomes unreachable.
 *
 * Kept out of widget.js so it can be tested on its own (tests/unit/widgetBodyMap.test.ts).
 */

var SVG_NS = 'http://www.w3.org/2000/svg'

/** How far the figure zooms in on a tapped spot. */
var ZOOM = 2.6

/** The drawing area: the outline plus a margin on each side for labels. */
var VIEWBOX = { x: -40, y: 0, width: 1334, height: OUTLINE_SIZE }

/** Label text size, in outline units (about 12-13px at the widget's width). */
var LABEL_SIZE = 46

/**
 * Where each label sits, in outline coordinates, placed by hand in the white
 * space around the figures -- beside the head, between the arms, beside and
 * below the legs -- so the text can be large without covering the body or
 * another label. A leader line joins each label to its dot. `lines` splits a
 * label that is too wide for its gap.
 *
 * The text shown is the spot's label, not the case type's name, because these
 * slots are sized for it; the case type's name is what the zoomed view and
 * screen readers announce.
 */
export var LABELS = {
  shoulder: { x: 205, y: 190, anchor: 'end' },
  clavicle: { x: 470, y: 190, anchor: 'start' },
  elbow: { x: 140, y: 440, anchor: 'end' },
  pelvis: { x: 140, y: 575, anchor: 'end' },
  hand: { x: 120, y: 810, anchor: 'middle' },
  wrist: { x: 610, y: 615, anchor: 'start' },
  hip: { x: 560, y: 480, anchor: 'start' },
  groin: { x: 425, y: 710, anchor: 'start' },
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
 * The label's approximate box. Text is not measured (the map is built before
 * it is in the page), so width comes from character count; the box only
 * decides where the leader line starts and how big the tap target is.
 */
function labelBox(layout, lines) {
  var longest = lines.reduce(function (n, line) {
    return Math.max(n, line.length)
  }, 0)
  var width = longest * LABEL_SIZE * 0.56
  var height = lines.length * LABEL_SIZE * 1.05
  var left =
    layout.anchor === 'end' ? layout.x - width : layout.anchor === 'middle' ? layout.x - width / 2 : layout.x
  return { left: left, top: layout.y - LABEL_SIZE * 0.8, width: width, height: height }
}

/** The point on a box nearest to p, pushed out by a small gap. */
function nearestEdge(box, p) {
  var gap = 8
  return {
    x: Math.max(box.left - gap, Math.min(p.x, box.left + box.width + gap)),
    y: Math.max(box.top - gap, Math.min(p.y, box.top + box.height + gap)),
  }
}

function svgEl(doc, name, attrs) {
  var el = doc.createElementNS(SVG_NS, name)
  for (var key in attrs) el.setAttribute(key, String(attrs[key]))
  return el
}

/** A spot's centre in outline coordinates. */
function spotPoint(spot) {
  var frame = VIEW_FRAMES[spot.view]
  return {
    x: frame.x + (spot.x / 100) * frame.width,
    y: frame.y + (spot.y / 100) * frame.height,
  }
}

/**
 * The case types that have a spot, paired with it, and the ones that do not.
 * A tag the widget does not know (a spot added to the database before this
 * widget build) is treated as no spot rather than dropped.
 */
export function partitionCaseTypes(caseTypes) {
  var placed = []
  var unplaced = []
  ;(caseTypes || []).forEach(function (ct) {
    var spot = ct.map_tag
      ? BODY_MAP_SPOTS.find(function (s) {
          return s.tag === ct.map_tag
        })
      : null
    if (spot) placed.push({ caseType: ct, spot: spot })
    else unplaced.push(ct)
  })
  return { placed: placed, unplaced: unplaced }
}

/** A spot's label and the leader line from it to the dot. */
function buildCallout(doc, spot, p) {
  var layout = LABELS[spot.tag] || { x: p.x + 40, y: p.y + 14, anchor: 'start' }
  var lines = layout.lines || [spot.label]
  var box = labelBox(layout, lines)
  var from = nearestEdge(box, p)

  var g = svgEl(doc, 'g', { class: 'pm-bodymap-callout', 'data-tag': spot.tag })
  // Wide invisible copies of the line and the label's box are the tap targets.
  g.appendChild(svgEl(doc, 'line', { x1: from.x, y1: from.y, x2: p.x, y2: p.y, class: 'pm-bodymap-leader-hit' }))
  g.appendChild(
    svgEl(doc, 'rect', {
      x: box.left - 10,
      y: box.top - 10,
      width: box.width + 20,
      height: box.height + 20,
      class: 'pm-bodymap-label-hit',
    }),
  )
  g.appendChild(svgEl(doc, 'line', { x1: from.x, y1: from.y, x2: p.x, y2: p.y, class: 'pm-bodymap-leader' }))
  var text = svgEl(doc, 'text', { class: 'pm-bodymap-label', x: layout.x, y: layout.y, 'text-anchor': layout.anchor })
  lines.forEach(function (line, i) {
    var tspan = svgEl(doc, 'tspan', { x: layout.x, dy: i === 0 ? 0 : LABEL_SIZE * 1.05 })
    tspan.textContent = line
    text.appendChild(tspan)
  })
  g.appendChild(text)
  return g
}

/**
 * Builds the map, or returns null when no case type has a spot -- the widget
 * then renders its plain list exactly as before.
 *
 * @param {Document} doc
 * @param {Array<{id: string, name: string, map_tag?: string | null}>} caseTypes
 * @param {(caseType: object) => void} onSelect
 * @returns {HTMLElement | null}
 */
export function buildBodyMap(doc, caseTypes, onSelect) {
  var parts = partitionCaseTypes(caseTypes)
  if (parts.placed.length === 0) return null

  var root = doc.createElement('div')
  root.className = 'pm-bodymap'

  var stage = doc.createElement('div')
  stage.className = 'pm-bodymap-stage'
  root.appendChild(stage)

  var zoomer = doc.createElement('div')
  zoomer.className = 'pm-bodymap-zoom'
  stage.appendChild(zoomer)

  var svg = svgEl(doc, 'svg', {
    viewBox: [VIEWBOX.x, VIEWBOX.y, VIEWBOX.width, VIEWBOX.height].join(' '),
    class: 'pm-bodymap-svg',
    role: 'group',
    'aria-label': 'Choose where it hurts',
  })
  svg.appendChild(svgEl(doc, 'path', { d: OUTLINE_PATH, class: 'pm-bodymap-outline', 'fill-rule': 'evenodd' }))
  zoomer.appendChild(svg)

  // Shown while zoomed, laid over the figure: the spot's name on top, Back /
  // Continue at the bottom. Overlaying rather than stacking below keeps the
  // layout still, so nothing slides under a finger when the map zooms -- a
  // double-tap on Back must not land on a case type that moved into its place.
  var confirm = doc.createElement('div')
  confirm.className = 'pm-bodymap-confirm'
  confirm.hidden = true
  var heading = doc.createElement('div')
  heading.className = 'pm-bodymap-heading'
  heading.setAttribute('aria-live', 'polite')
  var actions = doc.createElement('div')
  actions.className = 'pm-bodymap-actions'
  var backBtn = doc.createElement('button')
  backBtn.type = 'button'
  backBtn.className = 'pm-bodymap-back'
  backBtn.textContent = '← Back'
  var continueBtn = doc.createElement('button')
  continueBtn.type = 'button'
  continueBtn.className = 'pm-next-btn pm-bodymap-continue'
  continueBtn.textContent = 'Continue →'
  actions.appendChild(backBtn)
  actions.appendChild(continueBtn)
  confirm.appendChild(heading)
  confirm.appendChild(actions)
  stage.appendChild(confirm)

  var chosen = null
  var spotEls = []

  function zoomTo(entry, spotEl) {
    chosen = entry
    var p = spotPoint(entry.spot)
    // Scale about the spot and move it to the centre of the stage.
    var cx = ((p.x - VIEWBOX.x) / VIEWBOX.width) * 100
    var cy = ((p.y - VIEWBOX.y) / VIEWBOX.height) * 100
    zoomer.style.transformOrigin = cx + '% ' + cy + '%'
    zoomer.style.transform =
      'translate(' + (50 - cx) + '%, ' + (50 - cy) + '%) scale(' + ZOOM + ')'
    root.classList.add('pm-bodymap-zoomed')
    spotEls.forEach(function (el) {
      el.classList.toggle('pm-bodymap-spot-active', el === spotEl)
      el.setAttribute('tabindex', '-1')
    })
    heading.textContent = entry.caseType.name
    confirm.hidden = false
    continueBtn.focus()
  }

  function zoomOut() {
    var previous = chosen
    chosen = null
    zoomer.style.transform = ''
    root.classList.remove('pm-bodymap-zoomed')
    confirm.hidden = true
    var refocus = null
    spotEls.forEach(function (el) {
      el.classList.remove('pm-bodymap-spot-active')
      el.setAttribute('tabindex', '0')
      if (previous && el.getAttribute('data-case-type-id') === previous.caseType.id) refocus = el
    })
    if (refocus && refocus.focus) refocus.focus()
  }

  backBtn.onclick = zoomOut
  continueBtn.onclick = function () {
    if (chosen) onSelect(chosen.caseType)
  }

  // Labels and their lines go in a layer under the dots, so where a line or
  // label's tap area crosses a neighbouring dot, the dot wins.
  var labelLayer = svgEl(doc, 'g', { class: 'pm-bodymap-labels', 'aria-hidden': 'true' })
  var dotLayer = svgEl(doc, 'g', { class: 'pm-bodymap-dots' })
  svg.appendChild(labelLayer)
  svg.appendChild(dotLayer)

  parts.placed.forEach(function (entry) {
    var p = spotPoint(entry.spot)
    var g = svgEl(doc, 'g', {
      class: 'pm-bodymap-spot',
      role: 'button',
      tabindex: 0,
      'aria-label': entry.caseType.name,
      'data-tag': entry.spot.tag,
      'data-case-type-id': entry.caseType.id,
    })
    // A generous invisible target: the visible dot is small, fingers are not.
    g.appendChild(svgEl(doc, 'circle', { cx: p.x, cy: p.y, r: 62, class: 'pm-bodymap-hit' }))
    g.appendChild(svgEl(doc, 'circle', { cx: p.x, cy: p.y, r: 46, class: 'pm-bodymap-glow' }))
    g.appendChild(svgEl(doc, 'circle', { cx: p.x, cy: p.y, r: 24, class: 'pm-bodymap-dot' }))

    var callout = buildCallout(doc, entry.spot, p)
    labelLayer.appendChild(callout)

    function open() {
      if (chosen) return
      zoomTo(entry, g)
    }
    // The label and its line open the spot too, so a tap that misses the dot
    // but lands on its name or line still works.
    g.addEventListener('click', open)
    callout.addEventListener('click', open)
    callout.addEventListener('mouseenter', function () {
      g.classList.add('pm-bodymap-spot-hover')
    })
    callout.addEventListener('mouseleave', function () {
      g.classList.remove('pm-bodymap-spot-hover')
    })
    g.addEventListener('keydown', function (e) {
      if (chosen) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        zoomTo(entry, g)
      }
    })
    spotEls.push(g)
    dotLayer.appendChild(g)
  })

  if (parts.unplaced.length > 0) {
    var other = doc.createElement('div')
    other.className = 'pm-bodymap-other'
    var title = doc.createElement('div')
    title.className = 'pm-section-title'
    title.textContent = 'Something else?'
    other.appendChild(title)
    var list = doc.createElement('div')
    list.className = 'pm-options'
    parts.unplaced.forEach(function (ct) {
      var btn = doc.createElement('button')
      btn.type = 'button'
      btn.className = 'pm-option'
      btn.textContent = ct.name
      btn.onclick = function () {
        onSelect(ct)
      }
      list.appendChild(btn)
    })
    other.appendChild(list)
    root.appendChild(other)
  }

  return root
}

/** Styles for the map, appended to the widget's stylesheet. */
export function bodyMapStyles(primaryColor) {
  return [
    '.pm-bodymap{display:flex;flex-direction:column;gap:10px;}',
    '.pm-bodymap-stage{position:relative;overflow:hidden;border-radius:12px;background:radial-gradient(circle at 50% 45%,#fff5f5 0%,#fff 70%);}',
    '.pm-bodymap-zoom{transition:transform 0.45s ease;will-change:transform;}',
    '.pm-bodymap-svg{display:block;width:100%;height:auto;overflow:visible;}',
    '.pm-bodymap-outline{fill:#5b4f54;}',
    '.pm-bodymap-spot{cursor:pointer;outline:none;}',
    '.pm-bodymap-hit{fill:transparent;}',
    '.pm-bodymap-glow{fill:#c00000;opacity:0.18;transform-box:fill-box;transform-origin:center;animation:pm-bodymap-pulse 2.2s ease-in-out infinite;}',
    '.pm-bodymap-dot{fill:#c00000;stroke:#fff;stroke-width:5;}',
    '.pm-bodymap-callout{cursor:pointer;}',
    '.pm-bodymap-label{font-size:' + LABEL_SIZE + 'px;font-weight:600;fill:#1e293b;paint-order:stroke;stroke:#fff;stroke-width:9px;stroke-linejoin:round;}',
    '.pm-bodymap-leader{stroke:#94a3b8;stroke-width:3;}',
    '.pm-bodymap-leader-hit{stroke:transparent;stroke-width:36;}',
    '.pm-bodymap-label-hit{fill:transparent;}',
    '.pm-bodymap-callout:hover .pm-bodymap-label{fill:#c00000;}',
    '.pm-bodymap-callout:hover .pm-bodymap-leader{stroke:#c00000;}',
    '.pm-bodymap-spot:hover .pm-bodymap-glow,.pm-bodymap-spot-hover .pm-bodymap-glow,.pm-bodymap-spot:focus-visible .pm-bodymap-glow{opacity:0.4;}',
    '.pm-bodymap-spot:focus-visible .pm-bodymap-dot{stroke:' + primaryColor + ';stroke-width:9;}',
    '@keyframes pm-bodymap-pulse{0%,100%{transform:scale(0.85);}50%{transform:scale(1.15);}}',
    // Zoomed: only the chosen spot stays; its label moves to the heading.
    // Hidden with visibility, not display: taking the other spots out of the
    // render tree and back left Chrome no longer painting the chosen spot's
    // pulse after zooming out.
    '.pm-bodymap-zoomed .pm-bodymap-spot{visibility:hidden;}',
    '.pm-bodymap-zoomed .pm-bodymap-spot-active{visibility:visible;cursor:default;}',
    '.pm-bodymap-zoomed .pm-bodymap-labels{visibility:hidden;}',
    // Hidden but still taking its space, so zooming never moves it.
    '.pm-bodymap-zoomed .pm-bodymap-other{visibility:hidden;}',
    '.pm-bodymap-confirm{position:absolute;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;justify-content:space-between;padding:12px;pointer-events:none;}',
    '.pm-bodymap-confirm>*{pointer-events:auto;}',
    '.pm-bodymap-confirm[hidden]{display:none;}',
    '.pm-bodymap-heading{align-self:center;font-size:20px;font-weight:700;color:#1e293b;background:rgba(255,255,255,0.88);border-radius:10px;padding:4px 14px;}',
    '.pm-bodymap-actions{display:flex;gap:8px;}',
    '.pm-bodymap-actions button{flex:1;}',
    '.pm-bodymap-back{background:#e2e8f0;color:#334155;border:none;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;}',
    '@media (prefers-reduced-motion:reduce){.pm-bodymap-zoom{transition:none;}.pm-bodymap-glow{animation:none;}}',
  ].join('')
}
