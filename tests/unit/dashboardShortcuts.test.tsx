import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The dashboard's "Add Provider" and "Create Widget" quick actions only
 * navigated to the list page, leaving the admin to find the button again.
 * They now ask that page to open its form on arrival, once — the request is
 * cleared so a refresh or Back doesn't reopen it.
 */

vi.mock('../../src/lib/api/providers', () => ({
  getProviders: vi.fn().mockResolvedValue([]),
  createProvider: vi.fn(),
}))
vi.mock('../../src/lib/api/widgets', () => ({
  getWidgets: vi.fn().mockResolvedValue([]),
  createWidget: vi.fn(),
}))
vi.mock('../../src/components/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../../src/components/ui/toastStore', () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }),
}))

function makeQueryBuilder(result: { data: unknown; error: unknown; count?: number }) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = chain
  builder.eq = chain
  builder.order = chain
  builder.in = chain
  builder.neq = chain
  builder.then = (
    onfulfilled?: ((v: typeof result) => unknown) | null,
    onrejected?: ((e: unknown) => unknown) | null,
  ) => Promise.resolve(result).then(onfulfilled, onrejected)
  return builder
}
vi.mock('../../src/lib/supabase', () => ({
  supabase: { from: vi.fn(() => makeQueryBuilder({ data: [], error: null, count: 0 })) },
}))

import DashboardPage from '../../src/pages/dashboard/DashboardPage'
import ProvidersPage from '../../src/pages/providers/ProvidersPage'
import WidgetsPage from '../../src/pages/widgets/WidgetsPage'
import { useAuthStore } from '../../src/stores/authStore'

let lastState: unknown = 'unset'
function StateProbe() {
  lastState = useLocation().state
  return null
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/providers" element={<><ProvidersPage /><StateProbe /></>} />
          <Route path="/widgets" element={<><WidgetsPage /><StateProbe /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('dashboard quick actions', () => {
  beforeEach(() => {
    lastState = 'unset'
    useAuthStore.setState({
      org: { id: 'org1', name: 'TOA' } as never,
      user: { id: 'u1', full_name: 'Liam' } as never,
    })
  })

  it('"Add Provider" lands on Providers with the add form open, then clears the request', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: /add provider/i }))

    expect(await screen.findByRole('heading', { name: 'Add Provider' })).toBeInTheDocument()
    await waitFor(() => expect(lastState).toBeNull())
  })

  it('"Create Widget" lands on Widgets with the create form open', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: /create widget/i }))

    expect(await screen.findByRole('heading', { name: 'Create Widget' })).toBeInTheDocument()
  })
})
