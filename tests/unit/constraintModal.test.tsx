import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ConstraintModal from '../../src/components/modals/ConstraintModal'

/**
 * The Add Constraint wizard's first step had only a "Next" button — no Cancel
 * and no close button — so the only way out was a backdrop click or Escape.
 */

function renderModal() {
  const onClose = vi.fn()
  const onSave = vi.fn()
  render(<ConstraintModal isOpen onClose={onClose} onSave={onSave} title="Add Constraint" orgId="org1" />)
  return { onClose, onSave }
}

describe('ConstraintModal', () => {
  it('can be cancelled from the first step', async () => {
    const user = userEvent.setup()
    const { onClose, onSave } = renderModal()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('has a close button in the header', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
