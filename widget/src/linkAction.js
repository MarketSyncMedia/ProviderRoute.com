/**
 * What a result card offers for one kind of per-location link: the appointment
 * request link or the self-scheduling link. Each follows its own simple /
 * advanced mode, and a card offers nothing for a kind the provider has no link
 * for -- so a provider with no self-scheduling link simply has no such button.
 *
 *  - a patient who chose a location gets that location's link;
 *  - otherwise one link (the only one, or in simple mode the shared one) is
 *    offered directly;
 *  - otherwise (advanced mode, several locations) the patient picks a location.
 *
 * The wording follows the mode, not how many locations the provider happens to
 * have: simple mode is one generic button ("Book Now"), whatever the provider's
 * locations or the patient's choice; advanced mode names the location ("Book at
 * Towson"), even for a provider with only one. `atLocation` carries that.
 *
 * `provLocs` should already be run through withSharedValues, so in simple mode
 * every location holds the same link.
 */
export function planLinkAction(provLocs, key, mode, selectedLocationId) {
  var withLinks = (provLocs || []).filter(function (pl) { return pl[key] })
  if (!withLinks.length) return { type: 'none' }

  if (selectedLocationId) {
    var chosen = provLocs.find(function (pl) { return pl.location_id === selectedLocationId })
    if (chosen && chosen[key]) {
      return { type: 'link', locationId: chosen.location_id, url: chosen[key], atLocation: mode !== 'simple' }
    }
  }

  if (withLinks.length === 1 || mode === 'simple') {
    var first = withLinks[0]
    return { type: 'link', locationId: first.location_id, url: first[key], atLocation: mode !== 'simple' }
  }

  return {
    type: 'choose',
    options: withLinks.map(function (pl) { return { locationId: pl.location_id, url: pl[key] } }),
  }
}

/**
 * The text on a button. The admin's own wording, when they set one, is used
 * exactly as written; otherwise the built-in wording, which names the location
 * when the button is for one.
 */
export function linkButtonLabel(customText, words, atLocation, locationName) {
  var custom = (customText || '').trim()
  if (custom) return custom
  return atLocation ? words.at + (locationName || 'Location') : words.generic
}

/**
 * The text on the call button, by the same rule as the link buttons: simple mode
 * is one generic button ("Call Office"), whatever the provider's locations or the
 * patient's choice; advanced mode names the location ("Call Towson"), even for a
 * provider with only one.
 */
export function callButtonLabel(mode, locationName) {
  if (mode === 'simple') return '📞 Call Office'
  return '📞 Call ' + (locationName || 'Office')
}

/** The text above the list of locations a patient chooses between. */
export function linkSlideHeader(customText, words) {
  return (customText || '').trim() || words.slideHeader
}

export var BOOKING_WORDS = { at: 'Book at ', generic: 'Book Now', slideHeader: 'Book at...' }
export var SELF_SCHEDULE_WORDS = { at: 'Schedule at ', generic: 'Schedule Online', slideHeader: 'Schedule at...' }
