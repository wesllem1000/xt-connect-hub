export type TriggerType =
  | 'irrigation_alarm_created'
  | 'device_offline'
  | 'manual'

export type AutomationStatus =
  | 'success'
  | 'partial'
  | 'failed'
  | 'skipped_cooldown'

export type AcaoSendEmail = {
  type: 'send_email'
  params: {
    recipients: string[]
    subject?: string
    body_text?: string
  }
}

export type AcaoPublishCommand = {
  type: 'publish_command'
  params: {
    cmd:
      | 'pump_off'
      | 'safe_closure'
      | 'sector_open'
      | 'sector_close'
      | 'sector_pause'
      | 'sector_resume'
      | 'mode_set'
    params?: Record<string, unknown>
  }
}

export type AutomationAcao = AcaoSendEmail | AcaoPublishCommand

export type AutomationRule = {
  id: string
  owner_user_id: string
  device_id: string | null
  device_serial?: string | null
  device_nome?: string | null
  nome: string
  descricao: string | null
  ativo: boolean
  trigger_type: TriggerType
  trigger_params: Record<string, unknown>
  condicoes: unknown[]
  acoes: AutomationAcao[]
  cooldown_minutes: number
  last_fired_at: string | null
  last_status: AutomationStatus | null
  criado_em: string
  atualizado_em: string
}

export type AutomationExecution = {
  id: string
  rule_id: string
  triggered_at: string
  trigger_payload: Record<string, unknown>
  status: AutomationStatus
  acoes_executadas: { type: string; ok: boolean; error?: string }[]
  error: string | null
}
