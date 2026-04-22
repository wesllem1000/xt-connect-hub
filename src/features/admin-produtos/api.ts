import { api } from '@/lib/api'
import type {
  ListaProdutosResponse,
  ProdutoDetalhe,
  ProvisionarInput,
  ProvisionarResponse,
  ResetProdutoResponse,
} from './types'

export async function listProdutos(params: {
  status?: string
  modelo_id?: string
  page?: number
  limit?: number
}): Promise<ListaProdutosResponse> {
  const searchParams = new URLSearchParams()
  if (params.status && params.status !== 'todos')
    searchParams.set('status', params.status)
  if (params.modelo_id) searchParams.set('modelo_id', params.modelo_id)
  if (params.page) searchParams.set('page', String(params.page))
  if (params.limit) searchParams.set('limit', String(params.limit))
  const qs = searchParams.toString()
  return api
    .get('admin/produtos' + (qs ? '?' + qs : ''))
    .json<ListaProdutosResponse>()
}

export async function getProduto(id: string): Promise<ProdutoDetalhe> {
  const { produto } = await api
    .get(`admin/produtos/${id}`)
    .json<{ produto: ProdutoDetalhe }>()
  return produto
}

export async function provisionarProduto(
  input: ProvisionarInput,
): Promise<ProvisionarResponse> {
  return api
    .post('admin/produtos/provisionar', { json: input })
    .json<ProvisionarResponse>()
}

export async function resetProduto(id: string): Promise<ProdutoDetalhe> {
  const { produto } = await api
    .post(`admin/produtos/${id}/reset`)
    .json<ResetProdutoResponse>()
  return produto
}
