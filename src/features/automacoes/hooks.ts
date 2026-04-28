import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractApiError } from '@/lib/api'

import {
  createAutomacao,
  deleteAutomacao,
  listAutomacoes,
  listExecucoes,
  patchAutomacao,
  type CreateAutomationInput,
  type PatchAutomationInput,
} from './api'

export function useAutomacoes() {
  return useQuery({
    queryKey: ['automacoes', 'list'],
    queryFn: listAutomacoes,
    refetchInterval: 30_000,
  })
}

export function useCreateAutomacao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateAutomationInput) => createAutomacao(input),
    onSuccess: () => {
      toast.success('Automação criada')
      qc.invalidateQueries({ queryKey: ['automacoes'] })
    },
    onError: async (err) => {
      const m = await extractApiError(err, 'Falha ao criar automação')
      toast.error(m)
    },
  })
}

export function usePatchAutomacao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; patch: PatchAutomationInput }) =>
      patchAutomacao(vars.id, vars.patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automacoes'] })
    },
    onError: async (err) => {
      const m = await extractApiError(err, 'Falha ao atualizar')
      toast.error(m)
    },
  })
}

export function useDeleteAutomacao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteAutomacao(id),
    onSuccess: () => {
      toast.success('Automação removida')
      qc.invalidateQueries({ queryKey: ['automacoes'] })
    },
    onError: async (err) => {
      const m = await extractApiError(err, 'Falha ao remover')
      toast.error(m)
    },
  })
}

export function useExecucoes(id: string | undefined) {
  return useQuery({
    queryKey: ['automacoes', 'execucoes', id],
    queryFn: () => listExecucoes(id!),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  })
}
