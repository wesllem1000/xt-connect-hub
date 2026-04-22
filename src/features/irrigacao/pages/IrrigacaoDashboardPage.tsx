import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Power, Settings } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { BombaSvgAnimada } from '../components/BombaSvgAnimada'
import { IndicadoresStatusBar } from '../components/IndicadoresStatusBar'
import { SetorCardValvula } from '../components/SetorCardValvula'
import { useIrrigationSnapshot } from '../hooks/useSnapshot'
import type { IrrigationSector } from '../types'

type Props = {
  /** UUID do device; vem do match da rota /dispositivos/:id. */
  deviceId: string
  /** Mostrado no header antes do snapshot chegar. */
  nomeAmigavel?: string | null
}

export function IrrigacaoDashboardPage({ deviceId, nomeAmigavel }: Props) {
  const navigate = useNavigate()
  const query = useIrrigationSnapshot(deviceId)

  if (query.isPending) {
    return (
      <div className="space-y-4 max-w-5xl">
        <BackButton onClick={() => navigate('/dispositivos')} />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-56 w-full" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="space-y-4 max-w-5xl">
        <BackButton onClick={() => navigate('/dispositivos')} />
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar a ficha IRR-V1</AlertTitle>
          <AlertDescription>
            {query.error instanceof Error ? query.error.message : 'Erro de conexão.'}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const snap = query.data!
  const titulo = nomeAmigavel || snap.device.serial

  // Fase 1 mock: bomba sempre desligada, contador zerado, indicadores mockados
  // com servidor=true, dispositivoOnline=? (depende de GET /dispositivos que
  // no dispatcher vem via apelido+serial; por ora true estático).
  // Fase 2 liga isso à realidade.
  const bombaLigada = false
  const setoresHabilitados = snap.sectors.filter((s) => s.habilitado)
  const setoresOcultos = snap.sectors.filter((s) => !s.habilitado)

  return (
    <div className="space-y-6 max-w-5xl">
      <BackButton onClick={() => navigate('/dispositivos')} />

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight truncate">{titulo}</h2>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {snap.device.serial} · {snap.device.modelo}
          </p>
        </div>
        <Badge className="bg-emerald-600 hover:bg-emerald-600 self-start">
          Online
        </Badge>
      </div>

      <IndicadoresStatusBar
        servidor={true}
        dispositivoOnline={true}
        mqtt={true}
        wifiDevice={true}
        horaSincronizada={true}
      />

      {snap.active_alarms.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>{snap.active_alarms.length} alarme(s) ativo(s)</AlertTitle>
          <AlertDescription>
            {snap.active_alarms.map((a) => a.tipo).join(', ')}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bomba</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row items-center gap-6">
          <BombaSvgAnimada ligada={bombaLigada} mode={null} seconds={0} />
          <div className="flex-1 space-y-3 w-full">
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Modo</p>
                <p className="font-medium">{snap.config?.modo_operacao ?? 'manual'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Tipo</p>
                <p className="font-medium">{snap.config?.tipo_bomba ?? 'monofasica'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Max contínuo</p>
                <p className="font-medium">{snap.config?.tempo_max_continuo_bomba_min ?? 120} min</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Reforço relé</p>
                <p className="font-medium">{snap.config?.reforco_rele_ativo ? 'Ativo' : 'Inativo'}</p>
              </div>
            </div>
            <div className="pt-1">
              <Button disabled className="w-full sm:w-auto h-11">
                <Power className="h-4 w-4 mr-2" />
                {bombaLigada ? 'Desligar bomba' : 'Ligar bomba'}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">
                Comandos serão ligados na Fase 2.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            Setores{' '}
            <span className="text-muted-foreground">
              ({setoresHabilitados.length} ativo{setoresHabilitados.length === 1 ? '' : 's'})
            </span>
          </h3>
          <Button variant="outline" size="sm" asChild>
            <Link to="#" onClick={(e) => e.preventDefault()}>
              <Settings className="h-4 w-4 mr-1" />
              Configurar
            </Link>
          </Button>
        </div>

        {setoresHabilitados.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhum setor habilitado. Ative os setores que vai usar na tela de
            configurações técnicas.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {setoresHabilitados.map((s: IrrigationSector) => (
              <SetorCardValvula key={s.id} setor={s} />
            ))}
          </div>
        )}

        {setoresOcultos.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {setoresOcultos.length} setor(es) desabilitado(s) — acesse a tela
            técnica pra ativar.
          </p>
        )}
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Temperatura</CardTitle>
        </CardHeader>
        <CardContent>
          {snap.sensors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum sensor DS18B20 configurado.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {snap.sensors.map((s) => (
                <div key={s.id} className="rounded-md border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.nome}</p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {s.ultima_leitura_c?.toFixed(1) ?? '—'}
                    <span className="text-sm text-muted-foreground ml-1">°C</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled>Automações</Button>
        <Button variant="outline" disabled>Histórico</Button>
        <Button variant="outline" disabled>Tela técnica</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Telas secundárias (automações, histórico, técnica, alarmes) chegam nas
        Fases 2–5.
      </p>
    </div>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <ArrowLeft className="h-4 w-4 mr-1" />
      Voltar
    </Button>
  )
}
