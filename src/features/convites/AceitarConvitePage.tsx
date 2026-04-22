import { useMemo } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Check, Eye, Loader2, Sliders } from 'lucide-react'
import { toast } from 'sonner'

import { acceptShare, inbox } from '@/api/compartilhamentos'
import type { SharePermissao } from '@/api/dispositivos'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { extractApiError } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function formatPt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return dateFormatter.format(d)
}

function PermBadge({ permissao }: { permissao: SharePermissao }) {
  if (permissao === 'controle') {
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-600">
        <Sliders className="h-3 w-3 mr-1" />
        Comandar
      </Badge>
    )
  }
  return (
    <Badge className="bg-blue-600 hover:bg-blue-600">
      <Eye className="h-3 w-3 mr-1" />
      Visualizar
    </Badge>
  )
}

export function AceitarConvitePage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const qc = useQueryClient()

  const user = useAuthStore((s) => s.user)
  const isAuthed = useAuthStore((s) =>
    Boolean(s.user && (s.accessToken || s.refreshToken)),
  )
  const clearSession = useAuthStore((s) => s.clearSession)

  const inboxQuery = useQuery({
    queryKey: ['compartilhamentos', 'inbox'],
    queryFn: inbox,
    enabled: isAuthed && Boolean(token),
  })

  const convite = useMemo(() => {
    if (!inboxQuery.data || !token) return null
    return inboxQuery.data.pendentes.find((p) => p.token === token) ?? null
  }, [inboxQuery.data, token])

  const acceptMutation = useMutation({
    mutationFn: () => acceptShare(token),
    onSuccess: (data) => {
      toast.success(`Acesso a ${data.dispositivo.nome} ativado.`)
      qc.invalidateQueries({ queryKey: ['compartilhamentos', 'inbox'] })
      qc.invalidateQueries({ queryKey: ['dispositivos'] })
      navigate(`/dispositivos/${data.dispositivo.id}`, { replace: true })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao aceitar convite.')
      toast.error(msg)
    },
  })

  function handleSwitchAccount() {
    const target = `/convites/aceitar?token=${encodeURIComponent(token)}`
    clearSession()
    navigate(`/login?next=${encodeURIComponent(target)}`, { replace: true })
  }

  if (!token) {
    return <Navigate to="/convites" replace />
  }

  if (!isAuthed) {
    const target = `/convites/aceitar?token=${encodeURIComponent(token)}`
    return <Navigate to={`/login?next=${encodeURIComponent(target)}`} replace />
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl">Convite de compartilhamento</CardTitle>
          <CardDescription>
            Aceite para ganhar acesso ao dispositivo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {inboxQuery.isPending && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}

          {inboxQuery.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Falha ao carregar o convite. Tente novamente.
              </AlertDescription>
            </Alert>
          )}

          {inboxQuery.isSuccess && !convite && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Convite não disponível</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  Este convite não está disponível para{' '}
                  <strong>{user?.email}</strong>. Isso normalmente acontece
                  quando você está logado com uma conta diferente da que
                  recebeu o convite, ou quando o link já foi usado ou revogado.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={handleSwitchAccount}>
                    Entrar com outra conta
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/convites">Ir para convites</Link>
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {inboxQuery.isSuccess && convite && (
            <div className="space-y-3 rounded-md border bg-muted/30 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Dispositivo
                  </p>
                  <p className="font-medium truncate">
                    {convite.dispositivo_nome}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {convite.serial}
                  </p>
                </div>
                <PermBadge permissao={convite.permissao} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Convite de
                </p>
                <p className="text-sm truncate">
                  {convite.dono_nome
                    ? `${convite.dono_nome} (${convite.dono_email})`
                    : convite.dono_email}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Recebido em
                </p>
                <p className="text-sm">{formatPt(convite.criado_em)}</p>
              </div>
            </div>
          )}
        </CardContent>
        {inboxQuery.isSuccess && convite && (
          <CardFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button variant="ghost" asChild>
              <Link to="/convites">Depois</Link>
            </Button>
            <Button
              onClick={() => acceptMutation.mutate()}
              disabled={acceptMutation.isPending}
            >
              {acceptMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Aceitar convite
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  )
}
