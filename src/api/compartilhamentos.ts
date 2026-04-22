import { api } from '@/lib/api'
import type { SharePermissao } from '@/api/dispositivos'

export type ShareStatus = 'ativo' | 'pendente' | 'revogado'

export type Compartilhamento = {
  id: string
  email_convidado: string
  permissao: SharePermissao
  status: ShareStatus
  criado_em: string
  aceito_em: string | null
  revogado_em: string | null
  user_id: string | null
  user_nome: string | null
}

export type CreateShareInput = {
  email: string
  permissao: SharePermissao
}

export type CreateShareResponse = {
  compartilhamento: {
    id: string
    dispositivo_id: string
    com_usuario_id: string | null
    permissao: SharePermissao
    email_convidado: string
    status: ShareStatus
    token_convite: string | null
    criado_em: string
    aceito_em: string | null
  }
  email_sent: boolean
  warning?: string
}

export type InboxPending = {
  id: string
  token: string
  permissao: SharePermissao
  email_convidado: string
  criado_em: string
  dispositivo_id: string
  dispositivo_nome: string
  serial: string
  dono_email: string
  dono_nome: string | null
}

export type InboxActive = {
  id: string
  permissao: SharePermissao
  aceito_em: string | null
  criado_em: string
  dispositivo_id: string
  dispositivo_nome: string
  serial: string
  dono_email: string
  dono_nome: string | null
}

export type InboxResponse = {
  pendentes: InboxPending[]
  ativos: InboxActive[]
}

export type AcceptShareResponse = {
  compartilhamento: {
    id: string
    dispositivo_id: string
    com_usuario_id: string
    permissao: SharePermissao
    email_convidado: string
    status: ShareStatus
    criado_em: string
    aceito_em: string
  }
  dispositivo: {
    id: string
    nome: string
    serial: string
  }
}

export async function createShare(
  dispositivoId: string,
  input: CreateShareInput,
): Promise<CreateShareResponse> {
  return api
    .post(`dispositivos/${dispositivoId}/compartilhamentos`, { json: input })
    .json<CreateShareResponse>()
}

export async function listShares(
  dispositivoId: string,
): Promise<Compartilhamento[]> {
  const { compartilhamentos } = await api
    .get(`dispositivos/${dispositivoId}/compartilhamentos`)
    .json<{ compartilhamentos: Compartilhamento[] }>()
  return compartilhamentos
}

export async function revokeShare(
  dispositivoId: string,
  shareId: string,
): Promise<void> {
  await api
    .delete(`dispositivos/${dispositivoId}/compartilhamentos/${shareId}`)
    .json<{ ok: true; id: string }>()
}

export async function inbox(): Promise<InboxResponse> {
  return api.get('compartilhamentos/inbox').json<InboxResponse>()
}

export async function acceptShare(token: string): Promise<AcceptShareResponse> {
  return api
    .post('compartilhamentos/aceitar', { json: { token } })
    .json<AcceptShareResponse>()
}
