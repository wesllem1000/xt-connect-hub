import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Cpu, Radio } from 'lucide-react'

import { getCliente, type DispositivoDoCliente } from '@/api/admin'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeviceStatus } from '@/hooks/useDeviceStatus'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateFormatter.format(d)
}

function formatOfflineDuration(iso: string | null): string {
  if (!iso) return 'Offline'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Offline'
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return `Offline há ${Math.floor(diff)}s`
  if (diff < 3600) return `Offline há ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `Offline há ${Math.floor(diff / 3600)} h`
  return `Offline há ${Math.floor(diff / 86400)} d`
}

function DispositivoClienteCard({ d }: { d: DispositivoDoCliente }) {
  const status = useDeviceStatus(d.serial, {
    online: d.online,
    lastSeenAt: d.last_seen_at,
  })
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <CardTitle className="text-base leading-tight truncate">
              {d.nome}
            </CardTitle>
            <Badge
              variant={status.online ? 'default' : 'outline'}
              className={status.online ? 'bg-green-600 hover:bg-green-600 shrink-0' : 'shrink-0 text-muted-foreground'}
            >
              <Radio className="h-3 w-3 mr-1" />
              {status.online ? 'Online' : 'Offline'}
            </Badge>
          </div>
          {d.modelo ? (
            <Badge variant="secondary">{d.modelo}</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              sem modelo
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Serial
          </p>
          <p className="font-mono text-xs">{d.serial}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Status
          </p>
          <p>{status.online ? 'Online agora' : formatOfflineDuration(status.lastSeenAt)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Acesso técnico XT
          </p>
          <p className="text-xs capitalize">{d.admin_access_level}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Cadastrado
          </p>
          <p>{formatDate(d.criado_em)}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export function ClienteDetailPage() {
  const { id = '' } = useParams()
  const query = useQuery({
    queryKey: ['cliente', id],
    queryFn: () => getCliente(id),
    enabled: Boolean(id),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Link>
        </Button>
      </div>

      {query.isPending && (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {query.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>Falha ao buscar cliente.</AlertDescription>
        </Alert>
      )}

      {query.isSuccess && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-xl">
                    {query.data.nome ?? '—'}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {query.data.email}
                  </p>
                </div>
                <div className="flex gap-2">
                  {query.data.email_verified ? (
                    <Badge>Verificado</Badge>
                  ) : (
                    <Badge variant="outline">Pendente</Badge>
                  )}
                  {query.data.is_active ? (
                    <Badge variant="secondary">Ativo</Badge>
                  ) : (
                    <Badge variant="destructive">Inativo</Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Cadastrado em
              </p>
              <p className="text-sm">{formatDate(query.data.criado_em)}</p>
            </CardContent>
          </Card>

          <div>
            <h3 className="font-semibold text-lg mb-3">
              Dispositivos do cliente
              <span className="text-muted-foreground font-normal text-sm ml-2">
                ({query.data.dispositivos.length})
              </span>
            </h3>

            {query.data.dispositivos.length === 0 ? (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                Este cliente ainda não tem dispositivos.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {query.data.dispositivos.map((d) => (
                  <DispositivoClienteCard key={d.id} d={d} />
                ))}
              </div>
            )}

            {query.data.dispositivos.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <Cpu className="h-3 w-3" />
                Dispositivos criados pelo cliente aparecerão aqui.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
