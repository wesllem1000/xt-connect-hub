import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractApiError } from '@/lib/api'

import {
  createSensor,
  deleteSensor,
  patchSensor,
  type CreateSensorInput,
} from '../api'

export function useCreateSensor(deviceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSensorInput) => {
      if (!deviceId) throw new Error('deviceId obrigatório')
      return createSensor(deviceId, input)
    },
    onSuccess: () => {
      toast.success('Sensor cadastrado')
      qc.invalidateQueries({ queryKey: ['irrigacao', 'snapshot', deviceId] })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao cadastrar sensor')
      toast.error(msg)
    },
  })
}

export function usePatchSensor(deviceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; patch: Partial<CreateSensorInput> }) => {
      if (!deviceId) throw new Error('deviceId obrigatório')
      return patchSensor(deviceId, vars.id, vars.patch)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['irrigacao', 'snapshot', deviceId] })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao salvar sensor')
      toast.error(msg)
    },
  })
}

export function useDeleteSensor(deviceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => {
      if (!deviceId) throw new Error('deviceId obrigatório')
      return deleteSensor(deviceId, id)
    },
    onSuccess: () => {
      toast.success('Sensor removido')
      qc.invalidateQueries({ queryKey: ['irrigacao', 'snapshot', deviceId] })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao remover sensor')
      toast.error(msg)
    },
  })
}
