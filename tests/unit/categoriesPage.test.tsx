import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Category } from '../../src/types/database'

/**
 * Behavioural baseline for CategoriesPage, mirroring caseTypesPage.test.tsx.
 *
 * CategoriesPage and CaseTypesPage are ~88% identical (same drag-reorder list,
 * same add/edit/archive modal flow). CaseTypes had a test suite pinning that
 * behaviour and Categories had none, so only half the shared pattern was
 * protected. These tests close that gap: they describe what a user can observe,
 * so the same assertions hold before and after the two pages are collapsed
 * onto a shared implementation.
 */

const category = (over: Partial<Category> = {}): Category =>
  ({
    id: 'cat1',
    org_id: 'org1',
    name: 'Sports Medicine',
    sort_order: 0,
    is_archived: false,
    created_at: '',
    updated_at: '',
    ...over,
  }) as Category

const api = vi.hoisted(() => ({
  getCategories: vi.fn(),
  getCategoryOfferingCounts: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  updateCategoryOrders: vi.fn(),
  archiveCategory: vi.fn(),
  getCategoryProviders: vi.fn(),
  removeCategory: vi.fn(),
}))

vi.mock('../../src/lib/api/categories', () => api)

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('../../src/components/ui/toastStore', () => ({ useToast: () => ({ toast }) }))

import CategoriesPage from '../../src/pages/categories/CategoriesPage'
import { useAuthStore } from '../../src/stores/authStore'

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CategoriesPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    org: { id: 'org1', name: 'Test Org' } as never,
    user: { id: 'u1', org_id: 'org1', name: 'Tester', email: 't@example.com' } as never,
  })
  api.getCategories.mockResolvedValue([
    category({ id: 'cat1', name: 'Sports Medicine', sort_order: 0 }),
    category({ id: 'cat2', name: 'Joint Replacement', sort_order: 1 }),
  ])
  api.getCategoryOfferingCounts.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, 0])),
  )
  api.createCategory.mockResolvedValue({ error: null })
  api.updateCategory.mockResolvedValue({ error: null })
  api.updateCategoryOrders.mockResolvedValue({ error: null })
  api.archiveCategory.mockResolvedValue({ error: null })
  api.getCategoryProviders.mockResolvedValue([])
  api.removeCategory.mockResolvedValue({ error: null, providersUpdated: 0 })
})

describe('CategoriesPage modal state', () => {
  it('opens the add dialog with an empty name field', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Sports Medicine')

    await user.click(screen.getByRole('button', { name: /add category/i }))

    expect(await screen.findByRole('textbox')).toHaveValue('')
  })

  it('opens the edit dialog prefilled with that row’s name', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Joint Replacement')

    const row = screen.getByText('Joint Replacement').closest('div') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /edit category/i }))

    expect(await screen.findByRole('textbox')).toHaveValue('Joint Replacement')
  })

  it('does not carry a typed value from one open to the next', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Sports Medicine')

    // Type into add, then close without saving.
    await user.click(screen.getByRole('button', { name: /add category/i }))
    await user.type(await screen.findByRole('textbox'), 'Discarded draft')
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    // Reopening must start clean, not show the discarded draft.
    await user.click(screen.getByRole('button', { name: /add category/i }))
    expect(await screen.findByRole('textbox')).toHaveValue('')
  })

  it('clears a validation error when the dialog is reopened', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Sports Medicine')

    // A single character trips the minimum-length check.
    await user.click(screen.getByRole('button', { name: /add category/i }))
    await user.type(await screen.findByRole('textbox'), 'x')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByText(/at least 2 characters/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    await user.click(screen.getByRole('button', { name: /add category/i }))

    await waitFor(() => {
      expect(screen.queryByText(/at least 2 characters/i)).not.toBeInTheDocument()
    })
  })

  it('rejects a name that duplicates an existing category', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Sports Medicine')

    await user.click(screen.getByRole('button', { name: /add category/i }))
    // Case-insensitive: the duplicate check lowercases both sides.
    await user.type(await screen.findByRole('textbox'), 'sports medicine')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
    expect(api.createCategory).not.toHaveBeenCalled()
  })

  it('renders rows in the order the query returned them', async () => {
    renderPage()
    await screen.findByText('Sports Medicine')

    const all = document.body.textContent ?? ''
    // Sports Medicine (sort_order 0) must precede Joint Replacement (1).
    expect(all.indexOf('Sports Medicine')).toBeLessThan(all.indexOf('Joint Replacement'))
    expect(screen.getAllByRole('button', { name: /edit category/i })).toHaveLength(2)
  })

  it('picks up a reordered list when the query data changes', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Sports Medicine')

    // Simulate the post-save refetch returning a new order.
    api.getCategories.mockResolvedValue([
      category({ id: 'cat2', name: 'Joint Replacement', sort_order: 0 }),
      category({ id: 'cat1', name: 'Sports Medicine', sort_order: 1 }),
    ])

    // Any mutation triggers invalidation; adding one is the simplest trigger.
    await user.click(screen.getByRole('button', { name: /add category/i }))
    await user.type(await screen.findByRole('textbox'), 'Hand Surgery')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      const all = document.body.textContent ?? ''
      expect(all.indexOf('Joint Replacement')).toBeLessThan(all.indexOf('Sports Medicine'))
    })
  })

  it('switching from edit straight to add clears the prefilled name', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Sports Medicine')

    const row = screen.getByText('Sports Medicine').closest('div') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /edit category/i }))
    expect(await screen.findByRole('textbox')).toHaveValue('Sports Medicine')

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    await user.click(screen.getByRole('button', { name: /add category/i }))

    expect(await screen.findByRole('textbox')).toHaveValue('')
  })

  it('saves an edit against the row that was opened', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Joint Replacement')

    const row = screen.getByText('Joint Replacement').closest('div') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /edit category/i }))

    const input = await screen.findByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Joint Reconstruction')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(api.updateCategory).toHaveBeenCalledWith('cat2', 'Joint Reconstruction')
    })
  })

  async function openRemove(user: ReturnType<typeof userEvent.setup>, name: string) {
    const row = screen.getByText(name).closest('div') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /remove category/i }))
  }

  it('removes the row whose remove button was clicked, after confirming', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Joint Replacement')

    await openRemove(user, 'Joint Replacement')
    expect(await screen.findByText('Joint Replacement is not on any providers.')).toBeInTheDocument()
    expect(api.removeCategory).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(api.removeCategory).toHaveBeenCalledWith('cat2', null))
    expect(api.archiveCategory).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Joint Replacement removed')
  })

  it('says how many providers the category is on and how many were updated', async () => {
    api.getCategoryProviders.mockResolvedValue([
      { id: 'p1', name: 'Dr. Adams' },
      { id: 'p2', name: 'Dr. Baker' },
    ])
    api.removeCategory.mockResolvedValue({ error: null, providersUpdated: 2 })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Joint Replacement')

    await openRemove(user, 'Joint Replacement')
    expect(await screen.findByText('Joint Replacement is on 2 providers.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Joint Replacement removed (2 providers updated)'),
    )
  })

  it('offers to merge a misspelled duplicate into the category it was meant to be', async () => {
    api.getCategories.mockResolvedValue([
      category({ id: 'cat1', name: 'Sports Medicine', sort_order: 0 }),
      category({ id: 'cat2', name: 'Joint Replacement', sort_order: 1 }),
      category({ id: 'cat3', name: 'Sports Medincine', sort_order: 2 }),
    ])
    api.getCategoryProviders.mockResolvedValue([{ id: 'p1', name: 'Dr. Adams' }])
    api.removeCategory.mockResolvedValue({ error: null, providersUpdated: 1 })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Sports Medincine')

    await openRemove(user, 'Sports Medincine')

    expect(await screen.findByText(/looks like a misspelling of sports medicine/i)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /merge into another category/i })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Merge into' })).toHaveValue('cat1')
    await user.click(screen.getByRole('button', { name: 'Merge into Sports Medicine' }))

    await waitFor(() => expect(api.removeCategory).toHaveBeenCalledWith('cat3', 'cat1'))
    expect(toast.success).toHaveBeenCalledWith(
      'Sports Medincine merged into Sports Medicine (1 provider updated)',
    )
  })

  it('removes without merging when asked to, and can merge into any other category', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Joint Replacement')

    await openRemove(user, 'Sports Medicine')
    // Nothing here looks like a misspelling, so it starts on plain removal.
    expect(screen.getByRole('radio', { name: /just remove it/i })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /merge into another category/i }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Merge into' }), 'cat2')
    await user.click(screen.getByRole('button', { name: 'Merge into Joint Replacement' }))

    await waitFor(() => expect(api.removeCategory).toHaveBeenCalledWith('cat1', 'cat2'))
  })

  it('keeps the dialog open and reports a failed removal', async () => {
    api.removeCategory.mockResolvedValue({ error: 'permission denied', providersUpdated: 0 })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Joint Replacement')

    await openRemove(user, 'Joint Replacement')
    await user.click(await screen.findByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('permission denied'))
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  it('will not remove while it cannot tell which providers use the category', async () => {
    api.getCategoryProviders.mockRejectedValue(new Error('Could not load the providers with this category'))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Joint Replacement')

    await openRemove(user, 'Joint Replacement')

    expect(await screen.findByText(/could not load the providers/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled()
  })
})

describe('CategoriesPage misspelling warning', () => {
  it('warns once about a name that is almost an existing one, and saves it when kept', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Sports Medicine')

    await user.click(screen.getByRole('button', { name: /add category/i }))
    await user.type(await screen.findByRole('textbox'), 'Sports Medincine')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This looks like “Sports Medicine”')
    expect(api.createCategory).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Save anyway' }))
    await waitFor(() => expect(api.createCategory).toHaveBeenCalledWith('org1', 'Sports Medincine'))
  })

  it('warns again if the name is changed to another near miss', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Sports Medicine')

    await user.click(screen.getByRole('button', { name: /add category/i }))
    const input = await screen.findByRole('textbox')
    await user.type(input, 'Sports Medincine')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await screen.findByRole('alert')

    await user.clear(input)
    await user.type(input, 'Joint Replacment')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This looks like “Joint Replacement”')
    expect(api.createCategory).not.toHaveBeenCalled()
  })

  it('saves an ordinary new name straight away', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Sports Medicine')

    await user.click(screen.getByRole('button', { name: /add category/i }))
    await user.type(await screen.findByRole('textbox'), 'Podiatry')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(api.createCategory).toHaveBeenCalledWith('org1', 'Podiatry'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not compare a category with itself when it is edited', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Joint Replacement')

    const row = screen.getByText('Joint Replacement').closest('div') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /edit category/i }))
    const input = await screen.findByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Joint Replacements')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(api.updateCategory).toHaveBeenCalledWith('cat2', 'Joint Replacements'))
  })
})
