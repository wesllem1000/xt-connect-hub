import { useEffect, useState } from 'react'
import { Droplets, Loader2, Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { usePatchConfig } from '../hooks/usePatchConfig'
import type {
  IrrigationConfig,
  NivelAtivo,
  TipoBomba,
} from '../types'

type Props = {
  deviceId: string
  config: IrrigationConfig | null | undefined
  disabled?: boolean
}

type FormState = {
  tipo_bomba: TipoBomba
  nivel_ativo_bomba: NivelAtivo
  reforco_rele_ativo: boolean
  atraso_abrir_valvula_antes_bomba_s: number
  tempo_bomba_desligada_antes_fechar_valvula_s: number
  atraso_religar_bomba_apos_fechamento_s: number
  tempo_max_continuo_bomba_min: number
  tempo_max_manual_local_min: number
  tempo_max_manual_remoto_sem_internet_min: number
}

const DEFAULTS: FormState = {
  tipo_bomba: 'monofasica',
  nivel_ativo_bomba: 'high',
  reforco_rele_ativo: false,
  atraso_abrir_valvula_antes_bomba_s: 2,
  tempo_bomba_desligada_antes_fechar_valvula_s: 2,
  atraso_religar_bomba_apos_fechamento_s: 5,
  tempo_max_continuo_bomba_min: 120,
  tempo_max_manual_local_min: 30,
  tempo_max_manual_remoto_sem_internet_min: 10,
}

function fromConfig(c: IrrigationConfig | null | undefined): FormState {
  if (!c) return { ...DEFAULTS }
  return {
    tipo_bomba: c.tipo_bomba,
    nivel_ativo_bomba: c.nivel_ativo_bomba,
    reforco_rele_ativo: c.reforco_rele_ativo,
    atraso_abrir_valvula_antes_bomba_s: c.atraso_abrir_valvula_antes_bomba_s,
    tempo_bomba_desligada_antes_fechar_valvula_s:
      c.tempo_bomba_desligada_antes_fechar_valvula_s,
    atraso_religar_bomba_apos_fechamento_s:
      c.atraso_religar_bomba_apos_fechamento_s,
    tempo_max_continuo_bomba_min: c.tempo_max_continuo_bomba_min,
    tempo_max_manual_local_min: c.tempo_max_manual_local_min,
    tempo_max_manual_remoto_sem_internet_min:
      c.tempo_max_manual_remoto_sem_internet_min,
  }
}

function diff(
  a: FormState,
  b: FormState,
): Partial<Record<keyof FormState, unknown>> {
  const out: Partial<Record<keyof FormState, unknown>> = {}
  for (const k of Object.keys(a) as (keyof FormState)[]) {
    if (a[k] !== b[k]) out[k] = a[k]
  }
  return out
}

export function PumpTab({ deviceId, config, disabled }: Props) {
  const [form, setForm] = useState<FormState>(() => fromConfig(config))
  const [initial, setInitial] = useState<FormState>(() => fromConfig(config))
  const mutation = usePatchConfig(deviceId)

  useEffect(() => {
    const next = fromConfig(config)
    setForm(next)
    setInitial(next)
  }, [config])

  const dirtyPatch = diff(form, initial)
  const dirty = Object.keys(dirtyPatch).length > 0

  const onSave = async () => {
    if (!dirty) return
    try {
      await mutation.mutateAsync(dirtyPatch)
      setInitial(form)
    } catch {
      /* toast já tratado no hook */
    }
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }))

  const numField = (
    label: string,
    key: keyof FormState,
    min: number,
    max: number,
    hint?: string,
  ) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={form[key] as number}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) set(key, n as FormState[typeof key])
        }}
        disabled={disabled || mutation.isPending}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Droplets className="h-5 w-5 text-primary" />
            Configuração da bomba
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select
                value={form.tipo_bomba}
                onValueChange={(v) => set('tipo_bomba', v as TipoBomba)}
                disabled={disabled || mutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monofasica">Monofásica</SelectItem>
                  <SelectItem value="inverter">Inverter</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Define o comportamento de partida e parada da bomba.
              </p>
            </div>

            <div className="space-y-1">
              <Label>Nível ativo do relé</Label>
              <Select
                value={form.nivel_ativo_bomba}
                onValueChange={(v) =>
                  set('nivel_ativo_bomba', v as NivelAtivo)
                }
                disabled={disabled || mutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">Alto (HIGH liga)</SelectItem>
                  <SelectItem value="low">Baixo (LOW liga)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Inverte a polaridade do GPIO da bomba.
              </p>
            </div>

            <div className="space-y-1">
              <Label>Reforço de relé</Label>
              <Select
                value={form.reforco_rele_ativo ? 'on' : 'off'}
                onValueChange={(v) =>
                  set('reforco_rele_ativo', v === 'on')
                }
                disabled={disabled || mutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Inativo</SelectItem>
                  <SelectItem value="on">Ativo</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Pulso adicional pra garantir engate em relés desgastados.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {numField(
              'Atraso abrir válvula antes da bomba (s)',
              'atraso_abrir_valvula_antes_bomba_s',
              0,
              60,
              'Tempo entre abrir setor e ligar bomba.',
            )}
            {numField(
              'Tempo bomba desligada antes de fechar válvula (s)',
              'tempo_bomba_desligada_antes_fechar_valvula_s',
              0,
              60,
              'Drena a linha antes de fechar.',
            )}
            {numField(
              'Religar bomba após fechamento (s)',
              'atraso_religar_bomba_apos_fechamento_s',
              0,
              300,
              'Cooldown mínimo entre desligar e religar.',
            )}
            {numField(
              'Máx contínuo (min)',
              'tempo_max_continuo_bomba_min',
              1,
              720,
              'Bomba desliga sozinha após esse tempo.',
            )}
            {numField(
              'Máx manual local (min)',
              'tempo_max_manual_local_min',
              1,
              480,
              'Limite por sessão de botão físico.',
            )}
            {numField(
              'Máx manual remoto sem internet (min)',
              'tempo_max_manual_remoto_sem_internet_min',
              1,
              120,
              'Limite quando MQTT cair durante operação remota.',
            )}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={onSave}
              disabled={!dirty || disabled || mutation.isPending}
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Salvar
            </Button>
            {dirty && (
              <span className="text-xs text-muted-foreground">
                Alterações não salvas
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
