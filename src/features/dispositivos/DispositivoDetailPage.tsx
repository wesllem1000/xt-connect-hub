import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Cpu,
  Eye,
  Lock,
  Pencil,
  Radio,
  Clock,
  Check,
  Loader2,
  UserPlus,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
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

import {
  listDispositivos,
  setDispositivoRate,
  updateDispositivoApelido,
  type Dispositivo,
} from '@/api/dispositivos'
import { listReadings, type Reading } from '@/api/readings'
import { useDeviceLiveData } from '@/hooks/useDeviceLiveData'
import { useDeviceStatus } from '@/hooks/useDeviceStatus'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { extractApiError } from '@/lib/api'
import { ShareDialog } from './ShareDialog'

const BURST_DURATION_S = 120
const BURST_HEARTBEAT_MS = 60_000

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

  const burstRateS = dispositivo?.burst_rate_s ?? 2
  const defaultRateS = dispositivo?.telemetry_interval_s ?? 30

  const canCommand =
    dispositivo?.access_type === 'owner' || dispositivo?.permissao === 'controle'
  const isShared = dispositivo?.access_type === 'shared'
  const isViewer = isShared && dispositivo?.permissao === 'leitura'
  const isOwner = dispositivo?.access_type === 'owner'

  const [burstActive, setBurstActive] = useState(false)
  const [burstExpiresAt, setBurstExpiresAt] = useState<number | null>(null)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)

  useEffect(() => {
    if (!id || !dispositivo || !canCommand) return
    let cancelled = false

    const trigger = async () => {
      if (cancelled) return
      try {
        await setDispositivoRate(id, {
          mode: 'burst',
          rate_s: burstRateS,
          duration_s: BURST_DURATION_S,
        })
        if (cancelled) return
        setBurstActive(true)
        setBurstExpiresAt(Date.now() + BURST_DURATION_S * 1000)
      } catch (err) {
        if (!cancelled) console.warn('burst request failed', err)
      }
    }

    trigger()
    const iv = setInterval(trigger, BURST_HEARTBEAT_MS)

    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [id, dispositivo, burstRateS, canCommand])

  useEffect(() => {
    if (!burstExpiresAt) return
    const remaining = burstExpiresAt - Date.now()
    if (remaining <= 0) {
      setBurstActive(false)
      return
    }
    const t = setTimeout(() => setBurstActive(false), remaining)
    return () => clearTimeout(t)
  }, [burstExpiresAt])

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
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="space-y-2 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 px-2"
            onClick={() => navigate('/dispositivos')}
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <div className="flex items-center gap-3 flex-wrap">
            <Cpu className="h-6 w-6 text-primary" />
            <DeviceTitle
              id={id!}
              apelido={dispositivo!.apelido}
              serial={dispositivo!.serial}
              canEdit={isOwner}
            />
            <Badge variant={isOnline ? 'default' : 'outline'} className={isOnline ? 'bg-green-600 hover:bg-green-600' : 'text-muted-foreground'}>
              <Radio className="h-3 w-3 mr-1" />
              {isOnline ? 'Online' : 'Offline'}
            </Badge>
            {isShared && (
              <Badge
                className={
                  dispositivo!.permissao === 'controle'
                    ? 'bg-emerald-600 hover:bg-emerald-600'
                    : 'bg-blue-600 hover:bg-blue-600'
                }
              >
                <Eye className="h-3 w-3 mr-1" />
                {dispositivo!.permissao === 'controle'
                  ? 'Compartilhado · Comandar'
                  : 'Compartilhado · Visualizar'}
              </Badge>
            )}
            {isOnline && burstActive && canCommand ? (
              <Badge className="bg-red-600 hover:bg-red-600">
                <span className="mr-1 h-2 w-2 rounded-full bg-white animate-pulse" />
                ao vivo ({burstRateS}s)
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                <Clock className="h-3 w-3 mr-1" />
                cada {formatRate(defaultRateS)}
              </Badge>
            )}
          </div>
          {dispositivo!.apelido && (
            <p className="font-mono text-xs text-muted-foreground">serial: {dispositivo!.serial}</p>
          )}
        </div>
        <div className="flex items-center justify-between sm:flex-col sm:items-end sm:justify-normal gap-2 sm:gap-2">
          {isOwner && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShareDialogOpen(true)}
            >
              <UserPlus className="h-4 w-4 mr-1.5" />
              Compartilhar
            </Button>
          )}
          <div className="text-right text-sm">
            <div className="flex items-center gap-1 justify-end text-muted-foreground">
              <Clock className="h-3 w-3" /> Último dado
            </div>
            <div className="font-medium">{formatRelative(lastTs)}</div>
          </div>
        </div>
      </div>

      {isViewer && (
        <Alert className="border-blue-200 bg-blue-50 text-blue-900">
          <Lock className="h-4 w-4" />
          <AlertTitle>Modo visualização</AlertTitle>
          <AlertDescription>
            Apenas o dono pode ajustar a taxa de envio. Você vê os dados em tempo real,
            mas não pode comandar este dispositivo.
          </AlertDescription>
        </Alert>
      )}

      {canCommand && (
        <RateConfigCard deviceId={id!} currentRate={defaultRateS} />
      )}

      {isOwner && (
        <ShareDialog
          dispositivoId={id!}
          dispositivoNome={dispositivo!.nome}
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
        />
      )}

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
        <CardContent className="h-60 sm:h-72">
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

function RateConfigCard({
  deviceId,
  currentRate,
}: {
  deviceId: string
  currentRate: number
}) {
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
      toast.success(`Taxa default: cada ${formatRate(rate_s)}.`)
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
  const isValid =
    Number.isInteger(parsed) && parsed >= 1 && parsed <= 3600
  const isDirty = isValid && parsed !== currentRate

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || !isDirty) return
    mutation.mutate(parsed)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Taxa de envio</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="space-y-1">
            <label
              htmlFor="rate-input"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Segundos entre envios (1–3600)
            </label>
            <Input
              id="rate-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={3600}
              step={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-32"
            />
          </div>
          <div className="text-sm text-muted-foreground pb-2">
            {isValid
              ? `equivale a cada ${formatRate(parsed)}`
              : 'valor inválido'}
          </div>
          <Button
            type="submit"
            disabled={!isDirty || !isValid || mutation.isPending}
          >
            {mutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Salvar
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          Valor persistente. Ao abrir esta página o dispositivo entra em modo
          burst (~{formatRate(2)}) pra mostrar o gráfico ao vivo; ao fechar,
          volta a essa taxa.
        </p>
      </CardContent>
    </Card>
  )
}

const APELIDO_MAX = 80

function DeviceTitle({
  id,
  apelido,
  serial,
  canEdit,
}: {
  id: string
  apelido: string | null
  serial: string
  canEdit: boolean
}) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(apelido ?? '')

  useEffect(() => {
    setValue(apelido ?? '')
  }, [apelido])

  const mutation = useMutation({
    mutationFn: (next: string | null) => updateDispositivoApelido(id, next),
    onSuccess: () => {
      toast.success('Apelido atualizado.')
      qc.invalidateQueries({ queryKey: ['dispositivos'] })
      setEditing(false)
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao renomear.')
      toast.error(msg)
    },
  })

  const trimmed = value.trim()
  const tooLong = trimmed.length > APELIDO_MAX

  function handleSave() {
    if (tooLong) return
    const next = trimmed.length > 0 ? trimmed : null
    if ((next ?? null) === (apelido ?? null)) {
      setEditing(false)
      return
    }
    mutation.mutate(next)
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <h2 className="text-2xl font-bold tracking-tight truncate max-w-[min(100%,20rem)]">
          {apelido || serial}
        </h2>
        {canEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => {
              setValue(apelido ?? '')
              setEditing(true)
            }}
            aria-label="Editar apelido"
            title="Editar apelido"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            handleSave()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setEditing(false)
            setValue(apelido ?? '')
          }
        }}
        maxLength={APELIDO_MAX}
        placeholder={serial}
        className="h-9 w-full max-w-xs"
        aria-invalid={tooLong || undefined}
        disabled={mutation.isPending}
      />
      <div className="flex gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9"
          onClick={() => {
            setEditing(false)
            setValue(apelido ?? '')
          }}
          disabled={mutation.isPending}
          aria-label="Cancelar"
        >
          <X className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          className="h-9 w-9"
          onClick={handleSave}
          disabled={mutation.isPending || tooLong}
          aria-label="Salvar apelido"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
