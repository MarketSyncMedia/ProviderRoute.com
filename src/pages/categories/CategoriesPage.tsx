import { Tag } from 'lucide-react'
import SortableEntityListPage from '../../components/shared/SortableEntityListPage'
import {
  archiveCategory,
  createCategory,
  getCategories,
  getCategoryOfferingCounts,
  updateCategory,
  updateCategoryOrders,
} from '../../lib/api/categories'
import type { Category } from '../../types/database'
import RemoveCategoryDialog from './RemoveCategoryDialog'

export default function CategoriesPage() {
  return (
    <SortableEntityListPage<Category>
      // This page caches counts-augmented rows, so it cannot share the plain
      // ['categories', orgId] key that ProvidersPage, LogicTester,
      // DataTablePage and ProviderProfilePage read Category[] from.
      queryKey="categories-with-counts"
      alsoInvalidate={['categories']}
      api={{
        list: getCategories,
        offeringCounts: getCategoryOfferingCounts,
        create: createCategory,
        update: updateCategory,
        updateOrders: updateCategoryOrders,
        archive: archiveCategory,
      }}
      copy={{
        singular: 'Category',
        singularLower: 'category',
        pluralLower: 'categories',
        emptyDescription: 'Add categories like Sports Medicine, Joint Replacement',
        removeVerb: 'Remove',
      }}
      archiveDialog={({ entity, offeringCount, close, refresh }) => (
        <RemoveCategoryDialog category={entity} offeringCount={offeringCount} close={close} refresh={refresh} />
      )}
      icon={<Tag className="h-10 w-10" />}
    />
  )
}
