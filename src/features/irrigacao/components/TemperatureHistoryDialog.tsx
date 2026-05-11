import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Loader2, ThermometerSun } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import { getTemperatureHistory } from '../api/temperatureHistory'

type Range = '1h' | '6h' | '24h' | '7d' | '30d' | 'day'

type Props = {
  deviceId: string
  romId: string | null
  sensorName?: string
  limiteAlarmeC?: number
  open: boolean
  onClose: () => void
}

const RANGE_PRESETS: Array<{ key: Range; label: string }> = [
  { key: '1h', label: 'Última 1h' },
  { key: '6h', label: 'Últimas 6h' },
  { key: '24h', label: 'Últimas 24h' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'day', label: 'Dia específico' },
]

function rangeToParams(range: Range, day: string): { from: string; to?: string; every: string } {
  const now = Date.now()
  if (range === '1h')  return { from: new Date(now - 1*3600*1000).toISOString(), every: '30s' }
  if (range === '6h')  return { from: new Date(now - 6*3600*1000).toISOString(), every: '2m' }
  if (range === '24h') return { from: new Date(now - 24*3600*1000).toISOString(), every: '5m' }
  if (range === '7d')  return { from: new Date(now - 7*24*3600*1000).toISOString(), every: '30m' }
  if (range === '30d') return { from: new Date(now - 30*24*3600*1000).toISOString(), every: '2h' }
  // day specific
  const d = new Date(day + 'T00:00:00')
  if (Number.isNaN(d.getTime())) {
    return { from: new Date(now - 24*3600*1000).toISOString(), every: '5m' }
  }
  const start = new Date(d)
  start.setHours(0, 0, 0, 0)
  const end = new Date(d)
  end.setHours(23, 59, 59, 999)
  return { from: start.toISOString(), to: end.toISOString(), every: '5m' }
}

function formatTickShort(iso: string, range: Range): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  if (range === '1h' || range === '6h') {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  if (range === '24h' || range === 'day') {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  // 7d / 30d
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function formatTooltip(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function todayIsoDate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function TemperatureHistoryDialog({
  deviceId,
  romId,
  sensorName,
  limiteAlarmeC,
  open,
  onClose,
}: Props) {
  const [range, setRange] = useState<Range>('1h')
  const [day, setDay] = useState<string>(todayIsoDate())

  const params = useMemo(() => rangeToParams(range, day), [range, day])

  const query = useQuery({
    queryKey: ['temp-history', deviceId, romId, params.from, params.to, params.every],
    queryFn: () => getTemperatureHistory(deviceId, romId!, params),
    enabled: Boolean(open && romId),
    staleTime: 30_000,
    refetchInterval: range === '1h' ? 15_000 : false,
  })

  const data = useMemo(() => {
    return (query.data?.points ?? []).map((p) => ({
      ts: p.ts,
      tsMs: new Date(p.ts).getTime(),
      tempC: p.value,
      tickLabel: formatTickShort(p.ts, range),
    }))
  }, [query.data, range])

  const stats = useMemo(() => {
    if (data.length === 0) return null
    let min = data[0].tempC, max = data[0].tempC, sum = 0
    for (const p of data) {
      if (p.tempC < min) min = p.tempC
      if (p.tempC > max) max = p.tempC
      sum += p.tempC
    }
    return {
      min: min.toFixed(1),
      max: max.toFixed(1),
      avg: (sum / data.length).toFixed(1),
      count: data.length,
    }
  }, [data])

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ThermometerSun className="h-5 w-5" />
            Histórico — {sensorName || query.data?.sensor.nome || 'Sensor'}
          </DialogTitle>
          <DialogDescription>
            Variação de temperatura ao longo do tempo. Selecione o período abaixo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {RANGE_PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={range === p.key ? 'default' : 'outline'}
              onClick={() => setRange(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>

        {range === 'day' && (
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="day-input" className="text-xs">Data</Label>
              <Input
                id="day-input"
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="w-44"
                max={todayIsoDate()}
              />
            </div>
          </div>
        )}

        <div className={cn('h-72 rounded-md border', query.isPending && 'flex items-center justify-center')}>
          {query.isPending ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : query.isError ? (
            <div className="flex items-center justify-center h-full text-sm text-destructive">
              Falha ao carregar histórico.
            </div>
          ) : data.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Sem leituras no período selecionado.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 10, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="tickLabel" tick={{ fontSize: 11 }} />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 11 }}
                  unit="°C"
                  width={56}
                />
                <Tooltip
                  formatter={(v) => [`${Number(v).toFixed(2)}°C`, 'Temperatura']}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as { ts: string } | undefined
                    return p ? formatTooltip(p.ts) : ''
                  }}
                />
                {limiteAlarmeC != null && (
                  <ReferenceLine
                    y={limiteAlarmeC}
                    stroke="#dc2626"
                    strokeDasharray="4 4"
                    label={{ value: `limite ${limiteAlarmeC}°C`, position: 'right', fill: '#dc2626', fontSize: 10 }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="tempC"
                  stroke="#16a34a"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {stats && (
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Mínimo</div>
              <div className="font-semibold">{stats.min}°C</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Médio</div>
              <div className="font-semibold">{stats.avg}°C</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Máximo</div>
              <div className="font-semibold">{stats.max}°C</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Pontos</div>
              <div className="font-semibold">{stats.count}</div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
