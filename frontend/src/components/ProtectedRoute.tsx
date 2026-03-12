import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { hasValidAccessToken } from '../lib/auth'

export function ProtectedRoute() {
  const location = useLocation()

  if (!hasValidAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
