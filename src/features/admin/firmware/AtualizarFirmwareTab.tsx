import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { listFirmwareReleases, dispatchFirmwareUpdate } from './api'
import { useFirmwareUpdateProgress } from './useFirmwareUpdateProgress'
import type { FirmwareRelease } from './types'

type Props = {
  deviceId: string         // UUID
  serial: string           // ex: IRR-V1-00008
  hwTarget: string         // ex: irr-v1
  currentFwVersion: string | null
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

const PHASE_LABEL: Record<string, string> = {
  starting: 'Iniciando',
  downloading: 'Baixando',
  verifying: 'Verificando',
  installing: 'Instalando',
  rebooting: 'Reiniciando',
}

export function AtualizarFirmwareTab({
  deviceId,
  serial,
  hwTarget,
  currentFwVersion,
}: Props) {
  const releasesQ = useQuery({
    queryKey: ['admin', 'firmware', 'releases', hwTarget],
    queryFn: () => listFirmwareReleases(hwTarget),
    refetchInterval: 30_000,
  })

  const [pendingRelease, setPendingRelease] = useState<FirmwareRelease | null>(
    null,
  )
  const [progressOpen, setProgressOpen] = useState(false)

  const progress = useFirmwareUpdateProgress(serial)

  const dispatchMut = useMutation({
    mutationFn: (releaseId: string) => dispatchFirmwareUpdate(deviceId, releaseId),
    onSuccess: (data) => {
      progress.startTracking()
      setProgressOpen(true)
      toast.success(`Comando enviado pro ${data.serial} — versão alvo ${data.target_version}`)
    },
    onError: (err: any) => {
      const msg = err?.message || 'Erro ao enviar comando'
      toast.error(msg)
    },
  })

  // Timeout 12 min — se nada chegar, marca como perdido
  useEffect(() => {
    if (!progress.active || !progress.startedAt) return
    const t = setTimeout(() => {
      if (!progress.terminal) {
        toast.warning('Sem resposta do dispositivo em 12 minutos — tentar de novo?')
      }
    }, 12 * 60 * 1000)
    return () => clearTimeout(t)
  }, [progress.active, progress.startedAt, progress.terminal])

  const releases = useMemo(() => releasesQ.data ?? [], [releasesQ.data])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Atualizar firmware</span>
            <Badge variant={currentFwVersion ? 'secondary' : 'outline'}>
              Atual: {currentFwVersion || 'desconhecida'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Hardware: <code className="px-1 py-0.5 bg-muted rounded">{hwTarget}</code>
            {' · '}
            Serial: <code className="px-1 py-0.5 bg-muted rounded">{serial}</code>
          </p>

          {releasesQ.isLoading && (
            <p className="text-sm text-muted-foreground">Carregando releases…</p>
          )}
          {releasesQ.isError && (
            <p className="text-sm text-red-600">
              Erro ao carregar releases: {String((releasesQ.error as Error)?.message || 'desconhecido')}
            </p>
          )}
          {releasesQ.isSuccess && releases.length === 0 && (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Nenhuma release publicada pra <strong>{hwTarget}</strong>.
              <br />
              Pra adicionar: dropa o <code>.bin</code> em{' '}
              <code className="px-1 py-0.5 bg-muted rounded">
                ~xtadmin/teste winscp/firmware-uploads/{hwTarget}/
              </code>{' '}
              via WinSCP — aparece aqui em até 30s.
            </div>
          )}

          {releases.length > 0 && (
            <div className="space-y-2">
              {releases.map((r) => {
                const isCurrent = currentFwVersion === r.version
                return (
                  <div
                    key={r.id}
                    className="flex items-start justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold">{r.version}</span>
                        {isCurrent && <Badge variant="secondary">versão atual</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground space-x-3">
                        <span>{fmtSize(r.size_bytes)}</span>
                        <span>·</span>
                        <span>{fmtDate(r.uploaded_at)}</span>
                        <span>·</span>
                        <span className="font-mono">sha {r.sha256.slice(0, 12)}…</span>
                      </div>
                      {r.release_notes && (
                        <details className="text-xs text-muted-foreground">
                          <summary className="cursor-pointer select-none hover:text-foreground">
                            Notas de release
                          </summary>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
                            {r.release_notes}
                          </pre>
                        </details>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setPendingRelease(r)}
                      disabled={isCurrent || progress.active || dispatchMut.isPending}
                    >
                      {isCurrent ? 'Já instalada' : 'Aplicar'}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmação */}
      <AlertDialog
        open={Boolean(pendingRelease)}
        onOpenChange={(open) => !open && setPendingRelease(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar atualização?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Vai disparar OTA pull em <strong>{serial}</strong>:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>De: {currentFwVersion || '(desconhecida)'}</li>
                  <li>Para: <strong className="font-mono">{pendingRelease?.version}</strong></li>
                  <li>Tamanho: {pendingRelease ? fmtSize(pendingRelease.size_bytes) : ''}</li>
                </ul>
                <p className="text-xs text-muted-foreground pt-2">
                  O dispositivo recusa o comando se a bomba estiver ligada, setor aberto
                  ou alarme ativo. Pode levar ~60s na bancada e até 3 min em conexões
                  ruins.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dispatchMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRelease) {
                  dispatchMut.mutate(pendingRelease.id)
                  setPendingRelease(null)
                }
              }}
              disabled={dispatchMut.isPending}
            >
              {dispatchMut.isPending ? 'Enviando…' : 'Sim, atualizar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Drawer de progresso */}
      <Dialog
        open={progressOpen}
        onOpenChange={(open) => {
          if (!open && progress.terminal) {
            setProgressOpen(false)
            progress.reset()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atualizando firmware</DialogTitle>
            <DialogDescription>
              {serial}
              {progress.progress?.target_version &&
                ` · alvo ${progress.progress.target_version}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!progress.progress && !progress.terminal && (
              <p className="text-sm text-muted-foreground">
                Aguardando ACK do dispositivo…
              </p>
            )}

            {progress.progress && !progress.terminal && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>{PHASE_LABEL[progress.progress.phase] ?? progress.progress.phase}</span>
                  <span className="font-mono">{progress.progress.percent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${progress.progress.percent}%` }}
                  />
                </div>
                {progress.progress.bytes_downloaded != null &&
                  progress.progress.bytes_total != null && (
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {fmtSize(progress.progress.bytes_downloaded)} /{' '}
                      {fmtSize(progress.progress.bytes_total)}
                    </p>
                  )}
              </div>
            )}

            {progress.terminal?.kind === 'succeeded' && (
              <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
                <p className="font-medium text-green-900">
                  Gravado com sucesso. Aguardando reboot…
                </p>
                <p className="text-xs text-green-700 mt-1">
                  alvo {progress.terminal.target_version}
                </p>
              </div>
            )}

            {progress.terminal?.kind === 'validated' && (
              <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
                <p className="font-medium text-green-900">
                  ✅ Atualizado e validado: {progress.terminal.fw_version}
                </p>
              </div>
            )}

            {progress.terminal?.kind === 'failed' && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
                <p className="font-medium text-red-900">
                  Falhou em <code>{progress.terminal.phase}</code>:{' '}
                  {progress.terminal.error}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setProgressOpen(false)
                if (progress.terminal) progress.reset()
              }}
            >
              {progress.terminal ? 'Fechar' : 'Minimizar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
