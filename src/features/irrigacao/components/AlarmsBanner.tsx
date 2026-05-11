import { AlertTriangle, CheckCheck, ShieldAlert, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { useAckAlarm } from '../hooks/useAckAlarm'
import { useAlarmMqtt } from '../hooks/useAlarmMqtt'

const TIPO_LABEL: Record<string, string> = {
  temperature_high:       'Temperatura alta',
  sensor_missing:         'Sensor perdido',
  pump_runtime_exceeded:  'Bomba excedeu tempo máximo',
  communication_lost:     'Comunicação perdida',
}

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

type Props = {
  /** UUID do device no Postgres (para chamadas REST de ACK). */
  deviceId: string
  /** Serial MQTT (ex.: IRR-V1-00009) — necessário para subscrição MQTT. */
  serial: string | undefined
}

/**
 * Banner de alarme persistente — consome `devices/<serial>/alarm/active` (retained).
 *
 * Fluxo de ACK duplo:
 *   1º click → POST /alarmes/ack { step:1 } → backend publica retained ack_state='acknowledged_once'
 *   2º click (até 30s) → POST /alarmes/ack { step:2 } → backend publica ack_state='acknowledged_final'
 *   → banner some porque useAlarmMqtt detecta 'acknowledged_final' e retorna null
 *
 * Timeout: se o 2º click não vir em 30s, o frontend chama step=1 novamente
 * (backend reverte ack_state para 'open') e o banner volta ao estado inicial.
 */
export function AlarmsBanner({ deviceId, serial }: Props) {
  const alarm = useAlarmMqtt(serial)
  const ack   = useAckAlarm(deviceId)

  if (!alarm) return null

  const isCritico = alarm.severity === 'critico'

  const bannerCls = cn(
    'sticky top-0 z-40 w-full px-4 py-3 text-white',
    'flex flex-col gap-2',
    isCritico
      ? 'bg-red-600 animate-pulse'
      : 'bg-yellow-500',
  )

  const isAwaiting = ack.uiState === 'awaiting_step2'
  const isPending   = ack.uiState === 'pending_step1' || ack.uiState === 'pending_step2'

  return (
    <div
      role="alert"
      aria-live={isCritico ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={bannerCls}
    >
      {/* Linha principal: ícone + tipo + mensagem */}
      <div className="flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm uppercase tracking-wide leading-tight">
            {TIPO_LABEL[alarm.kind] ?? alarm.kind}
            {' '}
            <span className="font-normal normal-case">
              — {alarm.message}
            </span>
          </p>
          <p className="text-[11px] opacity-80 mt-0.5">
            Desde {fmtTs(alarm.since)}
            {alarm.ack_state === 'acknowledged_once' && (
              <span className="ml-2 font-semibold">
                · Aguardando confirmação definitiva...
              </span>
            )}
          </p>
        </div>

        {/* Botões de ACK */}
        <div className="flex items-center gap-2 shrink-0">
          {!isAwaiting && (
            <Button
              size="sm"
              variant="outline"
              className={cn(
                'border-white/70 text-white hover:bg-white/20 hover:text-white',
                isCritico
                  ? 'bg-white/10'
                  : 'bg-yellow-600/30',
              )}
              disabled={isPending}
              onClick={() => void ack.triggerStep1(alarm.alarm_id)}
              aria-label="Reconhecer alarme (primeiro passo)"
            >
              <AlertTriangle className="h-4 w-4 mr-1" aria-hidden="true" />
              {isPending && ack.uiState === 'pending_step1' ? 'Enviando…' : 'Reconhecer'}
            </Button>
          )}

          {isAwaiting && (
            <>
              <span className="text-[11px] opacity-80 tabular-nums">
                {ack.secondsLeft}s
              </span>
              <Button
                size="sm"
                variant="outline"
                className="border-white/70 bg-white/20 text-white hover:bg-white/30 hover:text-white font-bold"
                disabled={isPending}
                onClick={() => void ack.triggerStep2()}
                aria-label="Confirmar encerramento definitivo do alarme"
              >
                <CheckCheck className="h-4 w-4 mr-1" aria-hidden="true" />
                {isPending && ack.uiState === 'pending_step2'
                  ? 'Encerrando…'
                  : 'Confirmar definitivamente'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-white/70 hover:text-white hover:bg-white/10 text-[11px] px-2"
                onClick={() => void ack.triggerStep1(alarm.alarm_id)}
                aria-label="Cancelar e voltar ao estado inicial do alarme"
              >
                Cancelar
              </Button>
            </>
          )}

          <ShieldCheck className="h-5 w-5 opacity-50 hidden sm:block" aria-hidden="true" />
        </div>
      </div>

      {/* Aviso contextual no estado awaiting */}
      {isAwaiting && (
        <p className="text-[11px] opacity-80 pl-8">
          Bomba e setores permanecem cortados. Confirme definitivamente apenas após verificar
          que o problema foi resolvido. O ACK será cancelado automaticamente em {ack.secondsLeft}s
          se não confirmado.
        </p>
      )}

      {/* Aviso inicial */}
      {!isAwaiting && ack.uiState === 'idle' && (
        <p className="text-[11px] opacity-70 pl-8">
          {isCritico
            ? 'Bomba e setores foram cortados como proteção. Reconheça o alarme e confirme após resolver o problema.'
            : 'Verifique o sensor e reconheça quando resolvido.'}
        </p>
      )}
    </div>
  )
}
