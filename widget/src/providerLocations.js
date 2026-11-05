/**
 * The provider's booking links and phones a patient may be offered: only those
 * at locations where the provider has an offering this widget received.
 *
 * A provider keeps their saved details for a location after archiving their
 * last offering there, so restoring it brings them back. Offerings arrive
 * already limited to live ones, so a saved row with no offering behind it is
 * a location the patient should not be sent to.
 */
export function liveProviderLocations(providerLocations, offerings, providerId) {
  var offered = new Set()
  ;(offerings || []).forEach(function (offering) {
    if (offering.provider_id !== providerId) return
    ;(offering.location_ids || []).forEach(function (locationId) {
      offered.add(locationId)
    })
  })
  return (providerLocations || []).filter(function (row) {
    return row.provider_id === providerId && offered.has(row.location_id)
  })
}
