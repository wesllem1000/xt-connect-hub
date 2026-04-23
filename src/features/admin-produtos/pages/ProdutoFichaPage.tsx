import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Printer,
  Radio,
  RotateCcw,
} from 'lucide-react'

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
import { Skeleton } from '@/components/ui/skeleton'
import { extractApiError } from '@/lib/api'

import { CopyField } from '../components/CopyField'
import { CredenciaisProduto } from '../components/CredenciaisProduto'
import { openEtiquetaProduto } from '../components/EtiquetaProduto'
import { ProdutoStatusChip } from '../components/ProdutoStatusChip'
import { useProduto, useResetProduto } from '../hooks'

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

export function ProdutoFichaPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const query = useProduto(id)
  const resetMutation = useResetProduto()

  const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0)

  useEffect(() => {
    if (!resetMutation.isPending && !resetMutation.isIdle) {
      if (resetMutation.isSuccess) setConfirmStep(0)
    }
  }, [resetMutation.isPending, resetMutation.isIdle, resetMutation.isSuccess])

  if (query.isPending) {
    return <Loading />
  }

  if (query.isError) {
    return (
      <div className="space-y-4">
        <BackButton onClick={() => navigate('/admin/produtos')} />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>
            <ErrorText error={query.error} />
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const p = query.data!
  const isOcioso = p.status === 'ocioso'
  const isAssociado = p.status === 'associado'

  return (
    <div className="space-y-6 max-w-4xl">
      <BackButton onClick={() => navigate('/admin/produtos')} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight font-mono">{p.serial}</h2>
          <p className="text-muted-foreground text-sm">{p.modelo_nome ?? 'Modelo desconhecido'}</p>
        </div>
        <ProdutoStatusChip status={p.status} />
      </div>

      {/* Card 1 — Identificação */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identificação</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <CopyField
            label="Serial"
            value={p.serial}
            valueClassName="font-mono text-base font-semibold"
          />
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Modelo</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                {p.modelo_nome ?? '—'}
                {p.prefixo && p.major_version && (
                  <span className="ml-2 text-xs text-muted-foreground font-mono">
                    {p.prefixo}-{p.major_version}
                  </span>
                )}
              </div>
              {p.modelo_id && (
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="Ver modelo">
                  <Link to={`/admin/modelos/${p.modelo_id}`}>
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Provisionado em</p>
            <p className="text-sm">{formatPt(p.provisionado_em)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Claimed em</p>
            <p className="text-sm">{p.claimed_em ? formatPt(p.claimed_em) : '—'}</p>
          </div>
        </CardContent>
      </Card>

      {/* Card 2 — Cliente (só se associado) */}
      {isAssociado && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p>
                <p className="text-sm truncate">{p.owner_email ?? '—'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Nome</p>
                <p className="text-sm truncate">{p.owner_nome ?? '—'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/dispositivos/${p.id}`)}
              >
                Abrir como cliente
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Card 3 — Credenciais (só se ocioso) */}
      {isOcioso && p.pairing_code && p.claim_url && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Credenciais de claim</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                openEtiquetaProduto({
                  serial: p.serial,
                  pairingCode: p.pairing_code!,
                  claimUrl: p.claim_url!,
                })
              }
            >
              <Printer className="h-4 w-4 mr-2" />
              Imprimir etiqueta
            </Button>
          </CardHeader>
          <CardContent>
            <CredenciaisProduto
              serial={p.serial}
              modeloNome={p.modelo_nome}
              pairingCode={p.pairing_code}
              claimUrl={p.claim_url}
              mqtt={{
                host: 'mqtts://hub.xtconect.online:8883',
                ws: 'wss://hub.xtconect.online:8884/',
                username: p.serial,
                password: '',
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Card 4 — Telemetria recente (só se associado) */}
      {isAssociado && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Telemetria</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <Badge
                variant={p.is_online ? 'default' : 'outline'}
                className={p.is_online ? 'bg-green-600 hover:bg-green-600' : 'text-muted-foreground'}
              >
                <Radio className="h-3 w-3 mr-1" />
                {p.is_online ? 'Online' : 'Offline'}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Último heartbeat: {formatPt(p.last_seen)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Para gráfico em tempo real, acesse a visão do cliente:
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/dispositivos/${p.id}`}>Ver dashboard do dispositivo</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Card 5 — Ações */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ações</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            onClick={() => setConfirmStep(1)}
            disabled={resetMutation.isPending}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          {/* Marcar como defeito / retornado / soft-delete ficam pra E3.x
              (endpoint PATCH /admin/produtos/:id não existe ainda) */}
        </CardContent>
      </Card>

      {/* Alert dialog — confirmação dupla */}
      <AlertDialog
        open={confirmStep > 0}
        onOpenChange={(o) => {
          if (!o && !resetMutation.isPending) setConfirmStep(0)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmStep === 1 ? 'Resetar produto?' : 'Confirmar reset'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {confirmStep === 1 ? (
                  <>
                    <p>
                      <strong>{p.serial}</strong> vai voltar pra status{' '}
                      <em>ocioso</em>, gerar novo <code>pairing_code</code> e{' '}
                      <code>claim_token</code>.
                    </p>
                    <Alert className="border-amber-300 bg-amber-50 text-amber-900">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <AlertDescription>
                        Isso <strong>desassocia o produto do cliente atual</strong>
                        {p.owner_email ? ` (${p.owner_email})` : ''} e{' '}
                        <strong>revoga todos os shares ativos</strong> desse dispositivo.
                        A senha MQTT não muda (firmware continua funcionando).
                      </AlertDescription>
                    </Alert>
                  </>
                ) : (
                  <p>
                    Última confirmação — essa ação é imediata e não pode ser
                    desfeita sem re-claim pelo cliente.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={resetMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (confirmStep === 1) {
                  setConfirmStep(2)
                } else if (id) {
                  resetMutation.mutate(id)
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {resetMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {confirmStep === 1 ? 'Continuar' : 'Resetar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Loading() {
  return (
    <div className="space-y-4 max-w-4xl">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <ArrowLeft className="h-4 w-4 mr-1" />
      Produtos
    </Button>
  )
}

function ErrorText({ error }: { error: unknown }) {
  const [msg, setMsg] = useState('Falha ao carregar.')
  useEffect(() => {
    let cancelled = false
    extractApiError(error, 'Falha ao carregar.').then((m) => {
      if (!cancelled) setMsg(m)
    })
    return () => {
      cancelled = true
    }
  }, [error])
  return <>{msg}</>
}
