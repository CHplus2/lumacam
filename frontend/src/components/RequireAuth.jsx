import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'

/** Pages that change things need an account; send visitors to log in, then back here. */
export default function RequireAuth({ children }) {
  const { loggedIn } = useAuth()
  const { pathname, search } = useLocation()
  if (!loggedIn) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />
  return children
}
