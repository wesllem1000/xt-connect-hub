import { api } from '@/lib/api'

export type CatalogoWidget = {
  id: string
  nome: string
  tipo: string
  descricao: string | null
  icone: string
  configuracao_padrao: Record<string, unknown>
}

export function listCatalogoWidgets(): Promise<CatalogoWidget[]> {
  return api.get('catalogo-widgets').json<CatalogoWidget[]>()
}
