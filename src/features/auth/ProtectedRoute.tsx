import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useAuthStore } from '@/stores/auth'

type Props = { children: ReactNode }

export function ProtectedRoute({ children }: Props) {
  const location = useLocation()
  const isAuthed = useAuthStore((s) => Boolean(s.user && (s.accessToken || s.refreshToken)))

  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <>{children}</>
}
