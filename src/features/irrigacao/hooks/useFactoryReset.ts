import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractApiError } from '@/lib/api'

import { factoryReset } from '../api'

export function useFactoryReset(deviceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => {
      if (!deviceId) throw new Error('deviceId obrigatório')
      return factoryReset(deviceId)
    },
    onSuccess: () => {
      toast.success('Reset de fábrica enviado. Defaults reaplicados.')
      qc.invalidateQueries({ queryKey: ['irrigacao', 'snapshot', deviceId] })
      qc.invalidateQueries({ queryKey: ['irrigacao', 'events-history', deviceId] })
      qc.invalidateQueries({ queryKey: ['irrigacao', 'events-log', deviceId] })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao executar reset de fábrica')
      toast.error(msg)
    },
  })
}
