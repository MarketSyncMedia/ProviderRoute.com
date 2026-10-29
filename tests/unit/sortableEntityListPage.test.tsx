import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaseType, Category } from '../../src/types/database'

/**
 * Edge-case coverage for SortableEntityListPage, the shared implementation
 * behind CategoriesPage and CaseTypesPage.
 *
 * The behavioural suites (caseTypesPage/categoriesPage) cover the happy paths.
 * This one covers what a real tenant eventually does to it: hundreds of rows,
 * non-Latin and markup-shaped names, API failures, double-clicks, rapid modal
 * cycling, and -- since the two pages share one component and one cache -- that
 * their query caches stay isolated from each other and across orgs.
 */

const catApi = vi.hoisted(() => ({
  getCategories: vi.fn(),
  getCategoryOfferingCounts: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  updateCategoryOrders: vi.fn(),
  archiveCategory: vi.fn(),
}))
const ctApi = vi.hoisted(() => ({
  getCaseTypes: vi.fn(),
  getCaseTypeOfferingCounts: vi.fn(),
  createCaseType: vi.fn(),
  updateCaseType: vi.fn(),
  updateCaseTypeOrders: vi.fn(),
  archiveCaseType: vi.fn(),
  getArchivedCaseTypes: vi.fn(async () => []),
}))
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))

vi.mock('../../src/lib/api/categories', () => catApi)
vi.mock('../../src/lib/api/caseTypes', () => ctApi)
vi.mock('../../src/components/ui/toastStore', () => ({ useToast: () => ({ toast: toastSpy }) }))

import CategoriesPage from '../../src/pages/categories/CategoriesPage'
import CaseTypesPage from '../../src/pages/case-types/CaseTypesPage'
import { useAuthStore } from '../../src/stores/authStore'

const cat = (o: Partial<Category> = {}): Category =>
  ({
    id: 'cat1',
    org_id: 'org1',
    name: 'Sports Medicine',
    sort_order: 0,
    is_archived: false,
    created_at: '',
    updated_at: '',
    ...o,
  }) as Category

let client: QueryClient
function renderPage(P: React.ComponentType) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <P />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    org: { id: 'org1', name: 'Test Org' } as never,
    user: { id: 'u1', org_id: 'org1', name: 'T', email: 't@e.com' } as never,
  })
  catApi.getCategories.mockResolvedValue([
    cat({ id: 'cat1', name: 'Sports Medicine', sort_order: 0 }),
  ])
  catApi.getCategoryOfferingCounts.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, 0])),
  )
  catApi.createCategory.mockResolvedValue({ error: null })
  catApi.updateCategory.mockResolvedValue({ error: null })
  catApi.updateCategoryOrders.mockResolvedValue({ error: null })
  catApi.archiveCategory.mockResolvedValue({ error: null })
  ctApi.getCaseTypes.mockResolvedValue([
    {
      id: 'ct1',
      org_id: 'org1',
      name: 'Knee Pain',
      sort_order: 0,
      is_archived: false,
      created_at: '',
      updated_at: '',
    } as CaseType,
  ])
  ctApi.getCaseTypeOfferingCounts.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, 0])),
  )
  ctApi.createCaseType.mockResolvedValue({ error: null })
  ctApi.updateCaseType.mockResolvedValue({ error: null })
  ctApi.updateCaseTypeOrders.mockResolvedValue({ error: null })
  ctApi.archiveCaseType.mockResolvedValue({ error: null })
})

describe('scale', () => {
  it('renders 500 rows without falling over', async () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      cat({ id: `c${i}`, name: `Category ${i}`, sort_order: i }),
    )
    catApi.getCategories.mockResolvedValue(many)
    const t0 = Date.now()
    renderPage(CategoriesPage)
    await screen.findByText('Category 499')
    const ms = Date.now() - t0
    expect(screen.getAllByRole('button', { name: /edit category/i })).toHaveLength(500)
    // Guard against a regression that makes this pathological rather than slow.
    expect(ms).toBeLessThan(15_000)
  })

  it('fetches offering counts for the whole list in one call, not one per row', async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      cat({ id: `c${i}`, name: `Category ${i}`, sort_order: i }),
    )
    catApi.getCategories.mockResolvedValue(many)
    renderPage(CategoriesPage)
    await screen.findByText('Category 119')
    // Guards the N+1 fix: this used to issue one request per row (two, for
    // categories), so a large tenant fired hundreds on every page load.
    expect(catApi.getCategoryOfferingCounts).toHaveBeenCalledTimes(1)
    expect(catApi.getCategoryOfferingCounts.mock.calls[0][0]).toHaveLength(120)
  })
})

describe('adversarial names', () => {
  it.each([
    ['unicode', 'Ортопедия Плечо'],
    ['emoji', 'Knee 🦵 Pain'],
    ['rtl', 'العظام'],
    ['html-ish', '<script>alert(1)</script>'],
    ['quotes', 'OBrien "Special" & Co'],
  ])('accepts a %s name and renders it as text', async (_label, name) => {
    const user = userEvent.setup()
    renderPage(CategoriesPage)
    await screen.findByText('Sports Medicine')
    await user.click(screen.getByRole('button', { name: /add category/i }))
    await user.type(await screen.findByRole('textbox'), name)
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(catApi.createCategory).toHaveBeenCalled())
    expect(document.querySelector('script')).toBeNull()
  })

  it('sends a very long name straight through (no max length enforced)', async () => {
    const user = userEvent.setup()
    renderPage(CategoriesPage)
    await screen.findByText('Sports Medicine')
    await user.click(screen.getByRole('button', { name: /add category/i }))
    const input = await screen.findByRole('textbox')
    await user.click(input)
    await user.paste('A'.repeat(5000))
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(catApi.createCategory).toHaveBeenCalled())
    const sent = catApi.createCategory.mock.calls[0][1] as string
    expect(sent.length).toBe(5000)
  })

  it('rejects whitespace-only and detects whitespace/case duplicates', async () => {
    const user = userEvent.setup()
    renderPage(CategoriesPage)
    await screen.findByText('Sports Medicine')

    await user.click(screen.getByRole('button', { name: /add category/i }))
    await user.type(await screen.findByRole('textbox'), '     ')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument()

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '   SPORTS medicine   ')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
    expect(catApi.createCategory).not.toHaveBeenCalled()
  })

  it('lets a row keep its own name when edited (no false duplicate)', async () => {
    const user = userEvent.setup()
    renderPage(CategoriesPage)
    await screen.findByText('Sports Medicine')
    const row = screen.getByText('Sports Medicine').closest('div') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /edit category/i }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(catApi.updateCategory).toHaveBeenCalledWith('cat1', 'Sports Medicine'))
  })
})

describe('error paths', () => {
  it('surfaces a create error in the dialog and keeps it open', async () => {
    const user = userEvent.setup()
    catApi.createCategory.mockResolvedValue({ error: 'duplicate key violates constraint' })
    renderPage(CategoriesPage)
    await screen.findByText('Sports Medicine')
    await user.click(screen.getByRole('button', { name: /add category/i }))
    await user.type(await screen.findByRole('textbox'), 'Hand Surgery')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/duplicate key/i)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('toasts an archive error and leaves the row in place', async () => {
    const user = userEvent.setup()
    catApi.archiveCategory.mockResolvedValue({ error: 'FK constraint' })
    renderPage(CategoriesPage)
    await screen.findByText('Sports Medicine')
    const row = screen.getByText('Sports Medicine').closest('div') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /archive category/i }))
    await user.click(await screen.findByRole('button', { name: /^archive$/i }))
    await waitFor(() => expect(toastSpy.error).toHaveBeenCalledWith('FK constraint'))
    expect(screen.getByText('Sports Medicine')).toBeInTheDocument()
  })

  it('does not create anything when the org is missing', async () => {
    const user = userEvent.setup()
    useAuthStore.setState({ org: null as never, user: null as never })
    renderPage(CategoriesPage)
    await user.click((await screen.findAllByRole('button', { name: /add category/i }))[0])
    await user.type(await screen.findByRole('textbox'), 'Orphan')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/organization not found/i)).toBeInTheDocument()
    expect(catApi.createCategory).not.toHaveBeenCalled()
  })

  it('recovers when the list query itself rejects', async () => {
    catApi.getCategories.mockRejectedValue(new Error('network down'))
    renderPage(CategoriesPage)
    // Must not crash; the empty state is the acceptable outcome.
    await waitFor(() => {
      expect(screen.queryByText(/loading categories/i)).not.toBeInTheDocument()
    })
    expect(screen.getAllByRole('button', { name: /add category/i }).length).toBeGreaterThan(0)
  })
})

describe('races', () => {
  it('does not double-create when save is clicked twice fast', async () => {
    const user = userEvent.setup()
    let resolve!: (v: { error: null }) => void
    catApi.createCategory.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    renderPage(CategoriesPage)
    await screen.findByText('Sports Medicine')
    await user.click(screen.getByRole('button', { name: /add category/i }))
    await user.type(await screen.findByRole('textbox'), 'Hand Surgery')
    const save = screen.getByRole('button', { name: /^save$/i })
    await user.click(save)
    await user.click(save).catch(() => {})
    resolve({ error: null })
    await waitFor(() => expect(catApi.createCategory).toHaveBeenCalledTimes(1))
  })

  it('survives rapid open/close cycling', async () => {
    const user = userEvent.setup()
    renderPage(CategoriesPage)
    await screen.findByText('Sports Medicine')
    for (let i = 0; i < 25; i++) {
      await user.click(screen.getByRole('button', { name: /add category/i }))
      await user.click(screen.getByRole('button', { name: /cancel/i }))
    }
    await user.click(screen.getByRole('button', { name: /add category/i }))
    expect(await screen.findByRole('textbox')).toHaveValue('')
  })

  it('restores body scroll after the modal closes', async () => {
    const user = userEvent.setup()
    renderPage(CategoriesPage)
    await screen.findByText('Sports Medicine')
    await user.click(screen.getByRole('button', { name: /add category/i }))
    expect(document.body.style.overflow).toBe('hidden')
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(document.body.style.overflow).toBe(''))
  })

  it('closes the dialog on Escape', async () => {
    const user = userEvent.setup()
    renderPage(CategoriesPage)
    await screen.findByText('Sports Medicine')
    await user.click(screen.getByRole('button', { name: /add category/i }))
    await screen.findByRole('textbox')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
  })
})

describe('cache isolation', () => {
  it('keeps categories and case-types caches separate when both mount', async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <CategoriesPage />
        <CaseTypesPage />
      </QueryClientProvider>,
    )
    await screen.findByText('Sports Medicine')
    await within(await screen.findByRole('region', { name: 'case types' })).findByText('Knee Pain')

    const catRows = client.getQueryData<{ entity: Category }[]>(['categories-with-counts', 'org1'])
    const ctRows = client.getQueryData<{ entity: CaseType }[]>(['case-types-with-counts', 'org1'])
    expect(catRows?.[0].entity.name).toBe('Sports Medicine')
    expect(ctRows?.[0].entity.name).toBe('Knee Pain')

    for (const k of [
      ['categories', 'org1'],
      ['case-types', 'org1'],
    ]) {
      const plain = client.getQueryData<unknown[]>(k)
      if (plain) {
        for (const r of plain) {
          expect(r).not.toHaveProperty('offeringCount')
        }
      }
    }
  })

  it('does not leak one org rows into another after an org switch', async () => {
    renderPage(CategoriesPage)
    await screen.findByText('Sports Medicine')

    catApi.getCategories.mockResolvedValue([cat({ id: 'z1', name: 'Other Org Cat', sort_order: 0 })])
    useAuthStore.setState({ org: { id: 'org2', name: 'Other' } as never })

    await screen.findByText('Other Org Cat')
    expect(screen.queryByText('Sports Medicine')).not.toBeInTheDocument()
  })
})
