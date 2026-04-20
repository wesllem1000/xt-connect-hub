import { Navigate, createBrowserRouter } from 'react-router-dom'

import { LoginPage } from '@/features/auth/LoginPage'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { useAuthStore } from '@/stores/auth'

function LoginGate() {
  const isAuthed = useAuthStore((s) => Boolean(s.user && (s.accessToken || s.refreshToken)))
  if (isAuthed) return <Navigate to="/dashboard" replace />
  return <LoginPage />
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginGate /> },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute>
        <DashboardPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <DashboardPage />
      </ProtectedRoute>
    ),
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
])
