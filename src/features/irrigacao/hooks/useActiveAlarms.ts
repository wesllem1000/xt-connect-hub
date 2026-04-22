import { useQuery } from '@tanstack/react-query'

import { getActiveAlarms } from '../api'

export function useActiveAlarms(deviceId: string | undefined) {
  return useQuery({
    queryKey: ['irrigacao', 'alarmes-ativos', deviceId],
    queryFn: () => getActiveAlarms(deviceId!),
    enabled: Boolean(deviceId),
    refetchInterval: 10_000,
  })
}
