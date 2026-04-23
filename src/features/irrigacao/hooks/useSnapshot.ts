import { useQuery } from '@tanstack/react-query'

import { getSnapshot } from '../api'

export function useIrrigationSnapshot(deviceId: string | undefined) {
  return useQuery({
    queryKey: ['irrigacao', 'snapshot', deviceId],
    queryFn: () => getSnapshot(deviceId!),
    enabled: Boolean(deviceId),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })
}
