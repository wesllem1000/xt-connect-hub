import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Check,
  ChevronRight,
  Eye,
  Inbox,
  Loader2,
  Mail,
  Sliders,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  acceptShare,
  inbox,
  type InboxActive,
  type InboxPending,
} from '@/api/compartilhamentos'
import type { SharePermissao } from '@/api/dispositivos'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { extractApiError } from '@/lib/api'

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

function PendingCard({
  convite,
  onAccept,
  accepting,
}: {
  convite: InboxPending
  onAccept: (c: InboxPending) => void
  accepting: boolean
}) {
  const ownerLabel = convite.dono_nome
    ? `${convite.dono_nome} (${convite.dono_email})`
    : convite.dono_email
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base leading-tight truncate">
              {convite.dispositivo_nome}
            </CardTitle>
            <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
              {convite.serial}
            </p>
          </div>
          <PermBadge permissao={convite.permissao} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Convite de
          </p>
          <p className="truncate">{ownerLabel}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Recebido em
          </p>
          <p>{formatPt(convite.criado_em)}</p>
        </div>
        <div className="pt-1 flex justify-end">
          <Button
            size="sm"
            onClick={() => onAccept(convite)}
            disabled={accepting}
          >
            {accepting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-2" />
            )}
            Aceitar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ActiveRow({ share }: { share: InboxActive }) {
  const navigate = useNavigate()
  const ownerLabel = share.dono_nome
    ? `${share.dono_nome} (${share.dono_email})`
    : share.dono_email
  const go = () => navigate(`/dispositivos/${share.dispositivo_id}`)
  return (
    <button
      type="button"
      onClick={go}
      className="w-full flex items-center gap-3 rounded-md border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">
            {share.dispositivo_nome}
          </p>
          <PermBadge permissao={share.permissao} />
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {ownerLabel} · ativo desde {formatPt(share.aceito_em ?? share.criado_em)}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  )
}

function Loading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

export function ConvitesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [acceptingId, setAcceptingId] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['compartilhamentos', 'inbox'],
    queryFn: inbox,
  })

  const acceptMutation = useMutation({
    mutationFn: (token: string) => acceptShare(token),
    onMutate: (token) => {
      const pending = query.data?.pendentes.find((p) => p.token === token)
      setAcceptingId(pending?.id ?? null)
    },
    onSuccess: (data) => {
      toast.success(`Acesso a ${data.dispositivo.nome} ativado.`)
      qc.invalidateQueries({ queryKey: ['compartilhamentos', 'inbox'] })
      qc.invalidateQueries({ queryKey: ['dispositivos'] })
      navigate(`/dispositivos/${data.dispositivo.id}`)
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao aceitar convite.')
      toast.error(msg)
      setAcceptingId(null)
    },
  })

  const pendentes = query.data?.pendentes ?? []
  const ativos = query.data?.ativos ?? []

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Convites</h2>
        <p className="text-muted-foreground text-sm">
          Dispositivos compartilhados com você.
        </p>
      </div>

      {query.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>
            {query.error instanceof Error
              ? query.error.message
              : 'Erro ao buscar convites.'}
          </AlertDescription>
        </Alert>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">
            Pendentes
            {pendentes.length > 0 && (
              <span className="ml-2 text-muted-foreground">
                ({pendentes.length})
              </span>
            )}
          </h3>
        </div>
        {query.isPending && <Loading />}
        {query.isSuccess && pendentes.length === 0 && (
          <p className="text-sm text-muted-foreground border border-dashed rounded-md px-4 py-6 text-center">
            Nenhum convite pendente.
          </p>
        )}
        {query.isSuccess && pendentes.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {pendentes.map((p) => (
              <PendingCard
                key={p.id}
                convite={p}
                onAccept={(c) => acceptMutation.mutate(c.token)}
                accepting={
                  acceptMutation.isPending && acceptingId === p.id
                }
              />
            ))}
          </div>
        )}
      </section>

      <Separator />

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">
            Ativos
            {ativos.length > 0 && (
              <span className="ml-2 text-muted-foreground">
                ({ativos.length})
              </span>
            )}
          </h3>
        </div>
        {query.isPending && <Loading />}
        {query.isSuccess && ativos.length === 0 && (
          <p className="text-sm text-muted-foreground border border-dashed rounded-md px-4 py-6 text-center">
            Nenhum compartilhamento ativo ainda.
          </p>
        )}
        {query.isSuccess && ativos.length > 0 && (
          <div className="space-y-2">
            {ativos.map((s) => (
              <ActiveRow key={s.id} share={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
