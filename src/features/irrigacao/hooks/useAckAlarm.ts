import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractApiError } from '@/lib/api'

import { ackAlarm } from '../api'

export function useAckAlarm(deviceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (alarmId: string) => {
      if (!deviceId) throw new Error('deviceId obrigatório')
      return ackAlarm(deviceId, alarmId)
    },
    onSuccess: () => {
      toast.success('Alarme reconhecido')
      qc.invalidateQueries({ queryKey: ['irrigacao', 'snapshot', deviceId] })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao reconhecer alarme')
      toast.error(msg)
    },
  })
}
