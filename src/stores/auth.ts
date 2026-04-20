import { create } from 'zustand'

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

const REFRESH_KEY = 'xtconect.refresh_token'
const USER_KEY = 'xtconect.user'

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
  clearSession: () => void
  isAuthenticated: () => boolean
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

  clearSession: () => {
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(USER_KEY)
    set({ accessToken: null, refreshToken: null, user: null })
  },

  isAuthenticated: () => {
    const s = get()
    return Boolean(s.user && (s.accessToken || s.refreshToken))
  },
}))
