import { useQuery } from '@tanstack/react-query'

import { inbox } from '@/api/compartilhamentos'
import { useAuthStore } from '@/stores/auth'

const POLL_MS = 60_000

export function useInboxPendingCount(): number {
  const isAuthed = useAuthStore((s) =>
    Boolean(s.user && (s.accessToken || s.refreshToken)),
  )

  const query = useQuery({
    queryKey: ['compartilhamentos', 'inbox'],
    queryFn: inbox,
    enabled: isAuthed,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

  return query.data?.pendentes.length ?? 0
}
