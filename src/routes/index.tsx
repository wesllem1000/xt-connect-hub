import { Navigate, createBrowserRouter, useSearchParams } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { AdminPage } from '@/features/admin/AdminPage'
import { ClienteDetailPage } from '@/features/admin/clientes/ClienteDetailPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import { SignupPage } from '@/features/auth/SignupPage'
import { VerifyPage } from '@/features/auth/VerifyPage'
import { AceitarConvitePage } from '@/features/convites/AceitarConvitePage'
import { ConvitesPage } from '@/features/convites/ConvitesPage'
import { DispositivoDetailPage } from '@/features/dispositivos/DispositivoDetailPage'
import { DispositivosPage } from '@/features/dispositivos/DispositivosPage'
import { ProdutoFichaPage } from '@/features/admin-produtos/pages/ProdutoFichaPage'
import { ProdutosListPage } from '@/features/admin-produtos/pages/ProdutosListPage'
import { useAuthStore } from '@/stores/auth'
import type { ReactNode } from 'react'

function safeNext(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}

function LoginGate() {
  const isAuthed = useAuthStore((s) => Boolean(s.user && (s.accessToken || s.refreshToken)))
  const [params] = useSearchParams()
  if (isAuthed) {
    const next = safeNext(params.get('next'))
    return <Navigate to={next ?? '/dispositivos'} replace />
  }
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
  { path: '/convites/aceitar', element: <AceitarConvitePage /> },
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/dispositivos" replace /> },
      { path: '/dispositivos', element: <DispositivosPage /> },
      { path: '/dispositivos/:id', element: <DispositivoDetailPage /> },
      { path: '/convites', element: <ConvitesPage /> },
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
      {
        path: '/admin/produtos',
        element: (
          <RequireAdmin>
            <ProdutosListPage />
          </RequireAdmin>
        ),
      },
      {
        path: '/admin/produtos/:id',
        element: (
          <RequireAdmin>
            <ProdutoFichaPage />
          </RequireAdmin>
        ),
      },
    ],
  },
  { path: '*', element: <Navigate to="/dispositivos" replace /> },
])
