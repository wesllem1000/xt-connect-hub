import { Navigate, createBrowserRouter } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { AdminPage } from '@/features/admin/AdminPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import { DispositivosPage } from '@/features/dispositivos/DispositivosPage'
import { useAuthStore } from '@/stores/auth'

function LoginGate() {
  const isAuthed = useAuthStore((s) => Boolean(s.user && (s.accessToken || s.refreshToken)))
  if (isAuthed) return <Navigate to="/dispositivos" replace />
  return <LoginPage />
}

function AdminRoute() {
  const role = useAuthStore((s) => s.user?.role)
  if (role !== 'admin') return <Navigate to="/dispositivos" replace />
  return <AdminPage />
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginGate /> },
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/dispositivos" replace /> },
      { path: '/dispositivos', element: <DispositivosPage /> },
      { path: '/admin', element: <AdminRoute /> },
    ],
  },
  { path: '*', element: <Navigate to="/dispositivos" replace /> },
])
