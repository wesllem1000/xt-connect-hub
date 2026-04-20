import ky, { HTTPError } from 'ky'
import { useAuthStore } from '@/stores/auth'

let refreshPromise: Promise<string> | null = null

async function getRefreshedToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = useAuthStore
      .getState()
      .refresh()
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

function isAuthEndpoint(url: string): boolean {
  const p = new URL(url).pathname
  return p.endsWith('/auth/login') || p.endsWith('/auth/refresh')
}

function forceLogout() {
  useAuthStore.getState().clearSession()
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login')
  }
}

export const api = ky.create({
  prefixUrl: '/api',
  timeout: 15000,
  retry: 0,
  hooks: {
    beforeRequest: [
      (request) => {
        const token = useAuthStore.getState().accessToken
        if (token) request.headers.set('Authorization', `Bearer ${token}`)
      },
    ],
    afterResponse: [
      async (request, options, response) => {
        if (response.status !== 401) return response
        if (isAuthEndpoint(response.url)) return response
        if (request.headers.get('x-retry') === '1') {
          forceLogout()
          return response
        }

        try {
          const newToken = await getRefreshedToken()
          request.headers.set('Authorization', `Bearer ${newToken}`)
          request.headers.set('x-retry', '1')
          return ky(request, options)
        } catch {
          forceLogout()
          return response
        }
      },
    ],
  },
})

export async function extractApiError(err: unknown, fallback = 'Erro inesperado'): Promise<string> {
  if (err instanceof HTTPError) {
    try {
      const body = (await err.response.clone().json()) as { error?: string; message?: string }
      return body.error || body.message || fallback
    } catch {
      return fallback
    }
  }
  if (err instanceof Error) return err.message
  return fallback
}
