import { Stethoscope } from 'lucide-react'
import SortableEntityListPage from '../../components/shared/SortableEntityListPage'
import {
  archiveCaseType,
  createCaseType,
  getCaseTypeOfferingCounts,
  getCaseTypes,
  updateCaseType,
  updateCaseTypeOrders,
} from '../../lib/api/caseTypes'
import type { CaseType } from '../../types/database'
import { MapSpotSelect, SuggestMapTagsButton } from './BodyMapControls'

export default function CaseTypesPage() {
  return (
    <SortableEntityListPage<CaseType>
      // This page caches counts-augmented rows, so it cannot share the plain
      // ['case-types', orgId] key that LogicTester, DataTablePage,
      // ProviderProfilePage and WidgetBuilderPage read CaseType[] from.
      queryKey="case-types-with-counts"
      alsoInvalidate={['case-types']}
      api={{
        list: getCaseTypes,
        offeringCounts: getCaseTypeOfferingCounts,
        create: createCaseType,
        update: updateCaseType,
        updateOrders: updateCaseTypeOrders,
        archive: archiveCaseType,
      }}
      copy={{
        singular: 'Case Type',
        singularLower: 'case type',
        pluralLower: 'case types',
        emptyDescription: 'Add case types like Knee, Shoulder, Hip',
      }}
      icon={<Stethoscope className="h-10 w-10" />}
      rowExtra={(caseType, all) => <MapSpotSelect caseType={caseType} all={all} />}
      toolbarExtra={(all) => <SuggestMapTagsButton all={all} />}
    />
  )
}
