import { useEffect, useState } from 'react'
import { RotateCcw, Save, Loader2, Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { usePatchConfig } from '../hooks/usePatchConfig'
import { useComando } from '../hooks/useComando'
import type { IrrigationConfig } from '../types'

type PumpDirection = 'fwd' | 'rev'

type InverterForm = {
  pump_power_pct: number
  pump_p0_10_hz: number
  pump_direction: PumpDirection
  pump_accel_s: number
  pump_decel_s: number
}

const DEFAULTS: InverterForm = {
  pump_power_pct: 33,
  pump_p0_10_hz: 60,
  pump_direction: 'fwd',
  pump_accel_s: 5,
  pump_decel_s: 5,
}

function num(v: unknown, fallback: number): number {
  if (v === null || v === undefined) return fallback
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function fromConfig(c: IrrigationConfig | null | undefined): InverterForm {
  if (!c) return { ...DEFAULTS }
  return {
    pump_power_pct: num(c.pump_power_pct, DEFAULTS.pump_power_pct),
    pump_p0_10_hz: num(c.pump_p0_10_hz, DEFAULTS.pump_p0_10_hz),
    pump_direction: ((typeof c.pump_direction === 'string' ? c.pump_direction.toLowerCase() : null) as PumpDirection | null) ?? DEFAULTS.pump_direction,
    pump_accel_s: num(c.pump_accel_s, DEFAULTS.pump_accel_s),
    pump_decel_s: num(c.pump_decel_s, DEFAULTS.pump_decel_s),
  }
}

function diffForms(
  next: InverterForm,
  initial: InverterForm,
): Partial<Record<keyof InverterForm, unknown>> {
  const out: Partial<Record<keyof InverterForm, unknown>> = {}
  for (const k of Object.keys(next) as (keyof InverterForm)[]) {
    if (next[k] !== initial[k]) out[k] = next[k]
  }
  return out
}

function RangeSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  hint,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  hint?: string
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium flex items-center gap-1">
          {label}
          {hint && (
            <span title={hint} className="cursor-help text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
            </span>
          )}
        </Label>
        <span className="font-mono text-sm tabular-nums">
          {step < 1 ? value.toFixed(1) : value}
          <span className="text-muted-foreground text-xs ml-0.5">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-emerald-600 h-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={label}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  )
}

type Props = {
  deviceId: string
  config: IrrigationConfig | null | undefined
}

export function InverterConfigCard({ deviceId, config }: Props) {
  const initial = fromConfig(config)
  const [form, setForm] = useState<InverterForm>(initial)

  // Reseta quando config muda (apos invalidate + refetch)
  useEffect(() => {
    setForm(fromConfig(config))
  }, [config])

  const patch = usePatchConfig(deviceId)
  const cmd = useComando(deviceId)
  const changed = Object.keys(diffForms(form, initial)).length > 0
  const busy = patch.isPending || cmd.isPending

  function handleSave() {
    const delta = diffForms(form, initial)
    if (Object.keys(delta).length === 0) return
    patch.mutate(delta, {
      onSuccess: () => {
        // Se a potência mudou, dispara cmd pump_set_power pra aplicar AO VIVO no VFD
        // (PATCH /config persiste na NVS mas não muda setpoint atual quando bomba ON).
        if ('pump_power_pct' in delta) {
          cmd.mutate({ cmd: 'pump_set_power', params: { pct: form.pump_power_pct } })
        }
      },
    })
  }

  function handleRevert() {
    setForm(initial)
  }

  function set<K extends keyof InverterForm>(key: K, value: InverterForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Configuracao do inversor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Potencia padrao */}
        <RangeSlider
          label="Potência padrão da bomba"
          value={form.pump_power_pct}
          min={5}
          max={100}
          step={1}
          unit="%"
          hint="Potência aplicada por padrão. Sobrescrita por: (1) timer com 'Potência durante o timer' configurada (5–100%); (2) setor aberto com Override de potência (5–99%). Setor em 100% = sem override = usa este valor."
          disabled={busy}
          onChange={(v) => set('pump_power_pct', v)}
        />

        {/* Frequencia maxima */}
        <div className="space-y-1.5">
          <Label
            htmlFor="pump_p0_10_hz"
            className="text-sm font-medium flex items-center gap-1"
          >
            Frequencia maxima (P0_10)
            <span
              title="Frequencia maxima do motor (parametro P0.10 do VFD). Geralmente 60 Hz no Brasil."
              className="cursor-help text-muted-foreground"
            >
              <Info className="h-3.5 w-3.5" />
            </span>
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="pump_p0_10_hz"
              type="number"
              min={30}
              max={120}
              step={1}
              value={form.pump_p0_10_hz}
              disabled={busy}
              className="w-28 font-mono"
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!Number.isNaN(v) && v >= 30 && v <= 120) set('pump_p0_10_hz', v)
              }}
            />
            <span className="text-sm text-muted-foreground">Hz</span>
          </div>
        </div>

        {/* Sentido de rotacao */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium flex items-center gap-1">
            Sentido de rotacao
            <span
              title="Sentido de rotacao do motor. FWD = sentido horario padrao; REV = anti-horario."
              className="cursor-help text-muted-foreground"
            >
              <Info className="h-3.5 w-3.5" />
            </span>
          </Label>
          <div className="flex gap-2">
            {(['fwd', 'rev'] as PumpDirection[]).map((dir) => (
              <Button
                key={dir}
                type="button"
                variant={form.pump_direction === dir ? 'default' : 'outline'}
                size="sm"
                disabled={busy}
                className="w-20"
                onClick={() => set('pump_direction', dir)}
              >
                {dir.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>

        {/* Rampa subida */}
        <RangeSlider
          label="Rampa de subida"
          value={form.pump_accel_s}
          min={0.1}
          max={30}
          step={0.1}
          unit="s"
          hint="Tempo para acelerar do zero ate a frequencia maxima."
          disabled={busy}
          onChange={(v) => set('pump_accel_s', v)}
        />

        {/* Rampa descida */}
        <RangeSlider
          label="Rampa de descida"
          value={form.pump_decel_s}
          min={0.1}
          max={30}
          step={0.1}
          unit="s"
          hint="Tempo para desacelerar da frequencia maxima ate zero."
          disabled={busy}
          onChange={(v) => set('pump_decel_s', v)}
        />

        {/* Acoes */}
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <Button
            onClick={handleSave}
            disabled={!changed || busy}
            className="flex-1 gap-2"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {busy ? 'Salvando...' : 'Salvar e aplicar'}
          </Button>
          <Button
            variant="outline"
            onClick={handleRevert}
            disabled={!changed || busy}
            className="flex-1 gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Reverter
          </Button>
        </div>

        <p className="text-xs text-muted-foreground border-l-2 border-amber-400 pl-2">
          As alteracoes sao aplicadas pelo firmware em ate 30s (versao de config + push MQTT).
        </p>
      </CardContent>
    </Card>
  )
}
