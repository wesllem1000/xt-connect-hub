import { create } from 'zustand'
import ky, { HTTPError } from 'ky'

export type User = {
  id: string
  email: string
  name: string | null
  role: 'user' | 'admin' | 'instalador'
}

type LoginResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  user: User
}

type RefreshResponse = {
  access_token: string
  expires_in: number
}

const REFRESH_KEY = 'xtconect.refresh_token'
const USER_KEY = 'xtconect.user'

const API_ERROR_PT: Record<string, string> = {
  'invalid credentials': 'E-mail ou senha incorretos',
  'missing credentials': 'Preencha e-mail e senha',
  'user not found': 'Usuário não encontrado',
  'user inactive': 'Usuário desativado',
}

const NETWORK_ERROR_PT = 'Falha de conexão com o servidor.'
const GENERIC_ERROR_PT = 'Erro ao entrar. Tente novamente.'

function readPersistedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

function readPersistedRefresh(): string | null {
  return localStorage.getItem(REFRESH_KEY)
}

type AuthState = {
  accessToken: string | null
  refreshToken: string | null
  user: User | null
  setSession: (data: LoginResponse) => void
  setAccessToken: (token: string) => void
  clearSession: () => void
  isAuthenticated: () => boolean
  login: (email: string, password: string) => Promise<void>
  refresh: () => Promise<string>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  refreshToken: readPersistedRefresh(),
  user: readPersistedUser(),

  setSession: (data) => {
    localStorage.setItem(REFRESH_KEY, data.refresh_token)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: data.user,
    })
  },

  setAccessToken: (token) => set({ accessToken: token }),

  clearSession: () => {
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(USER_KEY)
    set({ accessToken: null, refreshToken: null, user: null })
  },

  isAuthenticated: () => {
    const s = get()
    return Boolean(s.user && (s.accessToken || s.refreshToken))
  },

  login: async (email, password) => {
    try {
      const data = await ky
        .post('/api/auth/login', {
          json: { email, password },
          timeout: 15000,
          retry: 0,
        })
        .json<LoginResponse>()
      get().setSession(data)
    } catch (err) {
      if (err instanceof HTTPError) {
        let raw = ''
        try {
          const body = (await err.response.clone().json()) as {
            error?: string
            message?: string
          }
          raw = (body.error || body.message || '').toLowerCase().trim()
        } catch {
          raw = ''
        }
        const msg = API_ERROR_PT[raw] ?? GENERIC_ERROR_PT
        throw new Error(msg)
      }
      throw new Error(NETWORK_ERROR_PT)
    }
  },

  refresh: async () => {
    const token = get().refreshToken
    if (!token) throw new Error('no refresh token')
    const data = await ky
      .post('/api/auth/refresh', {
        json: { refresh_token: token },
        timeout: 15000,
        retry: 0,
      })
      .json<RefreshResponse>()
    set({ accessToken: data.access_token })
    return data.access_token
  },
}))
