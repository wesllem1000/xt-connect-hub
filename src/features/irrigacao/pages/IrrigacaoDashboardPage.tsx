import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Settings } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { BombaCommandButton } from '../components/BombaCommandButton'
import { BombaSvgAnimada } from '../components/BombaSvgAnimada'
import { IndicadoresStatusBar } from '../components/IndicadoresStatusBar'
import { SetorCardValvula } from '../components/SetorCardValvula'
import { useComando } from '../hooks/useComando'
import { useDeviceStateLive } from '../hooks/useDeviceStateLive'
import { useIrrigationSnapshot } from '../hooks/useSnapshot'
import type { IrrigationModoOperacao, IrrigationSector } from '../types'

type PumpState = 'off' | 'starting' | 'on' | 'stopping'
type SectorEstado = 'closed' | 'opening' | 'open' | 'closing' | 'paused'

type StatePump = {
  state?: PumpState
  source?: string | null
  started_at?: string | null
  scheduled_off_at?: string | null
}

type StateSector = { numero?: number; estado?: SectorEstado }

type StatePayload = {
  pump?: StatePump
  sectors?: StateSector[]
  indicators?: { wifi?: boolean; mqtt?: boolean; time_valid?: boolean }
  _received_at?: string
}

type Props = {
  deviceId: string
  nomeAmigavel?: string | null
}

export function IrrigacaoDashboardPage({ deviceId, nomeAmigavel }: Props) {
  const navigate = useNavigate()
  const query = useIrrigationSnapshot(deviceId)
  // Serial pra subscribe MQTT — vem do snapshot; hook é no-op até termos
  const serial = query.data?.device.serial
  useDeviceStateLive(serial, deviceId)

  // Mutation compartilhada para setores; rastreia localmente qual setor
  // despachou o comando pra desabilitar só o card tocado.
  const setorCmd = useComando(deviceId)
  const [pendingSetorNumero, setPendingSetorNumero] = useState<number | null>(null)

  // Mutation separada pro toggle de modo (evita state cruzado com setores).
  const modeCmd = useComando(deviceId)

  // Contador local pro display HH:MM:SS atualizar sem refetch
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(i)
  }, [])
  void tick // consome pra lint

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
  const state = (snap.state ?? null) as StatePayload | null
  const titulo = nomeAmigavel || snap.device.serial

  const pump = state?.pump ?? {}
  const pumpState: PumpState = (pump.state as PumpState) ?? 'off'
  const indicators = state?.indicators ?? {}

  // Mapa setor número → estado volátil do state
  const setorEstadoMap = new Map<number, SectorEstado>()
  for (const s of state?.sectors ?? []) {
    if (typeof s.numero === 'number' && s.estado) setorEstadoMap.set(s.numero, s.estado)
  }

  // Contador central da bomba
  const counterMode: 'ligada_ha' | 'desliga_em' | null =
    pumpState === 'on' && pump.scheduled_off_at
      ? 'desliga_em'
      : pumpState === 'on' && pump.started_at
      ? 'ligada_ha'
      : null
  const counterSeconds = computeCounterSeconds(pumpState, pump)

  const setoresHabilitados = snap.sectors.filter((s) => s.habilitado)

  async function beforePumpOn(): Promise<boolean> {
    if (setoresHabilitados.length === 0) {
      return window.confirm(
        'Todos os setores estão desligados. Deseja mesmo ligar a bomba?',
      )
    }
    return true
  }

  async function beforePumpOff(): Promise<boolean> {
    const abertos = (state?.sectors ?? []).filter((s) => s.estado === 'open')
    if (abertos.length > 0) {
      return window.confirm(
        `Há ${abertos.length} setor(es) aberto(s). Desligar a bomba mesmo assim?`,
      )
    }
    return true
  }

  const bombaLigada = pumpState === 'on' || pumpState === 'stopping'

  const modoOperacao: IrrigationModoOperacao = snap.config?.modo_operacao ?? 'manual'
  const modoPending = modeCmd.isPending

  function handleToggleMode() {
    if (modoPending) return
    const novo: IrrigationModoOperacao = modoOperacao === 'manual' ? 'automatico' : 'manual'
    const label = novo === 'manual' ? 'Manual' : 'Auto'
    if (!window.confirm(`Mudar modo de operação para ${label}?`)) return
    modeCmd.mutate({ cmd: 'mode_set', params: { modo: novo } })
  }

  function handleSetorClick(s: IrrigationSector) {
    const estadoFw = setorEstadoMap.get(s.numero)
    // transients do firmware bloqueiam click
    if (estadoFw === 'opening' || estadoFw === 'closing') return
    if (setorCmd.isPending) return
    const abrir = estadoFw !== 'open'
    const acao = abrir ? 'Abrir' : 'Fechar'
    if (!window.confirm(`${acao} setor "${s.nome}"?`)) return
    setPendingSetorNumero(s.numero)
    setorCmd.mutate(
      {
        cmd: abrir ? 'sector_open' : 'sector_close',
        params: { numero: s.numero },
      },
      {
        onSettled: () => setPendingSetorNumero(null),
      },
    )
  }

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
        <div className="flex items-center gap-3 self-start">
          <ModoToggle
            modo={modoOperacao}
            pending={modoPending}
            onToggle={handleToggleMode}
          />
          <Badge
            className={
              state
                ? 'bg-emerald-600 hover:bg-emerald-600'
                : 'bg-slate-500 hover:bg-slate-500'
            }
          >
            {state ? 'Online' : 'Aguardando state'}
          </Badge>
        </div>
      </div>

      <IndicadoresStatusBar
        servidor={true}
        dispositivoOnline={Boolean(state)}
        mqtt={indicators.mqtt ?? false}
        wifiDevice={indicators.wifi ?? false}
        horaSincronizada={indicators.time_valid ?? false}
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
          <BombaSvgAnimada
            ligada={bombaLigada}
            mode={counterMode}
            seconds={counterSeconds}
          />
          <div className="flex-1 space-y-3 w-full">
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <Info label="Modo" value={snap.config?.modo_operacao ?? 'manual'} />
              <Info label="Tipo" value={snap.config?.tipo_bomba ?? 'monofasica'} />
              <Info label="Max contínuo" value={`${snap.config?.tempo_max_continuo_bomba_min ?? 120} min`} />
              <Info label="Reforço relé" value={snap.config?.reforco_rele_ativo ? 'Ativo' : 'Inativo'} />
            </div>
            <div className="pt-1">
              <BombaCommandButton
                deviceId={deviceId}
                pumpState={pumpState}
                onBeforePumpOn={beforePumpOn}
                onBeforePumpOff={beforePumpOff}
              />
              {!state && (
                <p className="text-xs text-muted-foreground mt-1">
                  Aguardando state do dispositivo — botão pode não refletir estado real.
                </p>
              )}
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
            Nenhum setor habilitado. Ative os setores na tela técnica.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {setoresHabilitados.map((s: IrrigationSector) => {
              const estadoFw = setorEstadoMap.get(s.numero)
              const transientFw = estadoFw === 'opening' || estadoFw === 'closing'
              const pendingThis = pendingSetorNumero === s.numero
              const disabled = transientFw || setorCmd.isPending
              return (
                <SetorCardValvula
                  key={s.id}
                  setor={s}
                  estadoLive={estadoFw}
                  disabled={disabled}
                  pending={pendingThis}
                  onClick={disabled ? undefined : () => handleSetorClick(s)}
                />
              )
            })}
          </div>
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
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {s.nome}
                  </p>
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
        <Button variant="outline" disabled>Automações (Fase 2B+)</Button>
        <Button variant="outline" disabled>Histórico (Fase 2B+)</Button>
        <Button variant="outline" disabled>Tela técnica</Button>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  )
}

function ModoToggle({
  modo,
  pending,
  onToggle,
}: {
  modo: IrrigationModoOperacao
  pending: boolean
  onToggle: () => void
}) {
  const isAuto = modo === 'automatico'
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs',
        pending && 'opacity-60',
      )}
    >
      <span className="text-muted-foreground uppercase tracking-wide">Modo</span>
      <div className="inline-flex rounded-sm overflow-hidden border">
        <button
          type="button"
          disabled={pending || isAuto}
          onClick={isAuto ? undefined : onToggle}
          className={cn(
            'px-2 py-0.5 font-medium transition-colors',
            isAuto
              ? 'bg-emerald-600 text-white'
              : 'bg-background text-muted-foreground hover:bg-muted',
            pending && 'cursor-not-allowed',
          )}
          aria-pressed={isAuto}
        >
          Auto
        </button>
        <button
          type="button"
          disabled={pending || !isAuto}
          onClick={!isAuto ? undefined : onToggle}
          className={cn(
            'px-2 py-0.5 font-medium transition-colors',
            !isAuto
              ? 'bg-slate-700 text-white'
              : 'bg-background text-muted-foreground hover:bg-muted',
            pending && 'cursor-not-allowed',
          )}
          aria-pressed={!isAuto}
        >
          Manual
        </button>
      </div>
      {pending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
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

function computeCounterSeconds(pumpState: string, pump: StatePump): number {
  if (pumpState !== 'on') return 0
  if (pump.scheduled_off_at) {
    const diff = (new Date(pump.scheduled_off_at).getTime() - Date.now()) / 1000
    return Math.max(0, Math.floor(diff))
  }
  if (pump.started_at) {
    const diff = (Date.now() - new Date(pump.started_at).getTime()) / 1000
    return Math.max(0, Math.floor(diff))
  }
  return 0
}
