import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Cpu,
  Eye,
  KeyRound,
  MoreVertical,
  Plus,
  Radio,
  Sliders,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  deleteDispositivo,
  listDispositivos,
  regenerarMqtt,
  type Dispositivo,
  type MqttCredentials,
} from '@/api/dispositivos'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { extractApiError } from '@/lib/api'
import { useDeviceStatus } from '@/hooks/useDeviceStatus'
import { DispositivoFormDialog } from './DispositivoFormDialog'
import { MqttCredentialsDialog } from './MqttCredentialsDialog'

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

function formatOfflineDuration(iso: string | null): string {
  if (!iso) return 'Offline'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Offline'
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 30) return 'Offline (agora mesmo)'
  if (diff < 60) return `Offline há ${Math.floor(diff)}s`
  if (diff < 3600) return `Offline há ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `Offline há ${Math.floor(diff / 3600)} h`
  return `Offline há ${Math.floor(diff / 86400)} d`
}

function ShareChip({ permissao }: { permissao: Dispositivo['permissao'] }) {
  if (permissao === 'controle') {
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-600 shrink-0">
        <Sliders className="h-3 w-3 mr-1" />
        Compartilhado · Comandar
      </Badge>
    )
  }
  return (
    <Badge className="bg-blue-600 hover:bg-blue-600 shrink-0">
      <Eye className="h-3 w-3 mr-1" />
      Compartilhado · Visualizar
    </Badge>
  )
}

function DispositivoCard({
  dispositivo,
  onRegenerate,
  onDelete,
}: {
  dispositivo: Dispositivo
  onRegenerate: (d: Dispositivo) => void
  onDelete: (d: Dispositivo) => void
}) {
  const navigate = useNavigate()
  const goToDetail = () => navigate(`/dispositivos/${dispositivo.id}`)
  const status = useDeviceStatus(dispositivo.serial, {
    online: dispositivo.online,
    lastSeenAt: dispositivo.last_seen_at,
  })
  const isShared = dispositivo.access_type === 'shared'
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Abrir ${dispositivo.nome}`}
      onClick={goToDetail}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          goToDetail()
        }
      }}
      className="cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardHeader className="pb-3">
        {isShared && (
          <div className="flex justify-end mb-1">
            <ShareChip permissao={dispositivo.permissao} />
          </div>
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <CardTitle className="text-base leading-tight truncate">
              {dispositivo.nome}
            </CardTitle>
            <Badge
              variant={status.online ? 'default' : 'outline'}
              className={status.online ? 'bg-green-600 hover:bg-green-600 shrink-0' : 'shrink-0 text-muted-foreground'}
            >
              <Radio className="h-3 w-3 mr-1" />
              {status.online ? 'Online' : 'Offline'}
            </Badge>
          </div>
          <div
            className="flex items-center gap-2 shrink-0"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {dispositivo.modelo ? (
              <Badge variant="secondary">{dispositivo.modelo}</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                sem modelo
              </Badge>
            )}
            {!isShared && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Ações do dispositivo"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onRegenerate(dispositivo)}>
                    <KeyRound className="h-4 w-4 mr-2" />
                    Regenerar credenciais MQTT
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => onDelete(dispositivo)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Excluir
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Serial</p>
          <p className="font-mono text-xs">{dispositivo.serial}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Último dado</p>
          <p>
            {status.online
              ? formatPt(dispositivo.ultimo_valor)
              : formatOfflineDuration(status.lastSeenAt)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Cadastrado</p>
          <p>{formatPt(dispositivo.criado_em)}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function LoadingState() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-3/4" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card className="max-w-md mx-auto text-center">
      <CardHeader>
        <div className="mx-auto rounded-full bg-primary/10 p-3 w-fit">
          <Cpu className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="mt-3">Nenhum dispositivo cadastrado</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Cadastre um dispositivo para começar a receber telemetria.
        </p>
        <Button onClick={onAdd}>
          <Plus className="h-4 w-4 mr-2" />
          Adicionar dispositivo
        </Button>
      </CardContent>
    </Card>
  )
}

function ErrorMessage({ error }: { error: unknown }) {
  const [message, setMessage] = useState('Falha ao buscar dispositivos.')
  useEffect(() => {
    let cancelled = false
    extractApiError(error, 'Falha ao buscar dispositivos.').then((m) => {
      if (!cancelled) setMessage(m)
    })
    return () => {
      cancelled = true
    }
  }, [error])
  return <>{message}</>
}

type CredentialsDialogState = {
  credentials: MqttCredentials
  contexto: 'criado' | 'regenerado'
} | null

export function DispositivosPage() {
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [toDelete, setToDelete] = useState<Dispositivo | null>(null)
  const [toRegenerate, setToRegenerate] = useState<Dispositivo | null>(null)
  const [credentialsDialog, setCredentialsDialog] =
    useState<CredentialsDialogState>(null)

  const query = useQuery({
    queryKey: ['dispositivos'],
    queryFn: listDispositivos,
  })

  const dispositivos = useMemo(() => {
    if (!query.data) return []
    return [...query.data].sort((a, b) => {
      if (a.access_type !== b.access_type) {
        return a.access_type === 'owner' ? -1 : 1
      }
      return 0
    })
  }, [query.data])

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDispositivo(id),
    onSuccess: () => {
      toast.success('Dispositivo excluído.')
      qc.invalidateQueries({ queryKey: ['dispositivos'] })
      setToDelete(null)
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao excluir dispositivo.')
      toast.error(msg)
      setToDelete(null)
    },
  })

  const regenerateMutation = useMutation({
    mutationFn: (id: string) => regenerarMqtt(id),
    onSuccess: (data) => {
      setToRegenerate(null)
      setCredentialsDialog({
        credentials: data.mqtt_credentials,
        contexto: 'regenerado',
      })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao regenerar credenciais.')
      toast.error(msg)
      setToRegenerate(null)
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dispositivos</h2>
          <p className="text-muted-foreground text-sm">
            Seus dispositivos conectados ao hub.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Adicionar
        </Button>
      </div>

      {query.isPending && <LoadingState />}

      {query.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>
            <ErrorMessage error={query.error} />
          </AlertDescription>
        </Alert>
      )}

      {query.isSuccess && query.data.length === 0 && (
        <EmptyState onAdd={() => setDialogOpen(true)} />
      )}

      {query.isSuccess && dispositivos.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dispositivos.map((d) => (
            <DispositivoCard
              key={d.id}
              dispositivo={d}
              onRegenerate={(dev) => setToRegenerate(dev)}
              onDelete={(dev) => setToDelete(dev)}
            />
          ))}
        </div>
      )}

      <DispositivoFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(credentials) =>
          setCredentialsDialog({ credentials, contexto: 'criado' })
        }
      />

      <MqttCredentialsDialog
        open={credentialsDialog !== null}
        onOpenChange={(open) => {
          if (!open) setCredentialsDialog(null)
        }}
        credentials={credentialsDialog?.credentials ?? null}
        contexto={credentialsDialog?.contexto}
      />

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setToDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir dispositivo?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete ? (
                <>
                  <strong>{toDelete.nome}</strong> será removido. Esta ação não
                  pode ser desfeita.
                </>
              ) : (
                'Esta ação não pode ser desfeita.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (toDelete) deleteMutation.mutate(toDelete.id)
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={toRegenerate !== null}
        onOpenChange={(open) => {
          if (!open && !regenerateMutation.isPending) setToRegenerate(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerar credenciais MQTT?</AlertDialogTitle>
            <AlertDialogDescription>
              A senha atual do dispositivo deixará de funcionar imediatamente. O
              dispositivo precisará ser reconfigurado com a nova senha.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={regenerateMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={regenerateMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (toRegenerate) regenerateMutation.mutate(toRegenerate.id)
              }}
            >
              Regenerar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
