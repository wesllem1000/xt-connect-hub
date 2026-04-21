import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Cpu, Radio, Clock } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts'

import { listDispositivos, type Dispositivo } from '@/api/dispositivos'
import { listReadings, type Reading } from '@/api/readings'
import { useDeviceLiveData } from '@/hooks/useDeviceLiveData'
import { useDeviceStatus } from '@/hooks/useDeviceStatus'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { extractApiError } from '@/lib/api'

const MAX_BUFFER_POINTS = 200

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
})

const timeOnlyFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function formatRelative(iso: string | number | null): string {
  if (iso === null) return '—'
  const d = typeof iso === 'number' ? new Date(iso) : new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 5) return 'agora'
  if (diff < 60) return `há ${Math.max(0, Math.floor(diff))}s`
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`
  return dateTimeFormatter.format(d)
}

function tsAsMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts
}

type ChartPoint = {
  t: number
  label: string
  [k: string]: number | string
}

function readingsToPoints(readings: Reading[]): ChartPoint[] {
  return readings
    .map((r) => {
      const t = new Date(r.ts).getTime()
      return { t, label: timeOnlyFormatter.format(new Date(t)), ...r.payload }
    })
    .sort((a, b) => a.t - b.t)
}

export function DispositivoDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const dispositivosQuery = useQuery({
    queryKey: ['dispositivos'],
    queryFn: listDispositivos,
    staleTime: 30_000,
  })

  const dispositivo: Dispositivo | undefined = useMemo(
    () => dispositivosQuery.data?.find((d) => d.id === id),
    [dispositivosQuery.data, id],
  )

  const serial = dispositivo?.serial

  const readingsQuery = useQuery({
    queryKey: ['readings', id],
    queryFn: () => listReadings(id!, { limit: 100 }),
    enabled: Boolean(id),
    staleTime: 5_000,
  })

  const live = useDeviceLiveData(serial)
  const status = useDeviceStatus(serial, {
    online: dispositivo?.online ?? false,
    lastSeenAt: dispositivo?.last_seen_at ?? null,
  })

  const [buffer, setBuffer] = useState<ChartPoint[]>([])

  useEffect(() => {
    if (readingsQuery.data) setBuffer(readingsToPoints(readingsQuery.data))
  }, [readingsQuery.data])

  useEffect(() => {
    if (!live) return
    const t = tsAsMs(live.ts)
    setBuffer((prev) => {
      if (prev.some((p) => p.t === t)) return prev
      const next = [...prev, { t, label: timeOnlyFormatter.format(new Date(t)), ...live.readings }]
      next.sort((a, b) => a.t - b.t)
      if (next.length > MAX_BUFFER_POINTS) next.splice(0, next.length - MAX_BUFFER_POINTS)
      return next
    })
  }, [live])

  const lastPoint = buffer.length > 0 ? buffer[buffer.length - 1] : null
  const lastReadingMap: Record<string, number> | null = lastPoint
    ? (Object.fromEntries(
        Object.entries(lastPoint).filter(
          ([k, v]) => k !== 't' && k !== 'label' && typeof v === 'number',
        ),
      ) as Record<string, number>)
    : null
  const lastTs = lastPoint?.t ?? null

  const isOnline = status.online
  const seriesKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const p of buffer) {
      for (const k of Object.keys(p)) {
        if (k !== 't' && k !== 'label' && typeof p[k] === 'number') keys.add(k)
      }
    }
    return Array.from(keys)
  }, [buffer])

  const palette = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2']

  // Loading state
  if (dispositivosQuery.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  // Not found / error after load
  if (dispositivosQuery.isSuccess && !dispositivo) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/dispositivos')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Dispositivo não encontrado</AlertTitle>
          <AlertDescription>O dispositivo solicitado não existe ou você não tem acesso.</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (dispositivosQuery.isError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/dispositivos')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Falha ao carregar dispositivo</AlertTitle>
          <AlertDescription>
            <ErrorMessage error={dispositivosQuery.error} />
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 px-2"
            onClick={() => navigate('/dispositivos')}
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <div className="flex items-center gap-3">
            <Cpu className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-bold tracking-tight">{dispositivo!.nome}</h2>
            <Badge variant={isOnline ? 'default' : 'outline'} className={isOnline ? 'bg-green-600 hover:bg-green-600' : 'text-muted-foreground'}>
              <Radio className="h-3 w-3 mr-1" />
              {isOnline ? 'Online' : 'Offline'}
            </Badge>
          </div>
          <p className="font-mono text-xs text-muted-foreground">serial: {dispositivo!.serial}</p>
        </div>
        <div className="text-right text-sm">
          <div className="flex items-center gap-1 justify-end text-muted-foreground">
            <Clock className="h-3 w-3" /> Último dado
          </div>
          <div className="font-medium">{formatRelative(lastTs)}</div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Última leitura</CardTitle>
        </CardHeader>
        <CardContent>
          {!lastReadingMap || Object.keys(lastReadingMap).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma leitura recebida ainda.</p>
          ) : (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
              {Object.entries(lastReadingMap).map(([k, v]) => (
                <div key={k} className="rounded-md border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{k}</p>
                  <p className="text-xl font-semibold tabular-nums">{Number(v).toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico em tempo real</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {readingsQuery.isPending ? (
            <Skeleton className="h-full w-full" />
          ) : buffer.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sem dados nas últimas 24h. Aguardando publicação do dispositivo…
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={buffer} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={32} />
                <YAxis tick={{ fontSize: 11 }} width={40} />
                <Tooltip
                  formatter={(v) => (typeof v === 'number' ? v.toFixed(2) : String(v ?? ''))}
                  labelFormatter={(l) => `Hora: ${l}`}
                />
                <Legend />
                {seriesKeys.map((k, i) => (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={k}
                    stroke={palette[i % palette.length]}
                    dot={false}
                    isAnimationActive={false}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ErrorMessage({ error }: { error: unknown }) {
  const [message, setMessage] = useState('Falha ao carregar.')
  useEffect(() => {
    let cancelled = false
    extractApiError(error, 'Falha ao carregar.').then((m) => { if (!cancelled) setMessage(m) })
    return () => { cancelled = true }
  }, [error])
  return <>{message}</>
}
