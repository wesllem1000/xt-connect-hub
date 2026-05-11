import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { extractApiError } from '@/lib/api'

import { ackAlarmStep } from '../api'

/** Tempo em ms para o step-2 expirar e reverter para 'open' via step-1 reset. */
const TIMEOUT_MS = 30_000

export type AckUiState =
  | 'idle'          // sem ACK em andamento
  | 'pending_step1' // aguardando resposta HTTP do step=1
  | 'awaiting_step2'// step=1 confirmado; aguardando 2º click (timer ativo)
  | 'pending_step2' // aguardando resposta HTTP do step=2

export type UseAckAlarmReturn = {
  uiState: AckUiState
  /** Segundos restantes para step-2 expirar (0 quando não em awaiting_step2). */
  secondsLeft: number
  /** Chamar no 1º click. */
  triggerStep1: (alarmId: string) => Promise<void>
  /** Chamar no 2º click (só válido quando uiState === 'awaiting_step2'). */
  triggerStep2: () => Promise<void>
}

export function useAckAlarm(deviceId: string | undefined): UseAckAlarmReturn {
  const [uiState, setUiState] = useState<AckUiState>('idle')
  const [secondsLeft, setSecondsLeft] = useState(0)

  // Refs para poder acessar valores atuais dentro de callbacks sem re-render
  const currentAlarmId = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /** Cancela timer de expiração e tick de contagem regressiva. */
  function clearTimers() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (tickRef.current)  { clearInterval(tickRef.current); tickRef.current = null }
    setSecondsLeft(0)
  }

  /** Reverte para 'open' via step-1 reset (chamado ao timeout). */
  const revertToOpen = useCallback(async () => {
    const id = currentAlarmId.current
    if (!id || !deviceId) return
    setUiState('idle')
    currentAlarmId.current = null
    try {
      // Backend: step=1 com acked_at > 30s → reverte para 'open' e publica retained
      await ackAlarmStep(deviceId, id, 1)
    } catch {
      // Silencioso — o backend já tem lógica de timeout própria;
      // o frontend apenas garante a tentativa de reset
    }
  }, [deviceId])

  useEffect(() => {
    return () => { clearTimers() }
  }, [])

  const triggerStep1 = useCallback(async (alarmId: string) => {
    if (!deviceId) return
    // Cancela qualquer timer pendente de um ACK anterior
    clearTimers()
    currentAlarmId.current = alarmId

    setUiState('pending_step1')
    try {
      await ackAlarmStep(deviceId, alarmId, 1)
      setUiState('awaiting_step2')

      // Inicia contagem regressiva
      setSecondsLeft(Math.floor(TIMEOUT_MS / 1000))
      tickRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) return 0
          return s - 1
        })
      }, 1000)

      // Timeout: se step-2 não vier, reverte
      timerRef.current = setTimeout(() => {
        clearTimers()
        void revertToOpen()
      }, TIMEOUT_MS)

      toast.info('Alarme reconhecido. Confirme definitivamente em até 30s.')
    } catch (err) {
      setUiState('idle')
      currentAlarmId.current = null
      const msg = await extractApiError(err, 'Falha ao reconhecer alarme')
      toast.error(msg)
    }
  }, [deviceId, revertToOpen])

  const triggerStep2 = useCallback(async () => {
    const alarmId = currentAlarmId.current
    if (!deviceId || !alarmId || uiState !== 'awaiting_step2') return

    clearTimers()
    setUiState('pending_step2')
    try {
      await ackAlarmStep(deviceId, alarmId, 2)
      // Backend publica retained com ack_state='acknowledged_final'
      // useAlarmMqtt vai receber e setar alarm=null → banner some automaticamente
      setUiState('idle')
      currentAlarmId.current = null
      toast.success('Alarme encerrado com sucesso.')
    } catch (err) {
      // Volta para awaiting_step2 se der erro — mantém o alarm_id
      setUiState('awaiting_step2')
      // Reinicia o timer do ponto atual (não do início)
      const remaining = secondsLeft
      if (remaining > 0) {
        timerRef.current = setTimeout(() => {
          clearTimers()
          void revertToOpen()
        }, remaining * 1000)
        tickRef.current = setInterval(() => {
          setSecondsLeft((s) => (s <= 1 ? 0 : s - 1))
        }, 1000)
      } else {
        // Timeout já estourou durante a chamada HTTP
        void revertToOpen()
      }
      const msg = await extractApiError(err, 'Falha na confirmação definitiva')
      toast.error(msg)
    }
  }, [deviceId, uiState, secondsLeft, revertToOpen])

  return { uiState, secondsLeft, triggerStep1, triggerStep2 }
}
