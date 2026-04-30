// E4.1 — tipos do módulo IRR-V1

export type IrrigationModoOperacao = 'manual' | 'automatico'
export type TipoBomba = 'monofasica' | 'bifasica' | 'trifasica' | 'inverter'
export type NivelAtivo = 'high' | 'low'
export type TipoBotaoFisico =
  | 'pulso_alterna'
  | 'pulso_liga'
  | 'pulso_desliga'
  | 'retentivo'

export type IrrigationConfig = {
  device_id: string
  protocol_version: number
  modo_operacao: IrrigationModoOperacao
  /** Modo bomba standalone (sem setores). Default true preserva comportamento. */
  sectorization_enabled: boolean
  tipo_bomba: TipoBomba
  reforco_rele_ativo: boolean
  nivel_ativo_bomba: NivelAtivo
  atraso_abrir_valvula_antes_bomba_s: number
  tempo_bomba_desligada_antes_fechar_valvula_s: number
  atraso_religar_bomba_apos_fechamento_s: number
  tempo_max_continuo_bomba_min: number
  tempo_max_manual_local_min: number
  tempo_max_manual_remoto_sem_internet_min: number
  botao_fisico_tipo: TipoBotaoFisico
  botao_debounce_ms: number
  botao_assume_manual: boolean
  gpio_1wire: number
  criado_em: string
  atualizado_em: string
}

export type IrrigationSector = {
  id: string
  device_id?: string
  numero: number
  nome: string
  habilitado: boolean
  pausado: boolean
  gpio_rele: number
  nivel_ativo_rele: NivelAtivo
  tipo_botao_fisico: TipoBotaoFisico | null
  gpio_botao: number | null
  debounce_ms: number
  ultimo_acionamento_em: string | null
  ultima_duracao_s: number | null
  proxima_execucao_em: string | null
}

export type TimerTipo = 'fixed' | 'cyclic_window' | 'cyclic_continuous'
export type TimerAlvoTipo = 'pump' | 'sector'

export type IrrigationTimer = {
  id: string
  device_id: string
  alvo_tipo: TimerAlvoTipo
  alvo_id: string | null
  tipo: TimerTipo
  nome: string
  ativo: boolean
  pausado: boolean
  hora_inicio: string | null
  hora_fim: string | null
  duracao_min: number | null
  on_minutes: number | null
  off_minutes: number | null
  duracao_s: number | null
  on_seconds: number | null
  off_seconds: number | null
  dias_semana: number
  overlap_confirmed: boolean
  observacao: string | null
  criado_em: string
  atualizado_em: string
}

export type SensorRole = 'pump' | 'inverter' | 'custom'

export type IrrigationTemperatureSensor = {
  id: string
  device_id: string
  rom_id: string
  nome: string
  role: SensorRole
  nome_custom: string | null
  limite_alarme_c: number
  histerese_c: number
  ack_usuario_requerido: boolean
  ativo: boolean
  presente: boolean
  ultima_leitura_c: number | null
  ultimo_contato_em: string | null
  criado_em: string
  atualizado_em: string
}

export type IrrigationEventType =
  | 'pump_on_manual' | 'pump_off_manual' | 'pump_on_auto' | 'pump_off_auto_end'
  | 'pump_off_safety' | 'sector_opened' | 'sector_closed'
  | 'safe_closure_started' | 'safe_closure_completed'
  | 'last_sector_closed_pump_on'
  | 'confirmation_requested' | 'confirmation_accepted' | 'confirmation_cancelled'
  | 'remote_cmd_received' | 'remote_cmd_executed' | 'remote_cmd_refused'
  | 'wifi_connected' | 'wifi_disconnected' | 'mqtt_connected' | 'mqtt_disconnected'
  | 'time_synced' | 'time_invalid'
  | 'timer_created' | 'timer_edited' | 'timer_paused' | 'timer_reactivated' | 'timer_removed'
  | 'temp_alarm_triggered' | 'temp_alarm_ack_user' | 'temp_sensor_lost'
  | 'physical_button_pressed' | 'auto_shutoff_max_time'

export type EventOrigem =
  | 'automatic' | 'manual_app_local' | 'manual_app_remote'
  | 'physical_button' | 'safety'

export type IrrigationEvent = {
  device_id: string
  event_uuid: string
  event_type: IrrigationEventType
  alvo_tipo: TimerAlvoTipo | null
  alvo_id: string | null
  origem: EventOrigem | null
  resultado: string | null
  duracao_s: number | null
  payload_json: Record<string, unknown>
  ts: string
  ingested_at: string
}

export type AlarmeTipo =
  | 'temperature_high'
  | 'sensor_missing'
  | 'pump_runtime_exceeded'
  | 'communication_lost'

export type IrrigationAlarme = {
  id: string
  device_id: string
  tipo: AlarmeTipo
  sensor_rom_id: string | null
  message: string
  triggered_at: string
  acked_by_user_id: string | null
  acked_at: string | null
  resolved_at: string | null
  payload_json: Record<string, unknown>
}

/** Estado volátil reportado pelo firmware via MQTT `devices/<serial>/state` (retained). */
export type DeviceStatePayload = {
  protocol_version?: number
  ts?: string
  pump?: {
    state?: 'off' | 'starting' | 'on' | 'stopping'
    source?: string | null
    started_at?: string | null
    scheduled_off_at?: string | null
  }
  sectors?: Array<{
    numero?: number
    estado?: 'closed' | 'opening' | 'open' | 'closing' | 'paused'
    source?: string | null
    opened_at?: string | null
    scheduled_close_at?: string | null
  }>
  indicators?: { wifi?: boolean; mqtt?: boolean; time_valid?: boolean }
  last_event_uuid?: string
  _received_at?: string
}

export type IrrigationSnapshot = {
  device: { id: string; serial: string; modelo: string }
  config: IrrigationConfig | null
  sectors: IrrigationSector[]
  timers: IrrigationTimer[]
  sensors: IrrigationTemperatureSensor[]
  /** ROM IDs DS18B20 detectados pelo firmware no barramento agora.
   *  UI usa pra computar "sensores detectados" = bus_rom_ids \ sensors[].rom_id. */
  bus_rom_ids: string[]
  active_alarms: IrrigationAlarme[]
  state: DeviceStatePayload | null
}
