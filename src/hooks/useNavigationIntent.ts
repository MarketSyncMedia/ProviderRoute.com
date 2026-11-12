import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export type NavigationIntent = 'add-provider' | 'create-widget'

/** Router state for `navigate(path, { state: intentState('add-provider') })`. */
export const intentState = (intent: NavigationIntent) => ({ intent })

/**
 * True on the render where the page was reached with `intent` in router state,
 * e.g. a dashboard shortcut asking the page to open its add form. The state is
 * cleared straight away so a refresh or Back does not reopen the form.
 */
export function useNavigationIntent(intent: NavigationIntent): boolean {
  const location = useLocation()
  const navigate = useNavigate()
  const requested = (location.state as { intent?: string } | null)?.intent === intent
  const [arrivedWithIntent] = useState(requested)

  useEffect(() => {
    if (requested) {
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [requested, navigate, location.pathname])

  return arrivedWithIntent
}
