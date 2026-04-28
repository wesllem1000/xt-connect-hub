import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Clock,
  Filter,
  History,
  Loader2,
  Power,
  Radio,
  Settings,
  ShieldAlert,
  Wifi,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

import { getEvents } from '../api'
import type {
  EventOrigem,
  IrrigationEvent,
  IrrigationEventType,
} from '../types'

type Category =
  | 'manual'
  | 'automacao'
  | 'conectividade'
  | 'mqtt'
  | 'seguranca'
  | 'sistema'

type FilterValue = 'tudo' | Category

const CATEGORY_CONFIG: Record<
  Category,
  { label: string; icon: typeof Power; color: string }
> = {
  manual: { label: 'Manual', icon: Power, color: 'text-blue-500' },
  automacao: { label: 'Automação', icon: Clock, color: 'text-emerald-500' },
  conectividade: { label: 'Rede', icon: Wifi, color: 'text-amber-500' },
  mqtt: { label: 'MQTT', icon: Radio, color: 'text-purple-500' },
  seguranca: { label: 'Alertas', icon: ShieldAlert, color: 'text-destructive' },
  sistema: { label: 'Sistema', icon: Settings, color: 'text-muted-foreground' },
}

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'tudo', label: 'Tudo' },
  { value: 'manual', label: 'Manual' },
  { value: 'automacao', label: 'Automação' },
  { value: 'conectividade', label: 'Rede' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'seguranca', label: 'Alertas' },
  { value: 'sistema', label: 'Sistema' },
]

function categorize(
  type: IrrigationEventType,
  origem: EventOrigem | null,
): Category {
  switch (type) {
    case 'pump_on_manual':
    case 'pump_off_manual':
    case 'physical_button_pressed':
    case 'remote_cmd_received':
    case 'remote_cmd_executed':
    case 'remote_cmd_refused':
    case 'confirmation_requested':
    case 'confirmation_accepted':
    case 'confirmation_cancelled':
      return 'manual'
    case 'pump_on_auto':
    case 'pump_off_auto_end':
    case 'timer_created':
    case 'timer_edited':
    case 'timer_paused':
    case 'timer_reactivated':
    case 'timer_removed':
      return 'automacao'
    case 'sector_opened':
    case 'sector_closed':
      return origem === 'automatic' ? 'automacao' : 'manual'
    case 'pump_off_safety':
    case 'safe_closure_started':
    case 'safe_closure_completed':
    case 'last_sector_closed_pump_on':
    case 'temp_alarm_triggered':
    case 'temp_alarm_ack_user':
    case 'temp_sensor_lost':
    case 'auto_shutoff_max_time':
      return 'seguranca'
    case 'wifi_connected':
    case 'wifi_disconnected':
      return 'conectividade'
    case 'mqtt_connected':
    case 'mqtt_disconnected':
      return 'mqtt'
    case 'time_synced':
    case 'time_invalid':
      return 'sistema'
    default:
      return 'sistema'
  }
}

function describe(ev: IrrigationEvent): string {
  const alvo = ev.alvo_id ? ` (${ev.alvo_tipo}=${ev.alvo_id})` : ''
  switch (ev.event_type) {
    case 'pump_on_manual':
      return `Bomba ligada manualmente`
    case 'pump_off_manual':
      return `Bomba desligada manualmente`
    case 'pump_on_auto':
      return `Bomba ligada por automação`
    case 'pump_off_auto_end':
      return `Bomba desligada (timer terminou)`
    case 'pump_off_safety':
      return `Bomba desligada por segurança`
    case 'sector_opened':
      return `Setor aberto${alvo}`
    case 'sector_closed':
      return `Setor fechado${alvo}`
    case 'safe_closure_started':
      return `Fechamento seguro iniciado`
    case 'safe_closure_completed':
      return `Fechamento seguro concluído`
    case 'last_sector_closed_pump_on':
      return `Último setor fechado com bomba ligada`
    case 'confirmation_requested':
      return `Confirmação solicitada ao usuário`
    case 'confirmation_accepted':
      return `Confirmação aceita`
    case 'confirmation_cancelled':
      return `Confirmação cancelada`
    case 'remote_cmd_received':
      return `Comando remoto recebido`
    case 'remote_cmd_executed':
      return `Comando remoto executado`
    case 'remote_cmd_refused':
      return `Comando remoto recusado${ev.resultado ? ` (${ev.resultado})` : ''}`
    case 'wifi_connected':
      return `Wi-Fi conectado`
    case 'wifi_disconnected':
      return `Wi-Fi desconectado`
    case 'mqtt_connected':
      return `MQTT conectado`
    case 'mqtt_disconnected':
      return `MQTT desconectado`
    case 'time_synced':
      return `Hora sincronizada`
    case 'time_invalid':
      return `Hora inválida`
    case 'timer_created':
      return `Timer criado`
    case 'timer_edited':
      return `Timer editado`
    case 'timer_paused':
      return `Timer pausado`
    case 'timer_reactivated':
      return `Timer reativado`
    case 'timer_removed':
      return `Timer removido`
    case 'temp_alarm_triggered':
      return `Alarme de temperatura`
    case 'temp_alarm_ack_user':
      return `Alarme de temperatura reconhecido`
    case 'temp_sensor_lost':
      return `Sensor de temperatura perdido`
    case 'physical_button_pressed':
      return `Botão físico pressionado`
    case 'auto_shutoff_max_time':
      return `Auto-desligamento por tempo máximo`
    default:
      return ev.event_type
  }
}

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const PAGE = 100

type Props = { deviceId: string }

export function HistoryTab({ deviceId }: Props) {
  const [filter, setFilter] = useState<FilterValue>('tudo')

  const query = useQuery({
    queryKey: ['irrigacao', 'events-history', deviceId],
    queryFn: () => getEvents(deviceId, { limit: PAGE }),
    refetchInterval: 30_000,
  })

  const eventos = query.data?.eventos ?? []
  const total = query.data?.paginacao.total ?? 0

  const filtered = useMemo(() => {
    if (filter === 'tudo') return eventos
    return eventos.filter(
      (e) => categorize(e.event_type, e.origem) === filter,
    )
  }, [eventos, filter])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <History className="h-5 w-5" />
          Histórico recente
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <History className="h-4 w-4 mr-1" />
          )}
          Atualizar
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={filter === f.value ? 'default' : 'outline'}
            onClick={() => setFilter(f.value)}
            className="h-7 text-xs"
          >
            <Filter className="h-3 w-3 mr-1" />
            {f.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="h-[420px] overflow-y-auto">
            {query.isPending ? (
              <div className="p-8 text-center text-muted-foreground">
                <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
                <p className="text-sm">Carregando histórico…</p>
              </div>
            ) : query.isError ? (
              <div className="p-8 text-center text-destructive">
                <p className="text-sm">Falha ao carregar histórico.</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Nenhum evento {filter !== 'tudo' ? 'nesse filtro' : 'registrado'}.</p>
                <p className="text-sm mt-1">
                  Eventos aparecem conforme o dispositivo opera.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((ev) => {
                  const cat = categorize(ev.event_type, ev.origem)
                  const cfg = CATEGORY_CONFIG[cat]
                  const Icon = cfg.icon
                  return (
                    <div
                      key={ev.event_uuid}
                      className="flex items-start gap-3 px-4 py-3"
                    >
                      <Icon
                        className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.color}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{describe(ev)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {fmtTs(ev.ts)}
                          {ev.duracao_s != null && ` · ${ev.duracao_s}s`}
                          {ev.origem && ` · ${ev.origem}`}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {cfg.label}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? 'evento' : 'eventos'} (de{' '}
        {total} no total)
        {filter !== 'tudo' &&
          ` · filtro: ${FILTERS.find((f) => f.value === filter)?.label}`}
      </p>
    </div>
  )
}
