import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertCircle,
  Cpu,
  Eye,
  Gauge,
  MoreVertical,
  Plus,
  QrCode,
  Radio,
  Settings,
  Sliders,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  deleteDispositivo,
  listDispositivos,
  type Dispositivo,
} from '@/api/dispositivos'
import { useAuthStore } from '@/stores/auth'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { extractApiError } from '@/lib/api'
import { useDeviceStatus } from '@/hooks/useDeviceStatus'

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
  onDelete,
}: {
  dispositivo: Dispositivo
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
              {dispositivo.apelido || dispositivo.serial}
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
          <QrCode className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="mt-3">Nenhum dispositivo cadastrado</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Escaneie o QR code da etiqueta do seu produto ou digite o código pra começar.
        </p>
        <Button onClick={onAdd} size="lg" className="h-12">
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

export function DispositivosPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [toDelete, setToDelete] = useState<Dispositivo | null>(null)

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

  const totalDevices = dispositivos.length
  const ownDevices = dispositivos.filter((d) => d.access_type === 'owner').length
  const sharedDevices = totalDevices - ownDevices
  const onlineDevices = dispositivos.filter((d) => d.online).length
  const firstName = (user?.name || user?.email || '').split(/\s+/)[0] || 'visitante'
  const roleLabel =
    user?.role === 'admin'
      ? 'Administrador'
      : user?.role === 'instalador'
        ? 'Instalador'
        : 'Usuário'

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

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="animate-slide-up">
        <h2 className="text-xl sm:text-3xl font-bold mb-1 sm:mb-2">
          Olá, {firstName}! 👋
        </h2>
        <p className="text-sm sm:text-base text-muted-foreground">
          Bem-vindo de volta — {roleLabel.toLowerCase()} XT CONECT.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="pb-2 sm:pb-3 p-3 sm:p-6">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                Dispositivos
              </CardTitle>
              <Cpu className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-xl sm:text-2xl font-bold">{ownDevices}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 truncate">
              {sharedDevices > 0 ? `+ ${sharedDevices} compartilhado(s)` : 'Próprios'}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="pb-2 sm:pb-3 p-3 sm:p-6">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                Online
              </CardTitle>
              <Activity className="h-4 w-4 text-success" />
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-xl sm:text-2xl font-bold">{onlineDevices}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
              de {totalDevices} ativo(s)
            </p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow opacity-70">
          <CardHeader className="pb-2 sm:pb-3 p-3 sm:p-6">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                Automações
              </CardTitle>
              <Gauge className="h-4 w-4 text-secondary" />
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-xl sm:text-2xl font-bold">0</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
              em breve
            </p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow opacity-70">
          <CardHeader className="pb-2 sm:pb-3 p-3 sm:p-6">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                Alertas
              </CardTitle>
              <Settings className="h-4 w-4 text-info" />
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-xl sm:text-2xl font-bold">—</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
              em breve
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div>
          <h3 className="text-lg sm:text-xl font-bold tracking-tight">Meus Dispositivos</h3>
          <p className="text-muted-foreground text-xs sm:text-sm">
            Seus dispositivos conectados ao hub.
          </p>
        </div>
        <Button onClick={() => navigate('/dispositivos/adicionar')} className="gradient-primary text-white">
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
        <EmptyState onAdd={() => navigate('/dispositivos/adicionar')} />
      )}

      {query.isSuccess && dispositivos.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dispositivos.map((d) => (
            <DispositivoCard
              key={d.id}
              dispositivo={d}
              onDelete={(dev) => setToDelete(dev)}
            />
          ))}
        </div>
      )}

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
    </div>
  )
}
