import { api } from '@/lib/api'

export type Modelo = {
  id: string
  nome: string
  descricao: string | null
  fabricante: string
  criado_em: string
  total_dispositivos: number
}

export type WidgetNoModelo = {
  id: string
  catalogo_widget_id: string
  titulo: string
  ordem: number
  coluna: number
  linha: number
  largura: number
  altura: number
  direcao: 'receber' | 'enviar' | 'bidirecional'
  json_path_leitura: string | null
  nome_comando: string | null
  config_padrao: Record<string, unknown>
  ativo: boolean
  widget_nome: string
  widget_tipo: string
  widget_icone: string
}

export type ModeloDetalhe = {
  id: string
  nome: string
  descricao: string | null
  fabricante: string
  imagem_url: string | null
  especificacoes: Record<string, unknown>
  protocolos_suportados: string[]
  retencao_historico_horas: number
  ativo: boolean
  criado_em: string
  atualizado_em: string
  widgets: WidgetNoModelo[]
}

export type ModeloWidgetInput = {
  catalogo_widget_id: string
  ordem: number
  titulo?: string
  config_padrao?: Record<string, unknown> | null
}

export type ModeloInput = {
  nome: string
  fabricante: string
  descricao?: string | null
  widgets: ModeloWidgetInput[]
}

export function listModelos(): Promise<Modelo[]> {
  return api.get('modelos-dispositivo').json<Modelo[]>()
}

export function getModelo(id: string): Promise<ModeloDetalhe> {
  return api.get(`modelos-dispositivo/${id}`).json<ModeloDetalhe>()
}

export function createModelo(data: ModeloInput): Promise<{ id: string }> {
  return api.post('modelos-dispositivo', { json: data }).json<{ id: string }>()
}

export function updateModelo(id: string, data: ModeloInput): Promise<{ id: string }> {
  return api.put(`modelos-dispositivo/${id}`, { json: data }).json<{ id: string }>()
}

export function deleteModelo(id: string): Promise<{ ok: true }> {
  return api.delete(`modelos-dispositivo/${id}`).json<{ ok: true }>()
}
