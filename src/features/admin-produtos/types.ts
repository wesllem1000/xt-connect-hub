export type ProdutoStatus = 'ocioso' | 'associado' | 'defeito' | 'retornado'

export type Produto = {
  id: string
  serial: string
  status: ProdutoStatus
  sequencial: number | null
  provisionado_em: string | null
  claimed_em: string | null
  owner_id: string | null
  nome: string | null
  is_online: boolean
  last_seen: string | null
  telemetry_interval_s: number
  burst_rate_s: number
  modelo_id: string | null
  modelo_nome: string | null
  prefixo: string | null
  major_version: string | null
  owner_email: string | null
  owner_nome: string | null
}

export type ProdutoDetalhe = Produto & {
  claim_token: string | null
  pairing_code: string | null
  claim_url?: string
}

export type Paginacao = {
  page: number
  limit: number
  total: number
  pages: number
}

export type ListaProdutosResponse = {
  produtos: Produto[]
  paginacao: Paginacao
}

export type ProvisionarInput = {
  modelo_id: string
}

export type MqttInfo = {
  host: string
  ws: string
  username: string
  password: string
}

export type ProvisionarResponse = {
  id: string
  serial: string
  modelo_id: string
  modelo_nome: string
  sequencial: number
  status: ProdutoStatus
  pairing_code: string
  claim_token: string
  claim_url: string
  mqtt: MqttInfo
}

export type ResetProdutoResponse = {
  produto: ProdutoDetalhe
}

export type Filtros = {
  status?: ProdutoStatus | 'todos'
  modelo_id?: string
  search?: string
  page?: number
}
