import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Clock as ClockIcon,
  Cog,
  Construction,
  Hand,
  History,
  LayoutDashboard,
  Loader2,
  Power,
  Settings,
  Sliders,
  Terminal,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ThemeToggle } from '@/components/ThemeToggle'
import { cn } from '@/lib/utils'

import { BombaCommandButton } from '../components/BombaCommandButton'
import { IndicadoresStatusBar } from '../components/IndicadoresStatusBar'
import { PumpStatusCard, type PumpRuntime } from '../components/PumpStatusCard'
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

type ConfirmKind =
  | 'pump_on_without_sector'
  | 'pump_off_with_open_sector'
  | 'close_last_sector_with_pump_on'
  | 'mode_auto_to_manual_with_active'
  | 'mode_manual_to_auto_with_active'

type ConfirmState = {
  kind: ConfirmKind
  extra?: { abertos?: number; setorNome?: string }
  resolve: (ok: boolean) => void
}

export function IrrigacaoDashboardPage({ deviceId, nomeAmigavel }: Props) {
  const navigate = useNavigate()
  const query = useIrrigationSnapshot(deviceId)
  const serial = query.data?.device.serial
  useDeviceStateLive(serial, deviceId)

  const setorCmd = useComando(deviceId)
  const [pendingSetorNumero, setPendingSetorNumero] = useState<number | null>(null)
  const modeCmd = useComando(deviceId)

  const [, setTick] = useState(0)
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(i)
  }, [])

  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  function askConfirm(kind: ConfirmKind, extra?: ConfirmState['extra']): Promise<boolean> {
    return new Promise((resolve) => setConfirm({ kind, extra, resolve }))
  }
  function closeConfirm(ok: boolean) {
    if (confirm) confirm.resolve(ok)
    setConfirm(null)
  }

  // pumpRuntime tem que ficar antes dos early returns abaixo, senão o número
  // de hooks varia entre o render de loading e o render com dados (React #310).
  // Usa optional chaining no query.data porque pode ser undefined no primeiro render.
  const stateForRuntime = (query.data?.state ?? null) as StatePayload | null
  const pumpForRuntime = stateForRuntime?.pump ?? {}
  const pumpStateForRuntime: PumpState = (pumpForRuntime.state as PumpState) ?? 'off'

  // pumpRuntime estável entre pushes do MQTT — só recalcula quando started_at /
  // scheduled_off_at mudam. PumpStatusCard tem tick interno de 500ms pra
  // suavizar a contagem; passar segundos voláteis aqui causaria reset desse
  // interno a cada 1s do tick externo.
  const pumpRuntime: PumpRuntime | null = useMemo(() => {
    if (pumpStateForRuntime !== 'on') return null
    if (pumpForRuntime.scheduled_off_at) {
      const diff = Math.max(
        0,
        Math.floor((new Date(pumpForRuntime.scheduled_off_at).getTime() - Date.now()) / 1000),
      )
      return {
        active: true,
        mode: 'countdown',
        seconds: diff,
        remainingSec: diff,
        elapsedSec: 0,
      }
    }
    if (pumpForRuntime.started_at) {
      const diff = Math.max(
        0,
        Math.floor((Date.now() - new Date(pumpForRuntime.started_at).getTime()) / 1000),
      )
      return {
        active: true,
        mode: 'elapsed',
        seconds: diff,
        remainingSec: 0,
        elapsedSec: diff,
      }
    }
    return { active: true, mode: 'idle', seconds: 0, remainingSec: 0, elapsedSec: 0 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pumpStateForRuntime, pumpForRuntime.scheduled_off_at, pumpForRuntime.started_at])

  if (query.isPending) {
    return (
      <div className="space-y-4 max-w-5xl">
        <BackButton onClick={() => navigate('/dispositivos')} />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-56 w-full" />
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
  const state = stateForRuntime
  const titulo = nomeAmigavel || snap.device.serial

  const pumpState: PumpState = pumpStateForRuntime
  const indicators = state?.indicators ?? {}

  const setorEstadoMap = new Map<number, SectorEstado>()
  for (const s of state?.sectors ?? []) {
    if (typeof s.numero === 'number' && s.estado) setorEstadoMap.set(s.numero, s.estado)
  }

  const setoresHabilitados = snap.sectors.filter((s) => s.habilitado)
  const setoresAbertos = (state?.sectors ?? []).filter((s) => s.estado === 'open')
  const bombaLigada = pumpState === 'on' || pumpState === 'stopping'
  const algumaOperacaoAtiva = bombaLigada || setoresAbertos.length > 0

  const modoOperacao: IrrigationModoOperacao = snap.config?.modo_operacao ?? 'manual'
  const isAuto = modoOperacao === 'automatico'
  const modoPending = modeCmd.isPending

  async function beforePumpOn(): Promise<boolean> {
    // Firmware recusa hard → só informa usuário. Bloqueia commando antes dele
    // tocar no MQTT.
    if (setoresAbertos.length === 0) {
      await askConfirm('pump_on_without_sector')
      return false
    }
    return true
  }

  async function beforePumpOff(): Promise<boolean> {
    if (setoresAbertos.length > 0) {
      return askConfirm('pump_off_with_open_sector', { abertos: setoresAbertos.length })
    }
    return true
  }

  async function handleSetorClick(s: IrrigationSector) {
    const estadoFw = setorEstadoMap.get(s.numero)
    if (estadoFw === 'opening' || estadoFw === 'closing') return
    if (setorCmd.isPending) return
    const abrir = estadoFw !== 'open'

    // Caso (a) do plano: fechar ÚLTIMO setor com bomba ligada.
    if (
      !abrir &&
      bombaLigada &&
      setoresAbertos.length === 1 &&
      setoresAbertos[0].numero === s.numero
    ) {
      const ok = await askConfirm('close_last_sector_with_pump_on', { setorNome: s.nome })
      if (!ok) return
    }

    setPendingSetorNumero(s.numero)
    setorCmd.mutate(
      { cmd: abrir ? 'sector_open' : 'sector_close', params: { numero: s.numero } },
      { onSettled: () => setPendingSetorNumero(null) },
    )
  }

  async function handleToggleMode() {
    if (modoPending) return
    const novo: IrrigationModoOperacao = isAuto ? 'manual' : 'automatico'
    const send = () => modeCmd.mutate({ cmd: 'mode_set', params: { modo: novo } })

    if (!algumaOperacaoAtiva) {
      send()
      return
    }
    const kind: ConfirmKind = isAuto
      ? 'mode_auto_to_manual_with_active'
      : 'mode_manual_to_auto_with_active'
    const ok = await askConfirm(kind)
    if (ok) send()
  }

  return (
    <div className="-m-4 md:-m-8">
      {/* Sticky horizontal header — Lovable style, restrito a IRR-V1 */}
      <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-sm border-b">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-3 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-9 w-9"
            onClick={() => navigate('/dispositivos')}
            aria-label="Voltar para dispositivos"
          >
            <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm sm:text-lg font-bold truncate">{titulo}</h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground font-mono truncate">
              {snap.device.serial} · {snap.device.modelo}
            </p>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <Clock />
            <Badge
              className={cn(
                'shrink-0 text-[10px] sm:text-xs',
                state
                  ? 'bg-emerald-600 hover:bg-emerald-600'
                  : 'bg-slate-500 hover:bg-slate-500',
              )}
            >
              {state ? 'Online' : 'Aguardando'}
            </Badge>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
        <Tabs defaultValue="painel" className="w-full">
          <TabsList className="w-full flex flex-wrap h-auto gap-1 mb-4 justify-start">
            <TabsTrigger value="painel" className="gap-1.5">
              <LayoutDashboard className="h-4 w-4" />
              <span>Painel</span>
            </TabsTrigger>
            <TabsTrigger value="timers" className="gap-1.5">
              <ClockIcon className="h-4 w-4" />
              <span>Timers</span>
            </TabsTrigger>
            <TabsTrigger value="setores" className="gap-1.5">
              <Sliders className="h-4 w-4" />
              <span>Setores</span>
            </TabsTrigger>
            <TabsTrigger value="bomba" className="gap-1.5">
              <Power className="h-4 w-4" />
              <span>Bomba</span>
            </TabsTrigger>
            <TabsTrigger value="historico" className="gap-1.5">
              <History className="h-4 w-4" />
              <span>Histórico</span>
            </TabsTrigger>
            <TabsTrigger value="sistema" className="gap-1.5">
              <Cog className="h-4 w-4" />
              <span>Sistema</span>
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-1.5">
              <Terminal className="h-4 w-4" />
              <span>Logs</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="painel" className="space-y-6 mt-0">
            <ModoCard
        modo={modoOperacao}
        pending={modoPending}
        onToggle={handleToggleMode}
      />

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

      {isAuto && (
        <Alert>
          <Cog className="h-4 w-4" />
          <AlertTitle>Modo automático ativo</AlertTitle>
          <AlertDescription>
            Controles manuais estão desabilitados. Para comandar a bomba ou
            setores manualmente, troque o modo.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bomba</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row items-center gap-6">
          <PumpStatusCard
            pumpOn={bombaLigada}
            manualMode={!isAuto}
            pumpRuntime={pumpRuntime}
          />
          <div className="flex-1 space-y-3 w-full">
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <Info label="Modo" value={snap.config?.modo_operacao ?? 'manual'} />
              <Info label="Tipo" value={snap.config?.tipo_bomba ?? 'monofasica'} />
              <Info label="Max contínuo" value={`${snap.config?.tempo_max_continuo_bomba_min ?? 120} min`} />
              <Info label="Reforço relé" value={snap.config?.reforco_rele_ativo ? 'Ativo' : 'Inativo'} />
            </div>
            {!isAuto && (
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
            )}
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
              const clickable = !isAuto && !transientFw && !setorCmd.isPending
              return (
                <SetorCardValvula
                  key={s.id}
                  setor={s}
                  estadoLive={estadoFw}
                  disabled={!clickable}
                  pending={pendingThis}
                  onClick={clickable ? () => handleSetorClick(s) : undefined}
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
              <Button variant="outline" disabled>Automações (Sprint 2)</Button>
              <Button variant="outline" disabled>Tela técnica</Button>
            </div>
          </TabsContent>

          <TabsContent value="timers" className="mt-0">
            <TabPlaceholder
              icon={<ClockIcon className="h-8 w-8" />}
              title="Timers"
              description="Cadastro de timers e agendamentos por setor (firmware é autoridade do tempo). Em construção — vem na próxima rodada da Fase 1.2."
            />
          </TabsContent>

          <TabsContent value="setores" className="mt-0">
            <TabPlaceholder
              icon={<Sliders className="h-8 w-8" />}
              title="Setores"
              description="Configuração avançada: ativar/desativar setores, renomear, ajustar GPIO. Em construção."
            />
          </TabsContent>

          <TabsContent value="bomba" className="mt-0">
            <TabPlaceholder
              icon={<Power className="h-8 w-8" />}
              title="Bomba"
              description="Configuração da bomba: tipo, max contínuo, cooldown, reforço de relé. Em construção."
            />
          </TabsContent>

          <TabsContent value="historico" className="mt-0">
            <TabPlaceholder
              icon={<History className="h-8 w-8" />}
              title="Histórico"
              description="Histórico de eventos, comandos e alarmes do dispositivo. Em construção."
            />
          </TabsContent>

          <TabsContent value="sistema" className="mt-0">
            <TabPlaceholder
              icon={<Cog className="h-8 w-8" />}
              title="Sistema"
              description="Configurações de sistema: data/hora, telemetria, reset de fábrica. Em construção."
            />
          </TabsContent>

          <TabsContent value="logs" className="mt-0">
            <TabPlaceholder
              icon={<Terminal className="h-8 w-8" />}
              title="Logs"
              description="Logs internos do firmware. Em construção."
            />
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmDialog state={confirm} onClose={closeConfirm} />
    </div>
  )
}

function TabPlaceholder({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
        <div className="rounded-full bg-primary/10 p-4 text-primary">{icon}</div>
        <div className="space-y-1 max-w-md">
          <p className="text-lg font-semibold flex items-center justify-center gap-2">
            <Construction className="h-4 w-4 text-amber-600" />
            {title}
          </p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
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

function ModoCard({
  modo,
  pending,
  onToggle,
}: {
  modo: IrrigationModoOperacao
  pending: boolean
  onToggle: () => void
}) {
  const isAuto = modo === 'automatico'
  const Icon = isAuto ? Cog : Hand
  return (
    <Card
      className={cn(
        'border-2 transition-colors',
        isAuto ? 'border-emerald-500/60' : 'border-blue-500/60',
      )}
    >
      <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
              isAuto ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700',
            )}
          >
            <Icon className={cn('h-6 w-6', isAuto && 'animate-[spin_6s_linear_infinite]')} />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Modo de operação
            </p>
            <p className="text-2xl font-bold tracking-tight">
              {isAuto ? 'AUTOMÁTICO' : 'MANUAL'}
            </p>
            <p className="text-sm text-muted-foreground">
              {isAuto
                ? 'Rotinas programadas irão executar automaticamente'
                : 'Controle direto via app e botões físicos'}
            </p>
          </div>
        </div>
        <Button
          size="lg"
          variant="outline"
          onClick={onToggle}
          disabled={pending}
          className="self-stretch sm:self-auto"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : null}
          Mudar para {isAuto ? 'MANUAL' : 'AUTOMÁTICO'}
        </Button>
      </CardContent>
    </Card>
  )
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  const dia = dias[now.getDay()]
  const dmy =
    String(now.getDate()).padStart(2, '0') +
    '/' +
    String(now.getMonth() + 1).padStart(2, '0') +
    '/' +
    now.getFullYear()
  return (
    <div className="text-right font-mono leading-tight">
      <div className="text-sm tabular-nums">
        {hh}:{mm}:{ss}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {dia} {dmy}
      </div>
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

function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState | null
  onClose: (ok: boolean) => void
}) {
  const open = state !== null
  const kind = state?.kind
  const extra = state?.extra

  let title = ''
  let description = ''
  let confirmLabel: string | null = 'Confirmar'
  let destructive = false
  let dismissOnly = false

  if (kind === 'pump_on_without_sector') {
    title = 'Nenhum setor aberto'
    description =
      'Ligar a bomba sem nenhum setor aberto pode causar bomba seca e danificar o equipamento. Abra um setor primeiro.'
    confirmLabel = 'Entendi'
    dismissOnly = true
  } else if (kind === 'pump_off_with_open_sector') {
    title = 'Desligar bomba com setor aberto?'
    description = `Há ${extra?.abertos ?? 0} setor(es) aberto(s). Desligar a bomba agora vai interromper a irrigação nesses setores. Continuar?`
    confirmLabel = 'Desligar bomba'
    destructive = true
  } else if (kind === 'close_last_sector_with_pump_on') {
    title = 'Fechar setor e desligar bomba?'
    description = `"${extra?.setorNome ?? 'Setor'}" é o último setor aberto. Fechar vai também desligar a bomba automaticamente (safety). Deseja continuar?`
    confirmLabel = 'Fechar e desligar bomba'
    destructive = true
  } else if (kind === 'mode_auto_to_manual_with_active') {
    title = 'Parar operação automática?'
    description =
      'Isso vai desligar a bomba e fechar setores em execução antes de trocar para manual. Deseja continuar?'
    confirmLabel = 'Parar e mudar para manual'
    destructive = true
  } else if (kind === 'mode_manual_to_auto_with_active') {
    title = 'Ativar modo automático?'
    description =
      'Em modo automático, controles manuais serão bloqueados. A bomba e setores ativos continuam até o próximo timer decidir.'
    confirmLabel = 'Ativar automático'
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {!dismissOnly && (
            <AlertDialogCancel onClick={() => onClose(false)}>Cancelar</AlertDialogCancel>
          )}
          <AlertDialogAction
            onClick={() => onClose(true)}
            className={cn(
              destructive &&
                'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600',
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
