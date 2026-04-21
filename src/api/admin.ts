import { api } from '@/lib/api'

export type Cliente = {
  id: string
  email: string
  nome: string | null
  email_verified: boolean
  is_active: boolean
  criado_em: string
  total_dispositivos: number
}

export type DispositivoDoCliente = {
  id: string
  nome: string
  serial: string
  modelo: string | null
  owner_id: string
  admin_access_level: 'none' | 'maintenance' | 'full'
  criado_em: string
  online: boolean
  last_seen_at: string | null
}

export type ClienteDetalhe = {
  id: string
  email: string
  nome: string | null
  role: 'cliente'
  email_verified: boolean
  is_active: boolean
  criado_em: string
  dispositivos: DispositivoDoCliente[]
}

export type CreateClienteInput = {
  email: string
  full_name: string
  senha_temporaria?: string
}

export type CreateClienteResponse = {
  user: {
    id: string
    email: string
    nome: string | null
    role: 'cliente'
    email_verified: boolean
    is_active: boolean
    criado_em: string
  }
  senha_temporaria: string
  senha_gerada: boolean
}

export function listClientes(): Promise<Cliente[]> {
  return api.get('admin/clientes').json<Cliente[]>()
}

export function getCliente(id: string): Promise<ClienteDetalhe> {
  return api.get(`admin/clientes/${id}`).json<ClienteDetalhe>()
}

export function createCliente(
  data: CreateClienteInput,
): Promise<CreateClienteResponse> {
  const payload: Record<string, unknown> = {
    email: data.email.trim().toLowerCase(),
    full_name: data.full_name.trim(),
  }
  if (data.senha_temporaria && data.senha_temporaria.trim()) {
    payload.senha_temporaria = data.senha_temporaria
  }
  return api.post('admin/clientes', { json: payload }).json<CreateClienteResponse>()
}
