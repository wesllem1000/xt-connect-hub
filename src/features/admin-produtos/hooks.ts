import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractApiError } from '@/lib/api'
import {
  getProduto,
  listProdutos,
  provisionarProduto,
  regenerarMqttPassword,
  resetProduto,
} from './api'
import type { Filtros, ProvisionarInput } from './types'

const LIMIT = 50

export function useProdutos(filters: Filtros) {
  return useQuery({
    queryKey: ['produtos', filters],
    queryFn: () =>
      listProdutos({
        status: filters.status,
        modelo_id: filters.modelo_id,
        page: filters.page ?? 1,
        limit: LIMIT,
      }),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

export function useProduto(id: string | undefined) {
  return useQuery({
    queryKey: ['produto', id],
    queryFn: () => getProduto(id!),
    enabled: Boolean(id),
    refetchInterval: 30_000,
  })
}

export function useProvisionarProduto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ProvisionarInput) => provisionarProduto(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['produtos'] })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao provisionar produto')
      toast.error(msg)
    },
  })
}

export function useResetProduto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => resetProduto(id),
    onSuccess: (_, id) => {
      toast.success('Produto resetado. Novo pairing code gerado.')
      qc.invalidateQueries({ queryKey: ['produto', id] })
      qc.invalidateQueries({ queryKey: ['produtos'] })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao resetar produto')
      toast.error(msg)
    },
  })
}

export function useRegenerarMqttPassword() {
  return useMutation({
    mutationFn: (id: string) => regenerarMqttPassword(id),
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao regenerar senha MQTT')
      toast.error(msg)
    },
  })
}
