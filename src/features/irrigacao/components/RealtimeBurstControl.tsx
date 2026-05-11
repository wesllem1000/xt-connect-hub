import { useEffect, useState } from 'react'
import { Activity, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'

import { setDispositivoRate } from '@/api/dispositivos'
import { extractApiError } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { useDeviceBurstState } from '../hooks/useDeviceBurstState'

const RATE_OPTIONS = [
  { v: 1, label: '1 segundo' },
  { v: 2, label: '2 segundos' },
  { v: 5, label: '5 segundos' },
  { v: 10, label: '10 segundos' },
]

const DURATION_OPTIONS = [
  { v: 60, label: '1 minuto' },
  { v: 300, label: '5 minutos' },
  { v: 600, label: '10 minutos' },
  { v: 1800, label: '30 minutos' },
]

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.round(seconds / 60)
  return `${m} min`
}

type Props = {
  deviceId: string
  serial: string | undefined
  canCommand: boolean
}

export function RealtimeBurstControl({ deviceId, serial, canCommand }: Props) {
  const burst = useDeviceBurstState(serial)
  const [open, setOpen] = useState(false)
  const [rate, setRate] = useState(2)
  const [duration, setDuration] = useState(600)
  const [tick, setTick] = useState(0)

  // Tick a cada 1s pra atualizar countdown UI.
  useEffect(() => {
    if (!burst.active) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [burst.active])

  const mutation = useMutation({
    mutationFn: (input: { rate_s: number; duration_s: number }) =>
      setDispositivoRate(deviceId, { mode: 'burst', ...input }),
    onSuccess: (_res, input) => {
      // Estado vai atualizar via retained MQTT; aqui só feedback imediato.
      toast.success(
        `Tempo real ativado: dado a cada ${input.rate_s}s por ${formatDuration(input.duration_s)}.`,
      )
      setOpen(false)
    },
    onError: async (err) => {
      const raw = await extractApiError(err, 'Falha ao ativar tempo real.')
      const msg = /sem permissao/i.test(raw)
        ? 'Sem permissão pra comandar este dispositivo.'
        : raw
      toast.error(msg)
    },
  })

  if (!canCommand) {
    if (burst.active) {
      // Viewer ainda vê que tá em tempo real (mas não pode controlar).
      const remainingMs = Math.max(0, new Date(burst.expiresAt).getTime() - Date.now())
      const min = Math.floor(remainingMs / 60000)
      const sec = Math.floor((remainingMs % 60000) / 1000)
      void tick
      return (
        <Badge className="bg-red-600 hover:bg-red-600 gap-1.5 shrink-0 text-[10px] sm:text-xs">
          <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
          Tempo real {min}:{String(sec).padStart(2, '0')}
        </Badge>
      )
    }
    return null
  }

  if (burst.active) {
    const remainingMs = Math.max(0, new Date(burst.expiresAt).getTime() - Date.now())
    const min = Math.floor(remainingMs / 60000)
    const sec = Math.floor((remainingMs % 60000) / 1000)
    void tick
    return (
      <Badge className="bg-red-600 hover:bg-red-600 gap-1.5 shrink-0 text-[10px] sm:text-xs">
        <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
        Tempo real {burst.rateS}s · {min}:{String(sec).padStart(2, '0')}
      </Badge>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 shrink-0 h-8">
          <Activity className="h-4 w-4" />
          <span className="hidden sm:inline">Tempo real</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ativar tempo real</DialogTitle>
          <DialogDescription>
            Dispositivo passa a enviar dados em intervalo curto por um período
            definido. Após expirar, volta automaticamente à taxa padrão.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="burst-rate">Frequência de envio</Label>
            <Select
              value={String(rate)}
              onValueChange={(v) => setRate(Number(v))}
            >
              <SelectTrigger id="burst-rate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RATE_OPTIONS.map((o) => (
                  <SelectItem key={o.v} value={String(o.v)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="burst-duration">Duração</Label>
            <Select
              value={String(duration)}
              onValueChange={(v) => setDuration(Number(v))}
            >
              <SelectTrigger id="burst-duration">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((o) => (
                  <SelectItem key={o.v} value={String(o.v)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => mutation.mutate({ rate_s: rate, duration_s: duration })}
            disabled={mutation.isPending}
          >
            {mutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Ativar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
