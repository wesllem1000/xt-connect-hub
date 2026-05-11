import { useEffect, useRef, useState } from 'react'
import { Loader2, Zap } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'

import { usePatchConfig } from '../hooks/usePatchConfig'
import { useComando } from '../hooks/useComando'

type Props = {
  deviceId: string
  /** Valor atual de pump_power_pct vindo do snapshot (NUMERIC pode ser string). */
  currentPct: number | string | null | undefined
  /** Só renderiza se device é inverter — caller controla. */
  isInverter: boolean
  online: boolean
}

function num(v: unknown, fallback: number): number {
  if (v === null || v === undefined) return fallback
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Slider rápido pra ajustar pump_power_pct direto do Painel (modo manual).
 * Debounce 400ms client-side antes de disparar PATCH /config + cmd pump_set_power.
 *
 * Pattern alinhado com aba Inversor (B3): persiste no DB E aplica ao vivo no VFD.
 */
export function PumpPowerQuickSlider({ deviceId, currentPct, isInverter, online }: Props) {
  const initial = num(currentPct, 33)
  const [pct, setPct] = useState(initial)
  const patch = usePatchConfig(deviceId)
  const cmd = useComando(deviceId)
  const debounceRef = useRef<number | null>(null)
  const lastCommittedRef = useRef(initial)

  // Re-sincroniza quando o snapshot atualiza (ex.: alguém mexeu na aba Inversor).
  useEffect(() => {
    const next = num(currentPct, 33)
    if (next !== pct && next !== lastCommittedRef.current) {
      setPct(next)
      lastCommittedRef.current = next
    }
    // Sem `pct` no deps — evitar reset durante drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPct])

  if (!isInverter) return null

  const busy = patch.isPending || cmd.isPending

  function commit(value: number) {
    if (value === lastCommittedRef.current) return
    lastCommittedRef.current = value
    patch.mutate({ pump_power_pct: value }, {
      onSuccess: () => {
        if (online) cmd.mutate({ cmd: 'pump_set_power', params: { pct: value } })
      },
    })
  }

  function handleChange(value: number) {
    setPct(value)
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => commit(value), 400)
  }

  return (
    <Card className="border-emerald-500/30">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Zap className="h-3.5 w-3.5 text-emerald-600" />
            Potência manual
            {busy && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
          </Label>
          <span className="font-mono text-sm tabular-nums font-bold">
            {pct}<span className="text-muted-foreground text-xs ml-0.5">%</span>
          </span>
        </div>
        <input
          type="range"
          min={5}
          max={100}
          step={1}
          value={pct}
          disabled={!online}
          onChange={(e) => handleChange(Number(e.target.value))}
          className="w-full accent-emerald-600 h-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Potência manual da bomba"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>5%</span>
          <span>aplica ao vivo se bomba ligada · debounce 400ms</span>
          <span>100%</span>
        </div>
      </CardContent>
    </Card>
  )
}
