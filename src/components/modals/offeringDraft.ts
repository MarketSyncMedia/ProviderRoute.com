export interface OfferingDraft {
  providerId: string
  caseTypeId: string
  locationIds: string[]
  constraints: Record<string, unknown>
}

export const emptyOfferingDraft = (providerId = ''): OfferingDraft => ({
  providerId,
  caseTypeId: '',
  locationIds: [],
  constraints: {},
})
