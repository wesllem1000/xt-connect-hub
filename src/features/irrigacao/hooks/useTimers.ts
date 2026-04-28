import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractApiError } from '@/lib/api'

import {
  deleteTimer,
  getTimers,
  patchTimer,
  postTimer,
  type PostTimerInput,
} from '../api'
import type { TimerAlvoTipo } from '../types'

export function useTimers(
  deviceId: string | undefined,
  filter?: { alvo_tipo?: TimerAlvoTipo; alvo_id?: string },
) {
  return useQuery({
    queryKey: ['irrigacao', 'timers', deviceId, filter ?? null],
    queryFn: () => getTimers(deviceId!, filter),
    enabled: Boolean(deviceId),
    refetchInterval: 30_000,
  })
}

export function useCreateTimer(deviceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: PostTimerInput) => {
      if (!deviceId) throw new Error('deviceId obrigatório')
      return postTimer(deviceId, input)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['irrigacao', 'timers', deviceId] })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao criar timer')
      toast.error(msg)
    },
  })
}

export function useUpdateTimer(deviceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; patch: Partial<PostTimerInput> }) => {
      if (!deviceId) throw new Error('deviceId obrigatório')
      return patchTimer(deviceId, vars.id, vars.patch)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['irrigacao', 'timers', deviceId] })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao atualizar timer')
      toast.error(msg)
    },
  })
}

export function useDeleteTimer(deviceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => {
      if (!deviceId) throw new Error('deviceId obrigatório')
      return deleteTimer(deviceId, id)
    },
    onSuccess: () => {
      toast.success('Timer removido')
      qc.invalidateQueries({ queryKey: ['irrigacao', 'timers', deviceId] })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao remover timer')
      toast.error(msg)
    },
  })
}
