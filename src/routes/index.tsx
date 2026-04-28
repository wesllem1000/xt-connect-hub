import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, createBrowserRouter, useSearchParams } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { Skeleton } from '@/components/ui/skeleton'
import { LoginPage } from '@/features/auth/LoginPage'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import { SignupPage } from '@/features/auth/SignupPage'
import { VerifyPage } from '@/features/auth/VerifyPage'
import { ClaimErrorBoundary } from '@/features/claim/components/ClaimErrorBoundary'
import { DispositivosPage } from '@/features/dispositivos/DispositivosPage'
import { useAuthStore } from '@/stores/auth'

// Lazy: páginas tocadas raramente ou que têm dependências grandes (admin,
// detail de dispositivo com MQTT live, claim com câmera/QR). Reduz o JS
// baixado no boot — usuário comum vê só /dispositivos.
const DispositivoDetailPage = lazy(() =>
  import('@/features/dispositivos/DispositivoDetailPage').then((m) => ({
    default: m.DispositivoDetailPage,
  })),
)
const AutomacoesPage = lazy(() =>
  import('@/features/automacoes/pages/AutomacoesPage').then((m) => ({
    default: m.AutomacoesPage,
  })),
)
const ConvitesPage = lazy(() =>
  import('@/features/convites/ConvitesPage').then((m) => ({
    default: m.ConvitesPage,
  })),
)
const AceitarConvitePage = lazy(() =>
  import('@/features/convites/AceitarConvitePage').then((m) => ({
    default: m.AceitarConvitePage,
  })),
)
const ClaimLandingPage = lazy(() =>
  import('@/features/claim/pages/ClaimLandingPage').then((m) => ({
    default: m.ClaimLandingPage,
  })),
)
const AdicionarDispositivoPage = lazy(() =>
  import('@/features/claim/pages/AdicionarDispositivoPage').then((m) => ({
    default: m.AdicionarDispositivoPage,
  })),
)
const AdminPage = lazy(() =>
  import('@/features/admin/AdminPage').then((m) => ({ default: m.AdminPage })),
)
const ClienteDetailPage = lazy(() =>
  import('@/features/admin/clientes/ClienteDetailPage').then((m) => ({
    default: m.ClienteDetailPage,
  })),
)
const ProdutoFichaPage = lazy(() =>
  import('@/features/admin-produtos/pages/ProdutoFichaPage').then((m) => ({
    default: m.ProdutoFichaPage,
  })),
)
const ProdutosListPage = lazy(() =>
  import('@/features/admin-produtos/pages/ProdutosListPage').then((m) => ({
    default: m.ProdutosListPage,
  })),
)

function PageLoading() {
  return (
    <div className="space-y-3 max-w-4xl">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

function L({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>
}

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
  { path: '/convites/aceitar', element: <L><AceitarConvitePage /></L> },
  {
    path: '/claim',
    element: <L><ClaimLandingPage /></L>,
    errorElement: <ClaimErrorBoundary />,
  },
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
        path: '/dispositivos/adicionar',
        element: <L><AdicionarDispositivoPage /></L>,
        errorElement: <ClaimErrorBoundary />,
      },
      { path: '/dispositivos/:id', element: <L><DispositivoDetailPage /></L> },
      { path: '/automacoes', element: <L><AutomacoesPage /></L> },
      { path: '/convites', element: <L><ConvitesPage /></L> },
      {
        path: '/admin',
        element: (
          <RequireAdmin>
            <L><AdminPage /></L>
          </RequireAdmin>
        ),
      },
      {
        path: '/admin/clientes/:id',
        element: (
          <RequireAdmin>
            <L><ClienteDetailPage /></L>
          </RequireAdmin>
        ),
      },
      {
        path: '/admin/produtos',
        element: (
          <RequireAdmin>
            <L><ProdutosListPage /></L>
          </RequireAdmin>
        ),
      },
      {
        path: '/admin/produtos/:id',
        element: (
          <RequireAdmin>
            <L><ProdutoFichaPage /></L>
          </RequireAdmin>
        ),
      },
    ],
  },
  { path: '*', element: <Navigate to="/dispositivos" replace /> },
])
