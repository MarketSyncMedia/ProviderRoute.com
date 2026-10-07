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

/**
 * Where each label sits relative to its dot, following the mockup: labels go
 * outward, away from the body, so the cluster around the hips stays legible.
 */
var LABEL_SIDE = {
  shoulder: 'left',
  clavicle: 'right',
  elbow: 'left',
  hand: 'below',
  wrist: 'below',
  pelvis: 'left',
  hip: 'above',
  groin: 'below',
  knee: 'right',
  'shin-splints': 'left',
  ankle: 'right',
  foot: 'left',
  toes: 'right',
  neck: 'right',
  'low-back': 'right',
  achilles: 'right',
  heel: 'left',
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
    viewBox: '0 0 ' + OUTLINE_SIZE + ' ' + OUTLINE_SIZE,
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
    var cx = (p.x / OUTLINE_SIZE) * 100
    var cy = (p.y / OUTLINE_SIZE) * 100
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

    var side = LABEL_SIDE[entry.spot.tag] || 'right'
    var label = svgEl(doc, 'text', {
      class: 'pm-bodymap-label',
      x: side === 'left' ? p.x - 36 : side === 'right' ? p.x + 36 : p.x,
      y: side === 'below' ? p.y + 70 : side === 'above' ? p.y - 44 : p.y + 12,
      'text-anchor': side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle',
      'aria-hidden': 'true',
    })
    label.textContent = entry.caseType.name
    g.appendChild(label)

    g.addEventListener('click', function () {
      if (chosen) return
      zoomTo(entry, g)
    })
    g.addEventListener('keydown', function (e) {
      if (chosen) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        zoomTo(entry, g)
      }
    })
    spotEls.push(g)
    svg.appendChild(g)
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
    '.pm-bodymap-label{font-size:34px;font-weight:600;fill:#1e293b;paint-order:stroke;stroke:#fff;stroke-width:8px;stroke-linejoin:round;pointer-events:none;}',
    '.pm-bodymap-spot:hover .pm-bodymap-glow,.pm-bodymap-spot:focus-visible .pm-bodymap-glow{opacity:0.4;}',
    '.pm-bodymap-spot:focus-visible .pm-bodymap-dot{stroke:' + primaryColor + ';stroke-width:9;}',
    '@keyframes pm-bodymap-pulse{0%,100%{transform:scale(0.85);}50%{transform:scale(1.15);}}',
    // Zoomed: only the chosen spot stays; its label moves to the heading.
    '.pm-bodymap-zoomed .pm-bodymap-spot{display:none;}',
    '.pm-bodymap-zoomed .pm-bodymap-spot-active{display:inline;cursor:default;}',
    '.pm-bodymap-zoomed .pm-bodymap-label{display:none;}',
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
