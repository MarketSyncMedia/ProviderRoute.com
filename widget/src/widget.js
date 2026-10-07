import { AVATAR_COLORS, avatarColorIndex, initialsForName } from '../../src/shared/avatarPalette'
import { readableTextColor } from '../../src/shared/colorContrast'
import { bodyMapStyles, buildBodyMap } from './bodyMap'

;(function () {
  'use strict'

  // Guard against the embed snippet appearing more than once on the same
  // page (a common copy/paste mistake in CMS/theme builders — e.g. once in
  // a global header/footer include and again in a page-specific block).
  // Each <script src="...widget.js"> tag on the page executes this whole
  // IIFE independently, so without this guard a second copy runs
  // injectWidget() again and mounts a second, fully-independent floating
  // button + shadow-DOM widget on top of the first — both pinned to the
  // same bottom:24px;right:24px corner at max z-index, so whichever one
  // renders/updates last visually pops in on top of the other (including
  // on top of an already-open chat modal from the first instance).
  if (window.__pmWidgetBooted) return
  window.__pmWidgetBooted = true

  var supabaseBaseUrl =
    typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : ''

  var supabaseAnonKey =
    typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : ''

  function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      var bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      return Array.from(bytes, function (byte, index) {
        var hex = byte.toString(16).padStart(2, '0')
        return [4, 6, 8, 10].indexOf(index) !== -1 ? '-' + hex : hex
      }).join('')
    }
    return null
  }

  /** Matches LogicTester: range needs min and/or max column populated to count as “has data”. */
  function hasConstraintDataForSkip(offerings, c) {
    if (c.type === 'range') {
      var minK = c.mapped_key
      var maxK = c.secondary_mapped_key
      return offerings.some(function (o) {
        var cons = o.constraints || {}
        var a = cons[minK]
        var b = maxK ? cons[maxK] : undefined
        var hasA = a !== null && a !== undefined && a !== ''
        var hasB = maxK ? b !== null && b !== undefined && b !== '' : false
        return hasA || hasB
      })
    }
    var k = c.mapped_key
    return offerings.some(function (o) {
      var cons = o.constraints || {}
      var v = cons[k]
      return v !== null && v !== undefined && v !== ''
    })
  }

  /** Identical to LogicTester filterBinary */
  function filterBinary(offerings, c, pickedYes) {
    var targetMode = pickedYes ? c.yes_maps_to : c.no_maps_to
    if (targetMode === 'both') {
      return offerings
    }
    return offerings.filter(function (o) {
      var cons = o.constraints || {}
      var v = cons[c.mapped_key]
      if (targetMode === '1') {
        return v === 1 || v === '1' || v === true
      }
      return v === undefined || v === null || v === 0 || v === '0' || v === false
    })
  }

  /** Identical to LogicTester filterRange */
  function filterRange(offerings, c, answer) {
    var minKey = c.mapped_key
    var maxKey = c.secondary_mapped_key || ''
    return offerings.filter(function (o) {
      var cons = o.constraints || {}
      var min = Number(cons[minKey] ?? 0)
      var max = maxKey ? Number(cons[maxKey] ?? 999) : 999
      return min <= answer && answer <= max
    })
  }

  /** Identical to LogicTester filterExact */
  function filterExact(offerings, c, answer) {
    var key = c.mapped_key
    var t = String(answer).trim().toLowerCase()
    return offerings.filter(function (o) {
      var cons = o.constraints || {}
      var v = cons[key]
      return String(v ?? '').toLowerCase() === t
    })
  }

  function getUniqueConstraintValues(offerings, mappedKey) {
    var set = {}
    var out = []
    for (var i = 0; i < offerings.length; i++) {
      var o = offerings[i]
      var cons = o.constraints || {}
      var v = cons[mappedKey]
      if (v !== null && v !== undefined && v !== '') {
        var s = String(v)
        if (!set[s]) {
          set[s] = true
          out.push(s)
        }
      }
    }
    out.sort(function (a, b) {
      return a.localeCompare(b)
    })
    return out
  }

  var widget = {
    widgetId: null,
    data: null,
    shadow: null,
    state: {
      phase: 'questions',
      currentQuestionIndex: 0,
      answers: {},
      activeOfferings: [],
      selectedCaseTypeId: null,
      selectedLocationId: null,
      bypassMode: false,
      bypassResumeIndex: null,
      offeringsBeforeBypass: null,
      offeringsBeforeQuestion: null,
      history: [],
      sessionId: generateUUID(),
      clickOrder: 0,
      resultsPositions: [],
      scrollDepth: null,
    },

    init: function () {
      var scripts = document.querySelectorAll('script[data-widget-id]')
      var script = scripts[scripts.length - 1]
      if (!script) {
        console.warn('ProviderRoute: No script tag with data-widget-id found')
        return
      }
      this.widgetId = script.getAttribute('data-widget-id')
      if (!this.widgetId) {
        console.warn('ProviderRoute: Missing data-widget-id')
        return
      }
      if (!supabaseBaseUrl || !supabaseAnonKey || !this.state.sessionId) {
        console.warn('ProviderRoute: Secure runtime configuration is unavailable')
        return
      }
      var self = this
      this.fetchData().then(function () {
        if (self.data) {
          self.checkDomain()
          if (self.data) {
            self.state.activeOfferings = self.data.offerings || []
            self.injectWidget()
          }
        }
      })
    },

    fetchData: async function () {
      try {
        var response = await fetch(
          supabaseBaseUrl + '/functions/v1/widget-data?id=' + encodeURIComponent(this.widgetId) +
            '&session_id=' + encodeURIComponent(this.state.sessionId),
          // NOTE: send only Authorization (no apikey). The widget-data function's
          // CORS allowlist is "Content-Type, Authorization" — adding apikey makes
          // the browser preflight fail with "Failed to fetch".
          { method: 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + supabaseAnonKey } }
        )
        if (!response.ok) {
          // The server sends a specific, actionable reason in the body (e.g.
          // "Widget privacy configuration is incomplete", "Domain not
          // authorized") -- surface it instead of leaving whoever's debugging
          // to guess from a bare status code and dig through the Network tab.
          var detail = ''
          try {
            var errorBody = await response.json()
            if (errorBody && errorBody.error) detail = ': ' + errorBody.error
          } catch (parseErr) {
            /* body wasn't JSON -- fall back to the bare status */
          }
          throw new Error('HTTP ' + response.status + detail)
        }
        this.data = await response.json()
      } catch (e) {
        console.warn('ProviderRoute: Failed to load widget data', e)
        this.data = null
      }
    },

    checkDomain: function () {
      var domains = (this.data && this.data.config && this.data.config.allowed_domains) || []
      if (!domains.length) {
        console.warn('ProviderRoute: No approved domains are configured')
        this.data = null
        return
      }
      var host = window.location.hostname.toLowerCase()
      var allowed = domains.some(function (d) {
        // Normalize entries so pasted URLs work: strip scheme, path, and port.
        d = String(d || '').trim().toLowerCase()
          .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
          .split('/')[0]
          .split(':')[0]
        if (!d) return false
        return host === d || host.endsWith('.' + d)
      })
      if (!allowed) {
        console.warn('ProviderRoute: Domain not authorized')
        this.data = null
      }
    },

    injectWidget: function () {
      // Belt-and-suspenders: the top-of-file __pmWidgetBooted guard should
      // already prevent a second instance, but if it's ever bypassed (e.g.
      // two different data-widget-id snippets on the same page), refuse to
      // mount a second #pm-widget-host rather than stacking two independent
      // widgets in the same fixed bottom-right corner.
      if (document.getElementById('pm-widget-host')) return
      var config = this.data.config || {}
      var host = document.createElement('div')
      host.setAttribute('id', 'pm-widget-host')
      if (config.embed_mode === 'inline') {
        host.style.cssText = 'position:relative;width:100%;z-index:1;'
      } else {
        host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;'
      }
      this.shadow = host.attachShadow({ mode: 'open' })
      this.injectStyles()
      if (config.embed_mode === 'inline') {
        this.createChatContainer()
        this.trackEvent('widget_opened')
        this.startFlow()
      } else {
        var delaySeconds = config.open_delay_enabled ? Number(config.open_delay_seconds) || 0 : 0
        if (delaySeconds > 0) {
          var self = this
          this._delayTimer = setTimeout(function () {
            self._delayTimer = null
            // The shadow root only goes away if the host page removed us —
            // nothing in this widget ever does, but guard anyway since this
            // fires well after the initial render.
            if (!self.shadow) return
            // A host-page trigger may have opened the chat directly while
            // this timer was still pending — e.g. by reimplementing the
            // open flow instead of calling the public open() API (which
            // cancels this timer). Don't pop the floating button in on top
            // of a chat panel that's already open.
            if (self.shadow.getElementById('pm-chat')) return
            var btn = self.createFloatingButton()
            if (btn) {
              btn.classList.add('pm-btn-enter')
              // pm-btn-enter and the hover animations both set the CSS
              // `animation` shorthand on the same element. Left in place
              // forever, unhovering would fall back to this rule (since
              // :hover stops matching) and replay the fade-in-from-invisible
              // entrance on every single unhover. Drop the class once its
              // one-shot animation is actually done — on natural completion
              // (animationend) or if a hover interrupts it early
              // (animationcancel) — so nothing is left to compete with hover
              // afterward.
              var clearEnter = function () {
                btn.classList.remove('pm-btn-enter')
              }
              btn.addEventListener('animationend', clearEnter, { once: true })
              btn.addEventListener('animationcancel', clearEnter, { once: true })
            }
          }, delaySeconds * 1000)
        } else {
          this.createFloatingButton()
        }
      }
      document.body.appendChild(host)
    },

    injectStyles: function () {
      // Matches WidgetBuilderPage's own default so this fallback (only hit if
      // the server payload is missing primary_color) passes AA contrast too
      // — the old #3B82F6 fallback cleared neither white nor dark text.
      var primaryColor = (this.data.config && this.data.config.primary_color) || '#4F46E5'
      // Text/icon color is derived from the actual configured background
      // rather than hardcoded, so a light/pastel brand color still clears
      // WCAG AA contrast for every surface using the configurable brand color.
      var brandTextColor = readableTextColor(primaryColor)
      var style = document.createElement('style')
      style.textContent = [
        '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}',
        '.pm-btn{display:flex;align-items:center;gap:10px;background:' +
          primaryColor +
          ';color:' +
          brandTextColor +
          ';border:none;border-radius:50px;padding:12px 22px;font-size:15px;font-weight:600;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.2);text-align:left;}',
        '.pm-btn-icon{flex-shrink:0;display:flex;align-items:center;justify-content:center;width:26px;height:26px;font-size:18px;line-height:1;}',
        '.pm-btn-icon img{width:26px;height:26px;border-radius:50%;object-fit:cover;display:block;}',
        '.pm-btn-text{display:flex;flex-direction:column;align-items:center;text-align:center;line-height:1.3;}',
        // No opacity dimming here: opacity blends the text against the
        // button's own background, which would silently cut back below
        // 4.5:1 even after brandTextColor is chosen to clear it exactly.
        // Font-size/weight alone give it a secondary look.
        '.pm-btn-sub{font-size:11px;font-weight:500;margin-top:1px;}',
        // Only transform animates here, never opacity: opacity would fade
        // the button's colors toward the page background mid-animation,
        // so early frames could dip under 4.5:1 even though the resting
        // state (computed above) passes.
        '@keyframes pm-btn-enter{0%{transform:translateY(8px) scale(0.94);}100%{transform:translateY(0) scale(1);}}',
        '.pm-btn-enter{animation:pm-btn-enter 0.35s ease-out;}',
        '@keyframes pm-shake{10%,90%{transform:translateX(-1px);}20%,80%{transform:translateX(2px);}30%,50%,70%{transform:translateX(-3px);}40%,60%{transform:translateX(3px);}}',
        '@keyframes pm-wobble{0%{transform:rotate(0);}15%{transform:rotate(-3deg);}30%{transform:rotate(2.5deg);}45%{transform:rotate(-2deg);}60%{transform:rotate(1.5deg);}75%{transform:rotate(-1deg);}100%{transform:rotate(0);}}',
        '@keyframes pm-pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.04);}}',
        '@keyframes pm-bounce{0%,100%{transform:translateY(0);}30%{transform:translateY(-4px);}50%{transform:translateY(0);}70%{transform:translateY(-2px);}100%{transform:translateY(0);}}',
        '.pm-btn-anim-shake:hover{animation:pm-shake 0.5s ease-in-out;}',
        '.pm-btn-anim-wobble:hover{animation:pm-wobble 0.6s ease-in-out;}',
        '.pm-btn-anim-pulse:hover{animation:pm-pulse 0.8s ease-in-out infinite;}',
        '.pm-btn-anim-bounce:hover{animation:pm-bounce 0.6s ease-in-out;}',
        '.pm-chat{width:380px;max-height:85vh;background:white;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.15);display:flex;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;}',
        '.pm-header{background:' +
          primaryColor +
          ';color:' + brandTextColor + ';padding:16px;display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:15px;}',
        '.pm-close{background:none;border:none;color:' + brandTextColor + ';font-size:22px;cursor:pointer;line-height:1;padding:0;font-family:inherit;}',
        '.pm-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;display:flex;flex-direction:column;gap:10px;}',
        '.pm-bubble{background:#f1f5f9;border-radius:12px 12px 12px 4px;padding:12px 16px;font-size:14px;line-height:1.5;color:#1e293b;max-width:85%;}',
        '.pm-user-bubble{background:' +
          primaryColor +
          ';color:' + brandTextColor + ';border-radius:12px 12px 4px 12px;padding:10px 14px;font-size:14px;align-self:flex-end;max-width:75%;}',
        '.pm-subtext{font-size:12px;color:#64748b;}',
        '.pm-options{display:flex;flex-direction:column;gap:8px;}',
        '.pm-option{background:white;border:2px solid ' +
          primaryColor +
          ';color:' +
          primaryColor +
          ';border-radius:10px;padding:11px 16px;font-size:14px;font-weight:500;cursor:pointer;text-align:left;font-family:inherit;}',
        '.pm-option:hover{background:' + primaryColor + ';color:' + brandTextColor + ';}',
        '.pm-number-wrap{display:flex;gap:8px;}',
        '.pm-number-input{flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:16px;font-family:inherit;}',
        '.pm-number-input:focus{outline:none;border-color:' + primaryColor + ';}',
        '.pm-next-btn{background:' +
          primaryColor +
          ';color:' + brandTextColor + ';border:none;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;}',
        '.pm-back-btn{background:none;border:none;color:#64748b;font-size:13px;cursor:pointer;padding:0;font-family:inherit;text-decoration:underline;align-self:flex-start;}',
        '.pm-select{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:16px;font-family:inherit;background:white;}',
        '.pm-select:focus{outline:none;border-color:' + primaryColor + ';}',
        '.pm-results{display:flex;flex-direction:column;gap:6px;}',
        '.pm-section-title{font-weight:700;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;padding:10px 0 4px;}',
        '.pm-cat-title{font-weight:600;font-size:14px;color:#1e293b;padding:4px 0 2px;}',
        '.pm-card{display:flex;flex-direction:column;background:#f8fafc;border-radius:12px;padding:12px;gap:0;}',
        '.pm-card-outside{background:#fffbeb;border:1px solid #fde68a;}',
        '.pm-outside-badge{display:inline-block;background:#f59e0b;color:#000;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;padding:3px 8px;border-radius:6px;margin-bottom:8px;}',
        '.pm-outside-section{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:8px 10px 2px;margin-top:8px;}',
        '.pm-outside-title{display:flex;align-items:center;gap:6px;font-weight:700;font-size:12px;color:#92400e;text-transform:uppercase;letter-spacing:0.04em;}',
        '.pm-outside-icon{font-size:13px;}',
        '.pm-outside-sub{font-size:12px;color:#92400e;opacity:0.9;padding:4px 0 8px;line-height:1.4;}',
        '.pm-avatar{width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;}',
        '.pm-info{flex:1;min-width:0;}',
        '.pm-name{font-weight:600;font-size:14px;color:#1e293b;}',
        '.pm-sub{font-size:12px;color:#64748b;}',
        '.pm-locs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}',
        '.pm-book{background:' + primaryColor + ';color:' + brandTextColor + ';border:none;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;display:block;width:100%;box-sizing:border-box;text-align:center;font-family:inherit;}',
        '.pm-pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}',
        '.pm-cat-pill{background:#eff6ff;color:#1d4ed8;font-size:11px;padding:3px 10px;border-radius:999px;}',
        '.pm-loc-pill{background:#f1f5f9;color:#64748b;font-size:11px;padding:2px 8px;border-radius:999px;border:0.5px solid #e2e8f0;white-space:nowrap;}',
        '.pm-view-profile{font-size:11px;color:#64748b;text-decoration:none;margin-top:6px;display:inline-block;}',
        '.pm-actions{display:flex;flex-direction:column;gap:6px;flex-shrink:0;width:160px;}',
        '.pm-call{background:transparent;color:' + primaryColor + ';border:2px solid ' + primaryColor + ';border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;display:block;width:100%;box-sizing:border-box;text-align:center;font-family:inherit;}',
        '.pm-slide-panel{display:flex;flex-direction:column;gap:6px;width:160px;}',
        '.pm-slide-label{font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;text-align:center;margin-bottom:2px;}',
        '.pm-back-link{background:transparent;color:#94a3b8;border:none;font-size:10px;cursor:pointer;padding:3px 0;text-align:center;width:100%;font-family:inherit;}',
        '.pm-search{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;margin-bottom:8px;}',
        '.pm-search:focus{outline:none;border-color:' + primaryColor + ';}',
        '.pm-help{font-size:12px;color:' +
          primaryColor +
          ';cursor:pointer;text-decoration:underline;text-align:center;padding:4px;}',
        '.pm-fallback{text-align:center;padding:16px;}',
        '.pm-fb-msg{font-size:14px;color:#475569;margin-bottom:12px;line-height:1.5;}',
        '.pm-fb-phone{font-weight:700;font-size:16px;color:#1e293b;margin-bottom:16px;}',
        '.pm-restart{background:none;border:2px solid ' +
          primaryColor +
          ';color:' +
          primaryColor +
          ';border-radius:10px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;}',
        '.pm-disclaimer{font-size:11px;color:#94a3b8;text-align:center;padding:8px;border-top:1px solid #f1f5f9;margin-top:8px;}',
        '.pm-field-col{display:flex;flex-direction:column;gap:8px;}',
        '@media(max-width:480px){.pm-chat{width:100vw;height:100vh;max-height:100vh;border-radius:0;position:fixed;top:0;left:0;}}',
        bodyMapStyles(primaryColor),
      ].join('')
      this.shadow.appendChild(style)
    },

    createFloatingButton: function () {
      var self = this
      var config = this.data.config || {}
      var btn = document.createElement('button')
      var animation = config.button_animation
      btn.className = animation && animation !== 'none' ? 'pm-btn pm-btn-anim-' + animation : 'pm-btn'

      var iconType = config.button_icon_type
      var iconValue = config.button_icon_value
      if (iconType === 'emoji' && iconValue) {
        var iconEl = document.createElement('span')
        iconEl.className = 'pm-btn-icon'
        iconEl.setAttribute('aria-hidden', 'true')
        // A handful of common symbols (☎ ✈ ✂ etc.) render in plain "text"
        // style by default — a colorless glyph that inherits the button's
        // text color, effectively invisible on a colored button.
        // Appending the emoji variation selector (U+FE0F) forces the color
        // "emoji" presentation. It's a no-op for characters (like 👋) that
        // already always render in color.
        var VS16 = String.fromCharCode(0xfe0f)
        iconEl.textContent = iconValue.slice(-1) === VS16 ? iconValue : iconValue + VS16
        btn.appendChild(iconEl)
      } else if (iconType === 'image' && iconValue) {
        var iconWrap = document.createElement('span')
        iconWrap.className = 'pm-btn-icon'
        var iconImg = document.createElement('img')
        iconImg.src = iconValue
        iconImg.alt = ''
        iconImg.onerror = function () {
          iconWrap.style.display = 'none'
        }
        iconWrap.appendChild(iconImg)
        btn.appendChild(iconWrap)
      }

      var textWrap = document.createElement('span')
      textWrap.className = 'pm-btn-text'
      var titleEl = document.createElement('span')
      titleEl.textContent = config.button_text || 'Find a Provider'
      textWrap.appendChild(titleEl)
      if (config.button_subtext) {
        var subEl = document.createElement('span')
        subEl.className = 'pm-btn-sub'
        subEl.textContent = config.button_subtext
        textWrap.appendChild(subEl)
      }
      btn.appendChild(textWrap)

      btn.onclick = function () {
        btn.remove()
        self.createChatContainer()
        self.trackEvent('widget_opened')
        self.startFlow()
      }
      this.shadow.appendChild(btn)
      return btn
    },

    createChatContainer: function () {
      var self = this
      var config = this.data.config || {}
      var isFloating = config.embed_mode !== 'inline'
      var chat = document.createElement('div')
      chat.className = 'pm-chat'
      chat.id = 'pm-chat'
      if (isFloating) {
        // A floating panel over page content is a dialog, not part of the
        // page's normal reading order — say so, so a screen reader announces
        // it as one instead of silently dropping the user into the middle
        // of unrelated page content.
        chat.setAttribute('role', 'dialog')
        chat.setAttribute('aria-modal', 'true')
        chat.setAttribute('aria-label', config.greeting_text || 'Find a Provider')
        chat.tabIndex = -1
      }
      var header = document.createElement('div')
      header.className = 'pm-header'
      var title = document.createElement('span')
      title.textContent = config.greeting_text || 'Find a Provider'
      header.appendChild(title)
      function closeChat() {
        self.trackEvent('widget_closed')
        chat.remove()
        self.resetState()
        document.body.style.overflow = ''
        self.shadow.host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;'
        var newBtn = self.createFloatingButton()
        // Keyboard/screen-reader users need focus to land somewhere sensible,
        // not silently fall back to <body> because the focused element (the
        // close button, or the panel itself) was just removed from the DOM.
        if (newBtn) newBtn.focus()
      }
      if (isFloating) {
        var closeBtn = document.createElement('button')
        closeBtn.className = 'pm-close'
        closeBtn.innerHTML = '&times;'
        closeBtn.setAttribute('aria-label', 'Close')
        closeBtn.onclick = closeChat
        header.appendChild(closeBtn)
        chat.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') closeChat()
        })
      }
      var body = document.createElement('div')
      body.className = 'pm-body'
      body.id = 'pm-body'
      chat.appendChild(header)
      chat.appendChild(body)
      this.shadow.appendChild(chat)
      document.body.style.overflow = 'hidden';
      if (isFloating) chat.focus()
      var self = this;
      var mq = window.matchMedia('(max-width:480px)');
      function applyHostLayout() {
        if (mq.matches) {
          self.shadow.host.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;';
        } else {
          self.shadow.host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;';
        }
      }
      applyHostLayout();
      mq.addEventListener('change', applyHostLayout);
    },

    resetState: function () {
      var existingSessionId = this.state.sessionId
      this.state = {
        phase: 'questions',
        currentQuestionIndex: 0,
        answers: {},
        activeOfferings: this.data ? this.data.offerings || [] : [],
        selectedCaseTypeId: null,
        selectedLocationId: null,
        bypassMode: false,
        bypassResumeIndex: null,
        offeringsBeforeBypass: null,
        history: [],
        sessionId: existingSessionId,
        clickOrder: 0,
        resultsPositions: [],
        scrollDepth: null,
      }
      if (this._scrollObserver) {
        this._scrollObserver.disconnect()
        this._scrollObserver = null
      }
    },

    addBubble: function (text, isUser) {
      var body = this.shadow.getElementById('pm-body')
      if (!body) return
      var bubble = document.createElement('div')
      bubble.className = isUser ? 'pm-user-bubble' : 'pm-bubble'
      bubble.textContent = text
      body.appendChild(bubble)
      body.scrollTop = body.scrollHeight
    },

    appendPrivacyNotice: function (container) {
      var config = (this.data && this.data.config) || {}
      if (!config.disclaimer_text || !config.privacy_url) return
      // startFlow() can short-circuit straight into showResults() (a widget
      // with zero configured questions), which appends its own notice into
      // `results` before that gets attached to `body` -- guard so the two
      // call sites can never stack a duplicate onto the same screen.
      if (container.querySelector('.pm-disclaimer')) return
      var disc = document.createElement('div')
      disc.className = 'pm-disclaimer'
      var discText = document.createElement('span')
      discText.textContent = config.disclaimer_text + ' '
      disc.appendChild(discText)
      var privacyLink = document.createElement('a')
      privacyLink.href = config.privacy_url
      privacyLink.target = '_blank'
      privacyLink.rel = 'noopener noreferrer'
      privacyLink.textContent = 'Privacy notice'
      disc.appendChild(privacyLink)
      container.appendChild(disc)
    },

    startFlow: function () {
      var body = this.shadow.getElementById('pm-body')
      if (body) body.innerHTML = ''
      this.state.phase = 'questions'
      this.state.currentQuestionIndex = 0
      this.state.bypassMode = false
      this.state.bypassResumeIndex = null
      this.state.offeringsBeforeBypass = null
      this.state.clickOrder = 0
      this.state.resultsPositions = []
      this.state.scrollDepth = null
      if (this._scrollObserver) {
        this._scrollObserver.disconnect()
        this._scrollObserver = null
      }
      this.renderQuestion()
      // Runs after renderQuestion, not before: appendPrivacyNotice's own CSS
      // (.pm-disclaimer: 11px, gray, border-top) is a footer note, not a
      // blocking intro -- it was rendering first and pushing the actual
      // question below the fold, backwards from what its styling intends.
      if (body) this.appendPrivacyNotice(body)
    },

    getQuestionSequence: function () {
      var all = this.data.questions || []
      if (!all.length) return []
      var entries = all.filter(function (q) {
        return q.question_type === 'entry'
      })
      var sortedEntries = entries.slice().sort(function (a, b) {
        return a.order_rank - b.order_rank
      })
      var entry = sortedEntries[0]
      var nonEntry = all
        .filter(function (q) {
          return q.question_type !== 'entry'
        })
        .sort(function (a, b) {
          return a.order_rank - b.order_rank
        })
      return entry ? [entry].concat(nonEntry) : nonEntry
    },

    findConstraint: function (id) {
      return (
        (this.data.constraints || []).find(function (c) {
          return c.id === id
        }) || null
      )
    },

    renderQuestion: function () {
      var questions = this.getQuestionSequence()
      var index = this.state.currentQuestionIndex
      if (index >= questions.length) {
        this.showResults()
        return
      }
      var q = questions[index]
      // Snapshot the offerings as they stand BEFORE this question filters them.
      // goBack restores this so re-answering a question (via Back) re-filters from
      // the correct base instead of stacking a second filter on an already-narrowed
      // set — which previously dropped valid providers (e.g. age 17 then 68 → 4 of 8).
      this.state.offeringsBeforeQuestion = this.state.activeOfferings.slice()
      if (q.question_type === 'clinical' && q.constraint_id) {
        var constraint = this.findConstraint(q.constraint_id)
        if (constraint) {
          var hasData = hasConstraintDataForSkip(this.state.activeOfferings, constraint)
          if (!hasData) {
            this.state.currentQuestionIndex++
            this.renderQuestion()
            return
          }
        }
      }
      var body = this.shadow.getElementById('pm-body')
      if (!body) return
      if (this.state.history.length > 0) {
        var self = this
        var backBtn = document.createElement('button')
        backBtn.className = 'pm-back-btn'
        backBtn.textContent = '← Back'
        backBtn.onclick = function () {
          self.goBack()
        }
        body.appendChild(backBtn)
      }
      this.addBubble(q.question_text, false)
      if (q.subtext) {
        var sub = document.createElement('div')
        sub.className = 'pm-subtext'
        sub.textContent = q.subtext
        body.appendChild(sub)
        body.scrollTop = body.scrollHeight
      }
      if (q.question_type === 'entry') {
        this.renderCaseTypes(q)
        body.scrollTop = 0
      } else if (q.question_type === 'location') this.renderLocationSelect(q)
      else if (q.question_type === 'provider') this.renderProviderChoice(q)
      else if (q.question_type === 'clinical') {
        var c = this.findConstraint(q.constraint_id)
        if (!c) {
          this.state.currentQuestionIndex++
          this.renderQuestion()
          return
        }
        if (c.type === 'binary') this.renderBinary(q, c)
        else if (c.type === 'range') this.renderRange(q, c)
        else this.renderExact(q, c)
      }
      if (!q.required && q.question_type === 'clinical') {
        var self2 = this
        var skipBtn = document.createElement('button')
        skipBtn.className = 'pm-back-btn'
        skipBtn.style.marginTop = '4px'
        skipBtn.textContent = 'Skip this question'
        skipBtn.onclick = function () {
          self2.handleAnswer(q, null, 'Skipped')
        }
        body.appendChild(skipBtn)
      }
      if (q.question_type !== 'entry') {
        body.scrollTop = body.scrollHeight
      }
    },

    renderCaseTypes: function (q) {
      var self = this
      var caseTypes = this.data.caseTypes || []
      // The one path for choosing a case type, whether from the body map or
      // the list, so both filter and track identically.
      function select(ct) {
        self.state.selectedCaseTypeId = ct.id
        self.state.activeOfferings = (self.data.offerings || []).filter(function (o) {
          return o.case_type_id === ct.id
        })
        self.trackEvent('case_type_selected', null, null, ct.id)
        self.handleAnswer(q, ct.id, ct.name)
      }
      var body = this.shadow.getElementById('pm-body')
      // Orgs that linked case types to body map spots get the map; everyone
      // else gets the list exactly as before.
      var map = buildBodyMap(document, caseTypes, select)
      if (map) {
        if (body) body.appendChild(map)
        return
      }
      var opts = document.createElement('div')
      opts.className = 'pm-options'
      caseTypes.forEach(function (ct) {
        var btn = document.createElement('button')
        btn.className = 'pm-option'
        btn.textContent = ct.name
        btn.onclick = function () {
          select(ct)
        }
        opts.appendChild(btn)
      })
      if (body) body.appendChild(opts)
    },

    renderLocationSelect: function (q) {
      var self = this
      var cfg = q.system_config || {}
      var locs = this.data.locations || []
      if (cfg.scope === 'specific' && cfg.location_ids && cfg.location_ids.length) {
        locs = locs.filter(function (l) {
          return cfg.location_ids.indexOf(l.id) > -1
        })
      }
      var wrap = document.createElement('div')
      wrap.className = 'pm-field-col'
      var sel = document.createElement('select')
      sel.className = 'pm-select'
      sel.setAttribute('aria-label', q.question_text || 'Select a location')
      sel.innerHTML = '<option value="">Select a location...</option>'
      var noPreferenceOpt = document.createElement('option')
      noPreferenceOpt.value = 'no-preference'
      noPreferenceOpt.textContent = 'No preference'
      sel.appendChild(noPreferenceOpt)
      locs.forEach(function (l) {
        var opt = document.createElement('option')
        opt.value = l.id
        opt.textContent = l.name
        sel.appendChild(opt)
      })
      var btn = document.createElement('button')
      btn.className = 'pm-next-btn'
      btn.textContent = 'Next'
      btn.onclick = function () {
        if (!sel.value) return
        if (sel.value === 'no-preference') {
          self.handleAnswer(q, null, 'No preference')
          return
        }
        var loc = locs.find(function (l) {
          return l.id === sel.value
        })
        self.handleAnswer(q, sel.value, loc ? loc.name : sel.value)
      }
      wrap.appendChild(sel)
      wrap.appendChild(btn)
      var body = this.shadow.getElementById('pm-body')
      if (body) body.appendChild(wrap)
    },

    renderProviderChoice: function (q) {
      var self = this
      var opts = document.createElement('div')
      opts.className = 'pm-options'
      ;['Yes', 'No'].forEach(function (label) {
        var btn = document.createElement('button')
        btn.className = 'pm-option'
        btn.textContent = label
        btn.onclick = function () {
          if (label === 'Yes') {
            self.state.bypassMode = true
            self.state.offeringsBeforeBypass = self.state.activeOfferings.slice()
            self.state.bypassResumeIndex = self.state.currentQuestionIndex + 1
          }
          self.handleAnswer(q, label.toLowerCase(), label)
        }
        opts.appendChild(btn)
      })
      var body = this.shadow.getElementById('pm-body')
      if (body) body.appendChild(opts)
    },

    renderBinary: function (q, constraint) {
      var self = this
      var opts = document.createElement('div')
      opts.className = 'pm-options'
      ;[
        { label: constraint.yes_label || 'Yes', key: 'yes' },
        { label: constraint.no_label || 'No', key: 'no' },
      ].forEach(function (item) {
        var btn = document.createElement('button')
        btn.className = 'pm-option'
        btn.textContent = item.label
        btn.onclick = function () {
          var pickedYes = item.key === 'yes'
          self.state.activeOfferings = filterBinary(
            self.state.activeOfferings,
            constraint,
            pickedYes
          )
          self.handleAnswer(q, item.key, item.label)
        }
        opts.appendChild(btn)
      })
      var body = this.shadow.getElementById('pm-body')
      if (body) body.appendChild(opts)
    },

    renderRange: function (q, constraint) {
      var self = this
      var wrap = document.createElement('div')
      wrap.className = 'pm-number-wrap'
      var inp = document.createElement('input')
      inp.type = 'number'
      inp.className = 'pm-number-input'
      inp.min = constraint.min_allowed_value || 0
      inp.max = constraint.max_allowed_value || 999
      inp.placeholder = 'Enter number'
      // Placeholder text disappears on input and isn't a reliable accessible
      // name — the question itself (already shown as a chat bubble above)
      // is the real label for a screen reader.
      inp.setAttribute('aria-label', q.question_text || 'Enter number')
      var btn = document.createElement('button')
      btn.className = 'pm-next-btn'
      btn.textContent = 'Next'
      btn.onclick = function () {
        var val = Number(inp.value)
        if (isNaN(val)) return
        self.state.activeOfferings = filterRange(self.state.activeOfferings, constraint, val)
        self.handleAnswer(q, val, String(val))
      }
      wrap.appendChild(inp)
      wrap.appendChild(btn)
      var body = this.shadow.getElementById('pm-body')
      if (body) body.appendChild(wrap)
    },

    renderExact: function (q, constraint) {
      var self = this
      var values = getUniqueConstraintValues(this.state.activeOfferings, constraint.mapped_key)
      if (q.input_type === 'dropdown') {
        var wrap = document.createElement('div')
        wrap.className = 'pm-field-col'
        if (values.length === 0) {
          var inp = document.createElement('input')
          inp.type = 'text'
          inp.className = 'pm-number-input'
          inp.placeholder = 'Answer'
          inp.setAttribute('aria-label', q.question_text || 'Answer')
          var btn = document.createElement('button')
          btn.className = 'pm-next-btn'
          btn.textContent = 'Next'
          btn.onclick = function () {
            var t = (inp.value || '').trim()
            if (!t) return
            self.state.activeOfferings = filterExact(self.state.activeOfferings, constraint, t)
            self.handleAnswer(q, t, t)
          }
          wrap.appendChild(inp)
          wrap.appendChild(btn)
        } else {
          var sel = document.createElement('select')
          sel.className = 'pm-select'
          sel.setAttribute('aria-label', q.question_text || 'Select an answer')
          sel.innerHTML = '<option value="">Select...</option>'
          values.forEach(function (v) {
            var opt = document.createElement('option')
            opt.value = v
            opt.textContent = v
            sel.appendChild(opt)
          })
          var btn2 = document.createElement('button')
          btn2.className = 'pm-next-btn'
          btn2.textContent = 'Next'
          btn2.onclick = function () {
            if (!sel.value) return
            self.state.activeOfferings = filterExact(
              self.state.activeOfferings,
              constraint,
              sel.value
            )
            self.handleAnswer(q, sel.value, sel.value)
          }
          wrap.appendChild(sel)
          wrap.appendChild(btn2)
        }
        var body = this.shadow.getElementById('pm-body')
        if (body) body.appendChild(wrap)
      } else {
        var opts = document.createElement('div')
        opts.className = 'pm-options'
        if (values.length === 0) {
          // Exact-match answers must come from configured offering values. A
          // free-text fallback can collect names or other identifiers and can
          // never match safely when no controlled values exist.
          throw new Error('Exact-match question has no controlled answer values')
        } else {
          values.forEach(function (v) {
            var btn4 = document.createElement('button')
            btn4.className = 'pm-option'
            btn4.textContent = v
            btn4.onclick = function () {
              self.state.activeOfferings = filterExact(self.state.activeOfferings, constraint, v)
              self.handleAnswer(q, v, v)
            }
            opts.appendChild(btn4)
          })
        }
        var body2 = this.shadow.getElementById('pm-body')
        if (body2) body2.appendChild(opts)
      }
    },

    handleAnswer: function (q, value, displayText) {
      var self = this
      // Track every question the user answers. 'entry' (case type) is tracked
      // separately as case_type_selected, so everything else flows through here —
      // including the 'provider' (do-you-know-who-you-want) question, which was
      // previously invisible in the log and funnel.
      if (q.question_type !== 'entry') {
        this.trackEvent('question_answered', this.state.currentQuestionIndex, q.id)
      }
      this.state.answers[q.id] = value
      if (this.state.activeOfferings.length === 0) {
        this.showZeroResults()
        return
      }
      if (q.question_type === 'location') {
        this.state.selectedLocationId = value
      }
      this.state.history.push({
        questionIndex: this.state.currentQuestionIndex,
        offerings: (this.state.offeringsBeforeQuestion || this.state.activeOfferings).slice(),
        answers: Object.assign({}, this.state.answers),
        selectedCaseTypeId: this.state.selectedCaseTypeId,
        selectedLocationId: this.state.selectedLocationId,
        bypassMode: this.state.bypassMode,
        bypassResumeIndex: this.state.bypassResumeIndex,
        offeringsBeforeBypass: this.state.offeringsBeforeBypass
          ? this.state.offeringsBeforeBypass.slice()
          : null,
      })
      this.addBubble(displayText, true)
      var body = this.shadow.getElementById('pm-body')
      if (body) {
        var toRemove = body.querySelectorAll(
          '.pm-options,.pm-bodymap,.pm-number-wrap,.pm-field-col,.pm-select,.pm-next-btn,.pm-back-btn'
        )
        toRemove.forEach(function (el) {
          el.remove()
        })
        body.querySelectorAll('select').forEach(function (el) {
          if (el.parentNode) el.parentNode.remove()
        })
      }
      var seqLen = this.getQuestionSequence().length
      if (this.state.bypassMode) {
        setTimeout(function () {
          self.showResults()
        }, 300)
        return
      }
      if (this.state.currentQuestionIndex >= seqLen - 1) {
        setTimeout(function () {
          self.showResults()
        }, 300)
        return
      }
      this.state.currentQuestionIndex++
      setTimeout(function () {
        self.renderQuestion()
      }, 300)
    },

    goBack: function () {
      if (!this.state.history.length) return
      var last = this.state.history.pop()
      this.state.currentQuestionIndex = last.questionIndex
      this.state.activeOfferings = last.offerings
      this.state.answers = last.answers
      this.state.selectedCaseTypeId = last.selectedCaseTypeId
      this.state.selectedLocationId = last.selectedLocationId
      this.state.bypassMode = last.bypassMode
      this.state.bypassResumeIndex = last.bypassResumeIndex
      this.state.offeringsBeforeBypass = last.offeringsBeforeBypass
        ? last.offeringsBeforeBypass.slice()
        : null
      var body = this.shadow.getElementById('pm-body')
      if (body) body.innerHTML = ''
      var seq = this.getQuestionSequence()
      for (var i = 0; i < last.questionIndex; i++) {
        var q = seq[i]
        if (!q) continue
        this.addBubble(q.question_text, false)
        var ans = last.answers[q.id]
        if (ans !== undefined && ans !== null) {
          if (q.question_type === 'location') {
            var loc = (this.data.locations || []).find(function(l) { return l.id === ans })
            this.addBubble(loc ? loc.name : 'No preference', true)
          } else {
            this.addBubble(String(ans), true)
          }
        }
      }
      this.renderQuestion()
    },

    showZeroResults: function () {
      var self = this
      // Record the outcome before any DOM rendering, and emit a per-attempt event
      // so the log can attribute "no results" to the exact attempt that hit it.
      this.trackEvent('zero_results_shown')
      this.state.resultsPositions = []
      this.state.scrollDepth = null
      this.trackSession(true)
      var body = this.shadow.getElementById('pm-body')
      if (!body) return
      body.innerHTML = ''
      var config = this.data.config || {}
      var div = document.createElement('div')
      div.className = 'pm-fallback'

      var heading = document.createElement('div')
      heading.style.cssText = 'font-size:18px;font-weight:700;color:#1e293b;margin-bottom:12px;'
      heading.textContent = 'No results found'
      div.appendChild(heading)

      var answersList = document.createElement('div')
      answersList.style.cssText =
        'text-align:left;margin-bottom:16px;padding:12px;background:#f8fafc;border-radius:10px;'
      var seq = this.getQuestionSequence()
      var hasAnswers = false
      seq.forEach(function (q) {
        if (!Object.prototype.hasOwnProperty.call(self.state.answers, q.id)) return
        hasAnswers = true
        var value = self.state.answers[q.id]
        var displayVal = ''
        if (q.question_type === 'entry') {
          var ct = (self.data.caseTypes || []).find(function (c) {
            return c.id === value
          })
          displayVal = ct ? ct.name : String(value)
        } else if (q.question_type === 'location') {
          if (value === null) {
            displayVal = 'No preference'
          } else {
            var loc = (self.data.locations || []).find(function (l) {
              return l.id === value
            })
            displayVal = loc ? loc.name : String(value)
          }
        } else if (q.question_type === 'clinical') {
          var constraint = self.findConstraint(q.constraint_id)
          if (constraint && constraint.type === 'binary') {
            if (value === 'yes') displayVal = constraint.yes_label || 'Yes'
            else if (value === 'no') displayVal = constraint.no_label || 'No'
            else displayVal = String(value)
          } else {
            displayVal = String(value)
          }
        } else if (q.question_type === 'provider') {
          displayVal = value === 'yes' ? 'Yes' : value === 'no' ? 'No' : String(value)
        } else {
          displayVal = String(value)
        }
        var row = document.createElement('div')
        row.style.cssText = 'font-size:13px;color:#475569;margin-bottom:8px;line-height:1.4;'
        row.textContent = q.question_text + ' → ' + displayVal
        answersList.appendChild(row)
      })
      if (hasAnswers) {
        div.appendChild(answersList)
      }

      var btnWrap = document.createElement('div')
      btnWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;'
      if (config.fallback_phone) {
        var callBtn = document.createElement('a')
        callBtn.className = 'pm-book'
        callBtn.href = 'tel:' + config.fallback_phone
        callBtn.textContent = 'Call the office'
        callBtn.onclick = function () {
          self.trackEvent('call_office_clicked')
        }
        btnWrap.appendChild(callBtn)
      }
      var restartBtn = document.createElement('button')
      restartBtn.className = 'pm-restart'
      restartBtn.textContent = 'Start over'
      restartBtn.onclick = function () {
        self.trackEvent('start_over_clicked')
        self.resetState()
        self.startFlow()
      }
      btnWrap.appendChild(restartBtn)
      div.appendChild(btnWrap)
      body.appendChild(div)
    },

    showResults: function () {
      var self = this
      var config = this.data.config || {}
      this.state.phase = 'results'
      var seen = {}
      var unique = []
      this.state.activeOfferings.forEach(function (o) {
        if (!seen[o.provider_id]) {
          seen[o.provider_id] = true
          var provider = (self.data.providers || []).find(function (p) {
            return p.id === o.provider_id
          })
          if (provider) unique.push({ provider: provider, offering: o })
        }
      })
      if (!unique.length) {
        this.showZeroResults()
        return
      }
      // Pure random order. A booking-count "fairness" sort used to run here
      // (least-booked-first), but it penalized providers who cover more case
      // types — someone who sees shoulder/hip/knee racked up "bookings"
      // across all three and got bumped below a shoulder-only provider for
      // shoulder patients specifically, which isn't fair at all. True random
      // per render is the fair version.
      for (var i = unique.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1))
        var tmp = unique[i]
        unique[i] = unique[j]
        unique[j] = tmp
      }
      var resultsPositions = unique.map(function (item, i) {
        return {
          provider_id: item.provider.id,
          position: i + 1,
        }
      })
      this.state.resultsPositions = resultsPositions
      this.state.clickOrder = 0
      this.state.scrollDepth = null
      // Record the outcome the moment it's decided — before any DOM rendering, so
      // a render error can never prevent the log from recording results were shown.
      // answer_text distinguishes the guided "matched" list from the "browse all"
      // list users reach by answering Yes to the preferred-provider question.
      this.trackEvent('results_shown', null, null, this.state.bypassMode ? 'browse_all' : 'matched')
      this.trackSession(false)
      var body = this.shadow.getElementById('pm-body')
      if (!body) return
      body.innerHTML = ''
      var resultsShownAt = Date.now()
      var positionByProvider = {}
      resultsPositions.forEach(function (p) {
        positionByProvider[p.provider_id] = p.position
      })
      var results = document.createElement('div')
      results.className = 'pm-results'
      function appendResultCard(provider, outsideArea) {
        var card = self.buildCard(provider, outsideArea)
        var pos = positionByProvider[provider.id]
        if (pos) card.setAttribute('data-position', String(pos))
        results.appendChild(card)
      }
      var caseTypeName = ''
      var selectedCaseType = (self.data.caseTypes || []).find(function (ct) { return ct.id === self.state.selectedCaseTypeId })
      if (selectedCaseType) caseTypeName = selectedCaseType.name
      var selectedLocName = ''
      if (self.state.selectedLocationId) {
        var selectedLocForHeader = (self.data.locations || []).find(function (l) { return l.id === self.state.selectedLocationId })
        if (selectedLocForHeader) selectedLocName = selectedLocForHeader.name
      }
      if (caseTypeName) {
        var header = document.createElement('div')
        header.style.cssText = 'font-size:15px;font-weight:600;color:#1e293b;padding:4px 0 12px;'
        header.textContent = 'Results for ' + caseTypeName + (selectedLocName ? ' at ' + selectedLocName : '')
        results.appendChild(header)
      }
      if (this.state.bypassMode) {
        var search = document.createElement('input')
        search.className = 'pm-search'
        search.placeholder = 'Search by provider name...'
        search.setAttribute('aria-label', 'Search by provider name')
        search.oninput = function () {
          var q = search.value.toLowerCase()
          results.querySelectorAll('.pm-card').forEach(function (card) {
            var name = card.querySelector('.pm-name')
            if (name)
              card.style.display = name.textContent.toLowerCase().indexOf(q) > -1 ? '' : 'none'
          })
        }
        results.appendChild(search)
        var infoText = document.createElement('div')
        infoText.style.cssText = 'font-size:12px;color:#64748b;padding:4px 0 8px;'
        infoText.textContent = "If your provider isn't listed, they may not treat this condition."
        results.appendChild(infoText)
        var helpLink = document.createElement('div')
        helpLink.className = 'pm-help'
        helpLink.textContent = 'Help me choose instead'
        helpLink.onclick = function () {
          self.trackEvent('help_me_choose_clicked')
          self.state.bypassMode = false
          body.innerHTML = ''
          if (self.state.offeringsBeforeBypass && self.state.offeringsBeforeBypass.length) {
            self.state.activeOfferings = self.state.offeringsBeforeBypass.slice()
          }
          self.state.currentQuestionIndex =
            self.state.bypassResumeIndex != null
              ? self.state.bypassResumeIndex
              : self.state.currentQuestionIndex + 1
          self.state.offeringsBeforeBypass = null
          self.state.bypassResumeIndex = null
          self.renderQuestion()
        }
        results.appendChild(helpLink)
        unique.forEach(function (item) {
          appendResultCard(item.provider, false)
        })
      } else {
        var remaining = unique.slice()
        if (this.state.selectedLocationId) {
          var atLoc = remaining.filter(function (item) {
            return (
              item.offering.location_ids &&
              item.offering.location_ids.indexOf(self.state.selectedLocationId) > -1
            )
          })
          var outsideLoc = remaining.filter(function (item) {
            return (
              !item.offering.location_ids ||
              item.offering.location_ids.indexOf(self.state.selectedLocationId) === -1
            )
          })
          var locName = ''
          var foundLoc = (this.data.locations || []).find(function (l) {
            return l.id === self.state.selectedLocationId
          })
          if (foundLoc) locName = foundLoc.name
          var sec2 = document.createElement('div')
          sec2.className = 'pm-section-title'
          sec2.textContent = 'Providers at ' + locName
          results.appendChild(sec2)
          if (!atLoc.length) {
            var noMatch = document.createElement('div')
            noMatch.style.cssText = 'font-size:13px;color:#64748b;padding:8px 0;'
            noMatch.textContent =
              'There are no specialists for this case type at ' + locName + '.'
            results.appendChild(noMatch)
          } else {
            atLoc.forEach(function (item) {
              appendResultCard(item.provider, false)
            })
          }
          // show_worth_the_drive gates this section entirely — the org can
          // turn it off if they'd rather only ever show in-location matches.
          if (outsideLoc.length && config.show_worth_the_drive !== false) {
            var outsideWrap = document.createElement('div')
            outsideWrap.className = 'pm-outside-section'
            var sec3 = document.createElement('div')
            sec3.className = 'pm-outside-title'
            var sec3Icon = document.createElement('span')
            sec3Icon.className = 'pm-outside-icon'
            sec3Icon.setAttribute('aria-hidden', 'true')
            sec3Icon.textContent = '⚠️'
            sec3.appendChild(sec3Icon)
            sec3.appendChild(document.createTextNode('Not at ' + locName))
            outsideWrap.appendChild(sec3)
            var sec3sub = document.createElement('div')
            sec3sub.className = 'pm-outside-sub'
            sec3sub.textContent =
              'These providers treat this, but not at ' + locName + ' — only at another location.'
            outsideWrap.appendChild(sec3sub)
            results.appendChild(outsideWrap)
            outsideLoc.forEach(function (item) {
              appendResultCard(item.provider, true)
            })
          }
        } else {
          remaining.forEach(function (item) {
            appendResultCard(item.provider, false)
          })
        }
      }
      this.appendPrivacyNotice(results)
      var restartBtn = document.createElement('button')
      restartBtn.className = 'pm-restart'
      restartBtn.textContent = 'Start Over'
      restartBtn.onclick = function() { self.trackEvent('start_over_clicked'); self.resetState(); self.startFlow(); }
      results.appendChild(restartBtn)
      body.appendChild(results)
      this.setupScrollDepthTracking(results, body, resultsShownAt)
    },

    renderGrouped: function (container, items) {
      var self = this
      var seen = {}
      var unique = []
      items.forEach(function (item) {
        if (!seen[item.provider.id]) {
          seen[item.provider.id] = true
          unique.push(item.provider)
        }
      })
      unique.forEach(function (provider) {
        container.appendChild(self.buildCard(provider))
      })
    },

    setupScrollDepthTracking: function (resultsContainer, scrollRoot, resultsShownAt) {
      var self = this
      if (this._scrollObserver) {
        this._scrollObserver.disconnect()
        this._scrollObserver = null
      }
      if (this._scrollDebounceTimer) {
        clearTimeout(this._scrollDebounceTimer)
        this._scrollDebounceTimer = null
      }
      var cards = resultsContainer.querySelectorAll('[data-position]')
      if (!cards.length) return

      var lastPostedMax = 0

      function maybePostScroll() {
        if (self._scrollDebounceTimer) clearTimeout(self._scrollDebounceTimer)
        self._scrollDebounceTimer = setTimeout(function () {
          self._scrollDebounceTimer = null
          var sd = self.state.scrollDepth
          if (!sd || sd.max_position_seen <= lastPostedMax) return
          lastPostedMax = sd.max_position_seen
          self.trackScroll()
        }, 300)
      }

      function updateScrollDepth(position) {
        var existing = (self.state.scrollDepth && self.state.scrollDepth.max_position_seen) || 0
        var max = Math.max(existing, position)
        if (max > existing) {
          self.state.scrollDepth = {
            max_position_seen: max,
            time_in_results_ms: Date.now() - resultsShownAt,
          }
          maybePostScroll()
        }
      }

      this._scrollObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return
            var pos = parseInt(entry.target.getAttribute('data-position'), 10)
            if (!isNaN(pos)) updateScrollDepth(pos)
          })
        },
        { root: scrollRoot, threshold: 0.1 }
      )

      cards.forEach(function (card) {
        self._scrollObserver.observe(card)
      })
    },

    buildCard: function (provider, outsideArea) {
      var self = this
      var config = this.data.config || {}

      // Determine effective booking mode and phone mode
      var orgBookingMode = config.default_booking_mode || 'simple'
      var orgPhoneMode = config.default_phone_mode || 'simple'
      var bookingMode = provider.booking_mode === 'default' ? orgBookingMode : (provider.booking_mode || orgBookingMode)
      var phoneMode = provider.phone_mode === 'default' ? orgPhoneMode : (provider.phone_mode || orgPhoneMode)

      // Get provider locations
      var provLocs = (this.data.providerLocations || []).filter(function (pl) {
        return pl.provider_id === provider.id
      })

      // Build card
      var card = document.createElement('div')
      card.className = outsideArea ? 'pm-card pm-card-outside' : 'pm-card'

      if (outsideArea) {
        var outsideBadge = document.createElement('div')
        outsideBadge.className = 'pm-outside-badge'
        outsideBadge.textContent = '📍 Not at your selected location'
        card.appendChild(outsideBadge)
      }

      // Avatar
      var avatar
      if (provider.image_url) {
        avatar = document.createElement('img')
        avatar.src = provider.image_url
        avatar.alt = provider.name
        avatar.className = 'pm-avatar'
      } else {
        // Same palette + initials logic as the dashboard's provider cards
        // (src/shared/avatarPalette.ts) — a provider with no photo should
        // look identical here and in the app.
        avatar = document.createElement('div')
        avatar.className = 'pm-avatar'
        var avatarBackground = AVATAR_COLORS[avatarColorIndex(provider.name)].hex
        avatar.style.background = avatarBackground
        avatar.style.color = readableTextColor(avatarBackground)
        avatar.textContent = initialsForName(provider.name)
      }

      // Info section
      var info = document.createElement('div')
      info.className = 'pm-info'

      var name = document.createElement('div')
      name.className = 'pm-name'
      name.textContent = provider.name
      info.appendChild(name)

      if (provider.subtitle) {
        var sub = document.createElement('div')
        sub.className = 'pm-sub'
        sub.textContent = provider.subtitle
        info.appendChild(sub)
      }

      // Category pills
      var catPills = document.createElement('div')
      catPills.className = 'pm-pills'
      ;(provider.category_ids || []).forEach(function (catId) {
        var cat = (self.data.categories || []).find(function (c) { return c.id === catId })
        if (cat) {
          var pill = document.createElement('span')
          pill.className = 'pm-cat-pill'
          pill.textContent = cat.name
          catPills.appendChild(pill)
        }
      })
      if (catPills.children.length) info.appendChild(catPills)

      // Location pills — from offerings
      var providerOfferingLocationIds = []
      ;(self.data.offerings || []).forEach(function (o) {
        if (o.provider_id === provider.id) {
          ;(o.location_ids || []).forEach(function (lid) {
            if (providerOfferingLocationIds.indexOf(lid) === -1) {
              providerOfferingLocationIds.push(lid)
            }
          })
        }
      })
      if (providerOfferingLocationIds.length) {
        var locPills = document.createElement('div')
        locPills.className = 'pm-locs'
        providerOfferingLocationIds.forEach(function (lid) {
          var loc = (self.data.locations || []).find(function (l) { return l.id === lid })
          if (loc) {
            var pill = document.createElement('span')
            pill.className = 'pm-loc-pill'
            pill.textContent = '📍 ' + loc.name
            locPills.appendChild(pill)
          }
        })
        if (locPills.children.length) info.appendChild(locPills)
      }

      // View Profile link
      if (provider.bio_link) {
        var profileLink = document.createElement('a')
        profileLink.className = 'pm-view-profile'
        profileLink.href = provider.bio_link
        profileLink.target = '_blank'
        profileLink.rel = 'noopener noreferrer'
        profileLink.textContent = '👤 View Profile →'
        profileLink.onclick = function () { self.trackEvent('profile_viewed') }
        info.appendChild(profileLink)
      }

      var cardTop = document.createElement('div')
      cardTop.style.cssText = 'display:flex;gap:12px;align-items:flex-start;'
      cardTop.appendChild(avatar)
      cardTop.appendChild(info)
      card.appendChild(cardTop)

      // Actions — full width below info
      var actionsArea = document.createElement('div')
      actionsArea.style.cssText = 'margin-top:10px;border-top:0.5px solid #e2e8f0;padding-top:10px;'

      var defaultPanel = document.createElement('div')
      defaultPanel.style.cssText = 'display:flex;flex-direction:column;gap:6px;'

      // --- BOOKING BUTTON ---
      var bookingLocsWithLinks = provLocs.filter(function (pl) { return pl.booking_link })

      if (this.state.selectedLocationId) {
        var selectedPl = provLocs.find(function (pl) { return pl.location_id === self.state.selectedLocationId })
        var selectedLoc = (this.data.locations || []).find(function (l) { return l.id === self.state.selectedLocationId })
        if (selectedPl && selectedPl.booking_link) {
          var bookBtn = document.createElement('a')
          bookBtn.className = 'pm-book'
          bookBtn.href = selectedPl.booking_link
          bookBtn.target = '_blank'
          bookBtn.rel = 'noopener noreferrer'
          bookBtn.textContent = 'Book at ' + (selectedLoc ? selectedLoc.name : 'Location')
          bookBtn.onclick = function () {
            self.trackClick(provider.id)
            self.trackEvent('booking_clicked')
          }
          defaultPanel.appendChild(bookBtn)
        } else if (bookingLocsWithLinks.length && (bookingLocsWithLinks.length === 1 || bookingMode === 'simple')) {
          var firstPlFallback = bookingLocsWithLinks[0]
          if (firstPlFallback) {
            var firstLocFallback = (this.data.locations || []).find(function (l) { return l.id === firstPlFallback.location_id })
            var bookBtnFallback = document.createElement('a')
            bookBtnFallback.className = 'pm-book'
            bookBtnFallback.href = firstPlFallback.booking_link
            bookBtnFallback.target = '_blank'
            bookBtnFallback.rel = 'noopener noreferrer'
            bookBtnFallback.textContent = bookingLocsWithLinks.length === 1 ? 'Book at ' + (firstLocFallback ? firstLocFallback.name : 'Location') : 'Book Now'
            bookBtnFallback.onclick = function () {
              self.trackClick(provider.id)
              self.trackEvent('booking_clicked')
            }
            defaultPanel.appendChild(bookBtnFallback)
          }
        } else if (bookingLocsWithLinks.length > 1) {
          var bookTriggerFallback = document.createElement('button')
          bookTriggerFallback.className = 'pm-book'
          bookTriggerFallback.textContent = 'Book Now'
          bookTriggerFallback.onclick = function () {
            self.trackEvent('booking_options_opened')
            defaultPanel.style.display = 'none'
            bookSlide.style.display = 'flex'
          }
          defaultPanel.appendChild(bookTriggerFallback)
        }
      } else if (bookingLocsWithLinks.length && (bookingLocsWithLinks.length === 1 || bookingMode === 'simple')) {
        var firstPl = bookingLocsWithLinks[0]
        if (firstPl) {
          var firstLoc = (this.data.locations || []).find(function (l) { return l.id === firstPl.location_id })
          var bookBtn2 = document.createElement('a')
          bookBtn2.className = 'pm-book'
          bookBtn2.href = firstPl.booking_link
          bookBtn2.target = '_blank'
          bookBtn2.rel = 'noopener noreferrer'
          bookBtn2.textContent = bookingLocsWithLinks.length === 1 ? 'Book at ' + (firstLoc ? firstLoc.name : 'Location') : 'Book Now'
          bookBtn2.onclick = function () {
            self.trackClick(provider.id)
            self.trackEvent('booking_clicked')
          }
          defaultPanel.appendChild(bookBtn2)
        }
      } else if (bookingLocsWithLinks.length > 1) {
        var bookTrigger = document.createElement('button')
        bookTrigger.className = 'pm-book'
        bookTrigger.textContent = 'Book Now'
        bookTrigger.onclick = function () {
          self.trackEvent('booking_options_opened')
          defaultPanel.style.display = 'none'
          bookSlide.style.display = 'flex'
        }
        defaultPanel.appendChild(bookTrigger)
      }

      // --- PHONE BUTTON ---
      var phoneLocsWithNumbers = provLocs.filter(function (pl) { return pl.phone })

      if (phoneLocsWithNumbers.length > 0) {
        if (this.state.selectedLocationId) {
          var selPhonePl = provLocs.find(function (pl) { return pl.location_id === self.state.selectedLocationId })
          var selPhoneLoc = (this.data.locations || []).find(function (l) { return l.id === self.state.selectedLocationId })
          if (selPhonePl && selPhonePl.phone) {
            var callBtn = document.createElement('a')
            callBtn.className = 'pm-call'
            callBtn.href = 'tel:' + selPhonePl.phone
            callBtn.textContent = '📞 Call ' + (selPhoneLoc ? selPhoneLoc.name : 'Office')
            callBtn.onclick = function () {
              self.trackClick(provider.id)
              self.trackEvent('call_clicked')
            }
            defaultPanel.appendChild(callBtn)
          } else if (phoneLocsWithNumbers.length && (phoneLocsWithNumbers.length === 1 || phoneMode === 'simple')) {
            var firstPhoneFallback = phoneLocsWithNumbers[0]
            var firstPhoneLocFallback = (this.data.locations || []).find(function (l) { return l.id === firstPhoneFallback.location_id })
            var callBtnFallback = document.createElement('a')
            callBtnFallback.className = 'pm-call'
            callBtnFallback.href = 'tel:' + firstPhoneFallback.phone
            callBtnFallback.textContent = '📞 Call ' + (phoneLocsWithNumbers.length === 1 ? (firstPhoneLocFallback ? firstPhoneLocFallback.name : 'Office') : 'Office')
            callBtnFallback.onclick = function () {
              self.trackClick(provider.id)
              self.trackEvent('call_clicked')
            }
            defaultPanel.appendChild(callBtnFallback)
          } else if (phoneLocsWithNumbers.length > 1) {
            var callTriggerFallback = document.createElement('button')
            callTriggerFallback.className = 'pm-call'
            callTriggerFallback.textContent = '📞 Call Office'
            callTriggerFallback.onclick = function () {
              self.trackEvent('call_options_opened')
              defaultPanel.style.display = 'none'
              callSlide.style.display = 'flex'
            }
            defaultPanel.appendChild(callTriggerFallback)
          }
        } else if (phoneLocsWithNumbers.length && (phoneLocsWithNumbers.length === 1 || phoneMode === 'simple')) {
          var firstPhonePl = phoneLocsWithNumbers[0]
          var firstPhoneLoc = (this.data.locations || []).find(function (l) { return l.id === firstPhonePl.location_id })
          var callBtn2 = document.createElement('a')
          callBtn2.className = 'pm-call'
          callBtn2.href = 'tel:' + firstPhonePl.phone
          callBtn2.textContent = '📞 Call ' + (phoneLocsWithNumbers.length === 1 ? (firstPhoneLoc ? firstPhoneLoc.name : 'Office') : 'Office')
          callBtn2.onclick = function () {
            self.trackClick(provider.id)
            self.trackEvent('call_clicked')
          }
          defaultPanel.appendChild(callBtn2)
        } else {
          var callTrigger = document.createElement('button')
          callTrigger.className = 'pm-call'
          callTrigger.textContent = '📞 Call Office'
          callTrigger.onclick = function () {
            self.trackEvent('call_options_opened')
            defaultPanel.style.display = 'none'
            callSlide.style.display = 'flex'
          }
          defaultPanel.appendChild(callTrigger)
        }
      }

      actionsArea.appendChild(defaultPanel)

      // --- BOOKING SLIDE ---
      var bookSlide = document.createElement('div')
      bookSlide.style.cssText = 'display:none;flex-direction:column;gap:6px;'
      var bookLabel = document.createElement('div')
      bookLabel.style.cssText = 'font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;text-align:center;'
      bookLabel.textContent = 'Book at...'
      bookSlide.appendChild(bookLabel)
      bookingLocsWithLinks.forEach(function (pl) {
        var loc = (self.data.locations || []).find(function (l) { return l.id === pl.location_id })
        var btn = document.createElement('a')
        btn.className = 'pm-book'
        btn.href = pl.booking_link
        btn.target = '_blank'
        btn.rel = 'noopener noreferrer'
        btn.textContent = loc ? loc.name : 'Location'
        btn.onclick = function () {
          self.trackClick(provider.id)
          self.trackEvent('booking_clicked')
        }
        bookSlide.appendChild(btn)
      })
      var bookBack = document.createElement('button')
      bookBack.className = 'pm-back-link'
      bookBack.textContent = '← back'
      bookBack.onclick = function () {
        bookSlide.style.display = 'none'
        defaultPanel.style.display = 'flex'
      }
      bookSlide.appendChild(bookBack)
      actionsArea.appendChild(bookSlide)

      // --- CALL SLIDE ---
      var callSlide = document.createElement('div')
      callSlide.style.cssText = 'display:none;flex-direction:column;gap:6px;'
      var callLabel = document.createElement('div')
      callLabel.style.cssText = 'font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;text-align:center;'
      callLabel.textContent = 'Call...'
      callSlide.appendChild(callLabel)
      phoneLocsWithNumbers.forEach(function (pl) {
        var loc = (self.data.locations || []).find(function (l) { return l.id === pl.location_id })
        var btn = document.createElement('button')
        btn.className = 'pm-call'
        btn.textContent = '📞 ' + (loc ? loc.name : 'Office')
        btn.onclick = function () {
          self.trackClick(provider.id)
          self.trackEvent('call_clicked')
          window.location.href = 'tel:' + pl.phone
        }
        callSlide.appendChild(btn)
      })
      var callBack = document.createElement('button')
      callBack.className = 'pm-back-link'
      callBack.textContent = '← back'
      callBack.onclick = function () {
        callSlide.style.display = 'none'
        defaultPanel.style.display = 'flex'
      }
      callSlide.appendChild(callBack)
      actionsArea.appendChild(callSlide)

      if (defaultPanel.children.length > 0 || bookingLocsWithLinks.length > 1 || phoneLocsWithNumbers.length > 1) {
        card.appendChild(actionsArea)
      }

      return card
    },

    // Shared POST for all tracking. Retries once on network error / 5xx, and
    // surfaces a console.warn on final failure instead of swallowing silently —
    // a lost tracking call should never be invisible.
    postTracking: function (payload, label) {
      var url = SUPABASE_URL + '/functions/v1/track-session'
      payload.session_token = this.data && this.data.config
        ? this.data.config.session_token
        : null
      var opts = {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'apikey': supabaseAnonKey, 'Authorization': 'Bearer ' + supabaseAnonKey },
        body: JSON.stringify(payload),
      }
      function attempt(retriesLeft) {
        return fetch(url, opts)
          .then(function (res) {
            if (!res.ok) {
              if (res.status >= 500 && retriesLeft > 0) return attempt(retriesLeft - 1)
              res
                .clone()
                .json()
                .then(function (body) {
                  var detail = body && body.error ? ': ' + body.error : ''
                  console.warn('[ProviderRoute] tracking failed (' + label + '): HTTP ' + res.status + detail)
                })
                .catch(function () {
                  console.warn('[ProviderRoute] tracking failed (' + label + '): HTTP ' + res.status)
                })
            }
            return res
          })
          .catch(function (err) {
            if (retriesLeft > 0) return attempt(retriesLeft - 1)
            console.warn('[ProviderRoute] tracking failed (' + label + '):', err)
          })
      }
      return attempt(1)
    },

    trackEvent: function (eventType, stepIndex, questionId, answerCode) {
      return this.postTracking({
        type: 'event',
        session_id: this.state.sessionId,
        widget_id: this.widgetId,
        event_type: eventType,
        step_index: stepIndex != null ? stepIndex : null,
        question_id: questionId != null ? questionId : null,
        // Only structural ids and fixed operational codes cross the network.
        // Readable prompts/answers remain in the browser.
        answer_code: answerCode != null ? answerCode : null,
      }, 'event:' + eventType)
    },

    trackSession: function (zeroResults) {
      return this.postTracking({
        type: 'session',
        widget_id: this.widgetId,
        session_id: this.state.sessionId,
        case_type_id: this.state.selectedCaseTypeId,
        results_count: this.state.activeOfferings.length,
        providers_shown: Array.from(new Set(this.state.activeOfferings.map(function (o) { return o.provider_id }).filter(Boolean))),
        zero_results: zeroResults,
        providers_clicked: [],
        results_positions: this.state.resultsPositions || [],
        scroll_depth: this.state.scrollDepth || null,
      }, 'session(zero=' + zeroResults + ')')
    },

    trackClick: function (providerId) {
      var position = null
      for (var i = 0; i < this.state.resultsPositions.length; i++) {
        if (this.state.resultsPositions[i].provider_id === providerId) {
          position = this.state.resultsPositions[i].position
          break
        }
      }
      this.state.clickOrder++
      return this.postTracking({
        widget_id: this.widgetId,
        session_id: this.state.sessionId,
        provider_id: providerId,
        type: 'click',
        position_at_click: position,
        click_order: this.state.clickOrder,
      }, 'click')
    },

    trackScroll: function () {
      return this.postTracking({
        widget_id: this.widgetId,
        session_id: this.state.sessionId,
        type: 'scroll',
        scroll_depth: this.state.scrollDepth,
      }, 'scroll')
    },
  }

  // --- Failure containment -------------------------------------------------
  // This runs on a customer's live site in front of patients. Before, only
  // fetchData was wrapped, so a throw anywhere in rendering or the question
  // flow left a frozen widget with no signal to anyone. Every flow method is
  // wrapped so a failure degrades to the org's fallback (phone number where
  // configured) instead of a dead box.

  widget.degraded = false

  /**
   * Public API for opening the chat from an element elsewhere on the host
   * page (e.g. a "Not sure who to see? Match me" link/button written into
   * the site itself, outside this widget's own floating button). Wire such
   * a trigger to `window._ProviderRoute.open()` rather than clicking the
   * floating button's DOM node directly — the button may not exist yet if
   * open_delay_enabled is on, and clicking a node that isn't there yet is a
   * silent no-op. This always opens immediately: it cancels any pending
   * delay timer so the floating button doesn't also pop up afterward, and
   * is a safe no-op if the chat is already open or the widget hasn't
   * finished loading yet.
   */
  widget.open = function () {
    if (!this.data || !this.shadow) return
    if (this._delayTimer) {
      clearTimeout(this._delayTimer)
      this._delayTimer = null
    }
    if (this.shadow.getElementById('pm-chat')) return
    var btn = this.shadow.querySelector('.pm-btn')
    if (btn) btn.remove()
    this.createChatContainer()
    this.trackEvent('widget_opened')
    this.startFlow()
  }

  /**
   * Replace the conversation area with the org's fallback so a patient who
   * hits a broken step still gets a way to reach the practice.
   */
  widget.degrade = function (label, err) {
    console.warn('[ProviderRoute] recovering from error in ' + label + ':', err)
    if (this.degraded) return
    this.degraded = true

    try {
      this.trackEvent('widget_error')
    } catch (e) {
      /* tracking must never mask the original failure */
    }

    var config = (this.data && this.data.config) || {}
    var body = this.shadow && this.shadow.getElementById('pm-body')
    if (!body) return

    var message =
      config.fallback_message ||
      "Sorry — something went wrong on our end. Please give us a call and we'll help you find the right provider."

    var box = document.createElement('div')
    box.className = 'pm-bubble'
    box.textContent = message
    body.appendChild(box)

    if (config.fallback_phone) {
      var link = document.createElement('a')
      link.className = 'pm-btn'
      link.href = 'tel:' + String(config.fallback_phone).replace(/[^0-9+]/g, '')
      link.textContent = 'Call ' + config.fallback_phone
      link.style.cssText = 'display:inline-block;margin-top:8px;text-decoration:none;'
      body.appendChild(link)
    }

    body.scrollTop = body.scrollHeight
  }

  // Wrap in place rather than editing each method, so the guarantee holds for
  // every flow method including ones added later.
  ;[
    'checkDomain', 'injectWidget', 'injectStyles', 'createFloatingButton',
    'createChatContainer', 'resetState', 'addBubble', 'appendPrivacyNotice', 'startFlow', 'open',
    'getQuestionSequence', 'findConstraint', 'renderQuestion', 'renderCaseTypes',
    'renderLocationSelect', 'renderProviderChoice', 'renderBinary', 'renderRange',
    'renderExact', 'handleAnswer', 'goBack', 'showZeroResults', 'showResults',
    'renderGrouped', 'setupScrollDepthTracking', 'buildCard',
  ].forEach(function (name) {
    var original = widget[name]
    if (typeof original !== 'function') return
    widget[name] = function () {
      try {
        return original.apply(this, arguments)
      } catch (err) {
        this.degrade(name, err)
        return null
      }
    }
  })

  function boot() {
    try {
      widget.init()
    } catch (err) {
      // Nothing is rendered yet, so there is no UI to degrade into — stay out
      // of the host page's way rather than throwing into it.
      console.warn('[ProviderRoute] failed to start:', err)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }

  window._ProviderRoute = widget
  // Back-compat alias: any site whose custom JS calls window._ProviderMatcher.open()
  // directly (per the old docs) keeps working. Do not remove without a deprecation window.
  window._ProviderMatcher = widget
})()
