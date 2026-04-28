import { api } from '@/lib/api'

import type { AutomationExecution, AutomationRule } from './types'

export type CreateAutomationInput = {
  nome: string
  descricao?: string | null
  device_id?: string | null
  ativo?: boolean
  trigger_type: AutomationRule['trigger_type']
  trigger_params?: Record<string, unknown>
  condicoes?: unknown[]
  acoes: AutomationRule['acoes']
  cooldown_minutes?: number
}

export type PatchAutomationInput = Partial<CreateAutomationInput>

export async function listAutomacoes(): Promise<AutomationRule[]> {
  const { regras } = await api
    .get('api/automacoes')
    .json<{ regras: AutomationRule[] }>()
  return regras
}

export async function createAutomacao(
  input: CreateAutomationInput,
): Promise<AutomationRule> {
  const { regra } = await api
    .post('api/automacoes', { json: input })
    .json<{ regra: AutomationRule }>()
  return regra
}

export async function patchAutomacao(
  id: string,
  patch: PatchAutomationInput,
): Promise<AutomationRule> {
  const { regra } = await api
    .patch(`api/automacoes/${id}`, { json: patch })
    .json<{ regra: AutomationRule }>()
  return regra
}

export async function deleteAutomacao(id: string) {
  return api
    .delete(`api/automacoes/${id}`)
    .json<{ ok: true; id: string }>()
}

export async function listExecucoes(
  id: string,
): Promise<AutomationExecution[]> {
  const { execucoes } = await api
    .get(`api/automacoes/${id}/execucoes`)
    .json<{ execucoes: AutomationExecution[] }>()
  return execucoes
}
