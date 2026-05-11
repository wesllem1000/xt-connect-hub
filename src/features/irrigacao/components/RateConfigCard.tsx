import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { setDispositivoRate } from '@/api/dispositivos'
import { extractApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function formatRate(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) {
    const m = seconds / 60
    return Number.isInteger(m) ? `${m}min` : `${m.toFixed(1)}min`
  }
  const h = seconds / 3600
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`
}

type Props = {
  deviceId: string
  currentRate: number
  canCommand: boolean
}

export function RateConfigCard({ deviceId, currentRate, canCommand }: Props) {
  const qc = useQueryClient()
  const [value, setValue] = useState(String(currentRate))
  const lastSynced = useRef(currentRate)

  useEffect(() => {
    if (currentRate !== lastSynced.current) {
      lastSynced.current = currentRate
      setValue(String(currentRate))
    }
  }, [currentRate])

  const mutation = useMutation({
    mutationFn: (rate_s: number) =>
      setDispositivoRate(deviceId, { mode: 'default', rate_s }),
    onSuccess: (_res, rate_s) => {
      lastSynced.current = rate_s
      toast.success(`Taxa padrão: cada ${formatRate(rate_s)}.`)
      qc.invalidateQueries({ queryKey: ['dispositivos'] })
    },
    onError: async (err) => {
      const raw = await extractApiError(err, 'Falha ao atualizar taxa.')
      const msg = /sem permissao/i.test(raw)
        ? 'Sem permissão pra comandar este dispositivo.'
        : raw
      toast.error(msg)
    },
  })

  const parsed = Number(value)
  const isValid = Number.isInteger(parsed) && parsed >= 5 && parsed <= 3600
  const isDirty = isValid && parsed !== currentRate

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || !isDirty) return
    mutation.mutate(parsed)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Taxa de envio
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="rate-input" className="text-xs uppercase tracking-wide text-muted-foreground">
              Segundos entre envios (5–3600)
            </Label>
            <Input
              id="rate-input"
              type="number"
              inputMode="numeric"
              min={5}
              max={3600}
              step={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-32"
              disabled={!canCommand}
            />
          </div>
          <div className="text-sm text-muted-foreground pb-2">
            {isValid ? `equivale a cada ${formatRate(parsed)}` : 'valor inválido'}
          </div>
          <Button
            type="submit"
            disabled={!canCommand || !isDirty || !isValid || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          {canCommand ? (
            <>
              Esse é o intervalo que o dispositivo usa em modo normal. Pra ver
              dados ao vivo por alguns minutos, use o botão{' '}
              <strong>Tempo real</strong> no topo da página.
            </>
          ) : (
            <>Apenas o dono ou um operador com permissão de controle podem alterar a taxa.</>
          )}
        </p>
      </CardContent>
    </Card>
  )
}
