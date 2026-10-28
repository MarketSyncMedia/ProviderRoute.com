import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Organization } from '../../src/types/database'

/**
 * Production's domain list held `localhost`, saved before the full-domain rule
 * existed. The rule then rejected the whole list on every save, so *nothing*
 * on the organization form could be saved, and the only feedback was a
 * short-lived toast that didn't say which line was wrong. Adding
 * towsonortho.com for launch failed exactly that way.
 */

const update = vi.hoisted(() => vi.fn())

// Chainable stand-in for the supabase-js builder; `update` records the payload.
function makeQueryBuilder(table: string) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = chain
  builder.eq = chain
  builder.order = chain
  builder.in = chain
  builder.update = (payload: Record<string, unknown>) => {
    update(table, payload)
    return builder
  }
  builder.single = () =>
    Promise.resolve({ data: { ...org, ...(update.mock.lastCall?.[1] ?? {}) }, error: null })
  builder.then = (onfulfilled?: ((v: unknown) => unknown) | null) =>
    Promise.resolve({ data: [], error: null }).then(onfulfilled)
  return builder
}

vi.mock('../../src/lib/supabase', () => ({
  supabase: { from: vi.fn((table: string) => makeQueryBuilder(table)) },
}))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('../../src/components/ui/toastStore', () => ({ useToast: () => ({ toast }) }))

import SettingsPage from '../../src/pages/settings/SettingsPage'
import { useAuthStore } from '../../src/stores/authStore'

const org = {
  id: 'org1',
  name: 'Towson Orthopaedic Associates',
  fallback_phone: '4103377900',
  fallback_message: 'Please call us.',
  allowed_domains: ['toa-website-pied.vercel.app', 'localhost'],
  default_booking_mode: 'simple',
  default_phone_mode: 'simple',
} as unknown as Organization

const domainsField = () => screen.getByLabelText('Allowed Embed Domains')
const saveButton = () => screen.getByRole('button', { name: 'Save Organization Settings' })

describe('Settings allowed domains', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      org,
      user: { id: 'u1', org_id: 'org1', role: 'owner', name: 'Liam', email: 'l@example.com' } as never,
    })
  })

  it('names a stored invalid entry as soon as the page loads, before any save', async () => {
    render(<SettingsPage />)
    await waitFor(() => expect(domainsField()).toHaveValue('toa-website-pied.vercel.app\nlocalhost'))
    expect(screen.getByRole('alert')).toHaveTextContent('"localhost" isn\'t a full domain')
    expect(domainsField()).toHaveAttribute('aria-invalid', 'true')
  })

  it('blocks the save with that message instead of failing quietly', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)
    await waitFor(() => expect(domainsField()).toHaveValue('toa-website-pied.vercel.app\nlocalhost'))

    await user.type(domainsField(), '\ntowsonortho.com')
    await user.click(saveButton())

    expect(update).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('"localhost"')
  })

  it('saves once the invalid entry is removed', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)
    await waitFor(() => expect(domainsField()).toHaveValue('toa-website-pied.vercel.app\nlocalhost'))

    await user.clear(domainsField())
    await user.type(domainsField(), 'toa-website-pied.vercel.app\nhttps://towsonortho.com/')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(saveButton())

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        'organizations',
        expect.objectContaining({ allowed_domains: ['toa-website-pied.vercel.app', 'towsonortho.com'] }),
      ),
    )
    expect(toast.success).toHaveBeenCalledWith('Settings saved')
  })
})
