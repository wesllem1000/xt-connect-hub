import ky, { HTTPError } from 'ky'
import { useAuthStore } from '@/stores/auth'

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
      async (_request, _options, response) => {
        if (response.status !== 401) return response
        const url = new URL(response.url)
        if (url.pathname.endsWith('/auth/login')) return response

        useAuthStore.getState().clearSession()
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.assign('/login')
        }
        return response
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
