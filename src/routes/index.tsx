import { Navigate, createBrowserRouter } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { AdminPage } from '@/features/admin/AdminPage'
import { ClienteDetailPage } from '@/features/admin/clientes/ClienteDetailPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import { SignupPage } from '@/features/auth/SignupPage'
import { VerifyPage } from '@/features/auth/VerifyPage'
import { DispositivosPage } from '@/features/dispositivos/DispositivosPage'
import { useAuthStore } from '@/stores/auth'
import type { ReactNode } from 'react'

function LoginGate() {
  const isAuthed = useAuthStore((s) => Boolean(s.user && (s.accessToken || s.refreshToken)))
  if (isAuthed) return <Navigate to="/dispositivos" replace />
  return <LoginPage />
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const role = useAuthStore((s) => s.user?.role)
  if (role !== 'admin') return <Navigate to="/dispositivos" replace />
  return <>{children}</>
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginGate /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/verify', element: <VerifyPage /> },
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/dispositivos" replace /> },
      { path: '/dispositivos', element: <DispositivosPage /> },
      {
        path: '/admin',
        element: (
          <RequireAdmin>
            <AdminPage />
          </RequireAdmin>
        ),
      },
      {
        path: '/admin/clientes/:id',
        element: (
          <RequireAdmin>
            <ClienteDetailPage />
          </RequireAdmin>
        ),
      },
    ],
  },
  { path: '*', element: <Navigate to="/dispositivos" replace /> },
])
