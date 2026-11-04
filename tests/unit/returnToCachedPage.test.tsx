import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Coming back to a page whose data is still cached must show that data.
 *
 * These pages keep an editable copy of their query data, filled when the data
 * changes identity. The "last copied" marker used to start at the query's
 * current value, so data already cached when the page mounted looked as if it
 * had been copied and the copy stayed empty: Case Types, Categories and
 * Questions came up blank, and a provider's profile lost its specialties,
 * modes, booking links and phones, with Save enabled to write those blanks.
 *
 * It takes the production stale time to reproduce. With a stale time of 0 the
 * refetch on return delivers new objects, which hides the bug.
 */

const categoriesApi = vi.hoisted(() => ({
  getCategories: vi.fn(),
  getCategoryOfferingCounts: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  updateCategoryOrders: vi.fn(),
  archiveCategory: vi.fn(),
}))
vi.mock('../../src/lib/api/categories', () => categoriesApi)

const caseTypesApi = vi.hoisted(() => ({
  getCaseTypes: vi.fn(),
  getCaseTypeOfferingCounts: vi.fn(),
  createCaseType: vi.fn(),
  updateCaseType: vi.fn(),
  updateCaseTypeOrders: vi.fn(),
  updateCaseTypeMapTag: vi.fn(),
  archiveCaseType: vi.fn(),
  getArchivedCaseTypes: vi.fn(),
  restoreCaseType: vi.fn(),
  getCaseTypeProviders: vi.fn(),
}))
vi.mock('../../src/lib/api/caseTypes', () => caseTypesApi)

const questionsApi = vi.hoisted(() => ({
  archiveQuestion: vi.fn(),
  createQuestion: vi.fn(),
  ensureEntryQuestion: vi.fn(),
  getNextOrderRank: vi.fn(),
  getQuestions: vi.fn(),
  reorderQuestions: vi.fn(),
  updateQuestion: vi.fn(),
}))
vi.mock('../../src/lib/api/questions', () => questionsApi)

const providersApi = vi.hoisted(() => ({
  getProvider: vi.fn(),
  updateProvider: vi.fn(),
  archiveProvider: vi.fn(),
  uploadProviderImage: vi.fn(),
  removeProviderImage: vi.fn(),
}))
vi.mock('../../src/lib/api/providers', () => providersApi)

const providerLocationsApi = vi.hoisted(() => ({
  getProviderLocations: vi.fn(),
  upsertProviderLocation: vi.fn(),
}))
vi.mock('../../src/lib/api/providerLocations', () => providerLocationsApi)

const offeringsApi = vi.hoisted(() => ({
  getOfferingsByProvider: vi.fn(),
  getArchivedOfferingsByProvider: vi.fn(),
  createOffering: vi.fn(),
  updateOffering: vi.fn(),
  archiveOffering: vi.fn(),
  restoreOffering: vi.fn(),
}))
vi.mock('../../src/lib/api/offerings', () => offeringsApi)

vi.mock('../../src/lib/api/locations', () => ({ getLocations: vi.fn().mockResolvedValue([]) }))
vi.mock('../../src/lib/api/constraints', () => ({ getConstraints: vi.fn().mockResolvedValue([]) }))
vi.mock('../../src/components/testing/LogicTester', () => ({ default: () => null }))
vi.mock('../../src/components/ui/toastStore', () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }),
}))

// The provider profile reads these lists straight from supabase.
const tables = vi.hoisted<Record<string, unknown[]>>(() => ({
  categories: [{ id: 'cat1', name: 'Sports Medicine' }],
  locations: [{ id: 'loc1', name: 'Bel Air' }],
}))
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {}
      for (const op of ['select', 'eq', 'order', 'in']) {
        builder[op] = () => builder
      }
      builder.then = (ok: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok)
      return builder
    },
  },
}))

import CaseTypesPage from '../../src/pages/case-types/CaseTypesPage'
import CategoriesPage from '../../src/pages/categories/CategoriesPage'
import ProviderProfilePage from '../../src/pages/providers/ProviderProfilePage'
import QuestionsPage from '../../src/pages/questions/QuestionsPage'
import { useAuthStore } from '../../src/stores/authStore'

/** Renders a page, leaves it, and comes back with the same cache. */
async function leaveAndReturn(page: ReactElement, loaded: () => Promise<unknown>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } },
  })
  const tree = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/providers/p1']}>
        <Routes>
          <Route path="/providers/:id" element={page} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  const firstVisit = render(tree)
  await loaded()
  await waitFor(() => expect(client.isFetching()).toBe(0))
  firstVisit.unmount()
  render(tree)
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    org: { id: 'org1', name: 'Test Org' } as never,
    user: { id: 'u1', org_id: 'org1', name: 'Tester', email: 't@example.com' } as never,
  })
})

describe('returning to a page with cached data', () => {
  it('lists the categories', async () => {
    categoriesApi.getCategories.mockResolvedValue([{ id: 'cat1', name: 'Sports Medicine', sort_order: 0 }])
    categoriesApi.getCategoryOfferingCounts.mockResolvedValue({ cat1: 2 })

    await leaveAndReturn(<CategoriesPage />, () => screen.findByText('Sports Medicine'))

    expect(screen.getByText('Sports Medicine')).toBeInTheDocument()
    expect(categoriesApi.getCategories).toHaveBeenCalledTimes(1)
  })

  it('lists the case types', async () => {
    caseTypesApi.getCaseTypes.mockResolvedValue([{ id: 'ct1', name: 'Knee', sort_order: 0, map_tag: null }])
    caseTypesApi.getCaseTypeOfferingCounts.mockResolvedValue({ ct1: 2 })
    caseTypesApi.getArchivedCaseTypes.mockResolvedValue([])

    await leaveAndReturn(<CaseTypesPage />, () => screen.findByRole('region', { name: 'case types' }))

    expect(screen.getByRole('region', { name: 'case types' })).toHaveTextContent('Knee')
    expect(caseTypesApi.getCaseTypes).toHaveBeenCalled()
  })

  it('lists the questions in the flow', async () => {
    questionsApi.ensureEntryQuestion.mockResolvedValue({ error: null })
    questionsApi.getQuestions.mockResolvedValue([
      { id: 'entry', question_type: 'entry', question_text: 'Seeing us for?', order_rank: 0, system_config: {} },
      { id: 'q1', question_type: 'clinical', question_text: 'How old?', order_rank: 1, system_config: {} },
    ])

    await leaveAndReturn(<QuestionsPage />, () => screen.findByText('How old?'))

    expect(screen.getByText('How old?')).toBeInTheDocument()
    expect(screen.queryByText(/no questions added yet/i)).not.toBeInTheDocument()
  })

  it('fills the provider profile and has nothing to save', async () => {
    providersApi.getProvider.mockResolvedValue({
      id: 'p1',
      org_id: 'org1',
      name: 'Dr. Clough',
      subtitle: null,
      npi: null,
      email: null,
      bio_link: null,
      image_url: null,
      category_ids: ['cat1'],
      booking_mode: 'advanced',
      phone_mode: 'simple',
    })
    providerLocationsApi.getProviderLocations.mockResolvedValue([
      { location_id: 'loc1', booking_link: 'https://book.example/clough', phone: '4105550100' },
    ])
    offeringsApi.getOfferingsByProvider.mockResolvedValue([
      { id: 'o1', provider_id: 'p1', case_type_id: 'ct1', location_ids: ['loc1'], constraints: {} },
    ])
    offeringsApi.getArchivedOfferingsByProvider.mockResolvedValue([])

    await leaveAndReturn(
      <ProviderProfilePage />,
      () => screen.findByDisplayValue('https://book.example/clough'),
    )

    // The blank form this replaces had Save enabled, ready to overwrite these.
    expect(await screen.findByDisplayValue('https://book.example/clough')).toBeInTheDocument()
    expect(screen.getByDisplayValue('4105550100')).toBeInTheDocument()
    expect(screen.getByText('Sports Medicine')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    const modes = screen.getAllByRole('combobox').map((select) => (select as HTMLSelectElement).value)
    expect(modes).toEqual(expect.arrayContaining(['advanced', 'simple']))
  })
})
