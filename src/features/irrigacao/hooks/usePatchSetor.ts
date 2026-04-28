import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractApiError } from '@/lib/api'

import { patchSetor } from '../api'

export function usePatchSetor(deviceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      numero: number
      patch: Partial<Record<string, unknown>>
    }) => {
      if (!deviceId) throw new Error('deviceId obrigatório')
      return patchSetor(deviceId, vars.numero, vars.patch)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['irrigacao', 'snapshot', deviceId] })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao salvar setor')
      toast.error(msg)
    },
  })
}
