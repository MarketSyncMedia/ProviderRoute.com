import { sharedLocationValue } from '../../src/shared/sharedLocationValue'

/**
 * The provider's booking links and phones a patient may be offered: only those
 * at locations where the provider has an offering this widget received, and,
 * once the patient has chosen a case type, only where the provider treats that
 * case type. A provider holds one offering per case type, so a location they
 * only cover for another case type is not one to send this patient to.
 *
 * A provider keeps their saved details for a location after archiving their
 * last offering there, so restoring it brings them back. Offerings arrive
 * already limited to live ones, so a saved row with no offering behind it is
 * a location the patient should not be sent to.
 */
export function liveProviderLocations(providerLocations, offerings, providerId, caseTypeId) {
  var offered = new Set()
  ;(offerings || []).forEach(function (offering) {
    if (offering.provider_id !== providerId) return
    if (caseTypeId && offering.case_type_id !== caseTypeId) return
    ;(offering.location_ids || []).forEach(function (locationId) {
      offered.add(locationId)
    })
  })
  return (providerLocations || []).filter(function (row) {
    return row.provider_id === providerId && offered.has(row.location_id)
  })
}

/**
 * In "simple" booking or phone mode a provider has one link / one number for
 * all their locations, so every location offers the same one -- even if the
 * rows were saved with different values (the account's default mode was
 * flipped, or a location was added later). Which one stands for all is the
 * rule shared with the provider page, so the page shows what a patient gets.
 * "Advanced" leaves each location's own value alone.
 */
export function withSharedValues(provLocs, bookingMode, phoneMode) {
  var shareBooking = bookingMode === 'simple'
  var sharePhone = phoneMode === 'simple'
  if (!shareBooking && !sharePhone) return provLocs
  var booking = shareBooking
    ? sharedLocationValue(provLocs.map(function (pl) { return { locationId: pl.location_id, value: pl.booking_link } }))
    : ''
  var phone = sharePhone
    ? sharedLocationValue(provLocs.map(function (pl) { return { locationId: pl.location_id, value: pl.phone } }))
    : ''
  return provLocs.map(function (pl) {
    var copy = {}
    for (var key in pl) copy[key] = pl[key]
    if (shareBooking) copy.booking_link = booking || null
    if (sharePhone) copy.phone = phone || null
    return copy
  })
}
