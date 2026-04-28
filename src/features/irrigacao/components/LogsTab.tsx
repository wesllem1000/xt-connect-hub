import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, FileText, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

import { getEvents } from '../api'
import type { IrrigationEvent } from '../types'

type Props = {
  deviceId: string
}

const LIMIT = 100

function formatLine(ev: IrrigationEvent): string {
  const ts = ev.ts ?? ''
  const alvo = ev.alvo_id ? `${ev.alvo_tipo}=${ev.alvo_id}` : ev.alvo_tipo ?? '-'
  const origem = ev.origem ?? '-'
  const dur = ev.duracao_s != null ? ` dur=${ev.duracao_s}s` : ''
  const result = ev.resultado ? ` result=${ev.resultado}` : ''
  const payload =
    ev.payload_json && Object.keys(ev.payload_json).length > 0
      ? ` :: ${JSON.stringify(ev.payload_json)}`
      : ''
  return `[${ts}] ${ev.event_type} alvo=${alvo} origem=${origem}${dur}${result}${payload}`
}

export function LogsTab({ deviceId }: Props) {
  const query = useQuery({
    queryKey: ['irrigacao', 'events-log', deviceId],
    queryFn: () => getEvents(deviceId, { limit: LIMIT }),
    refetchInterval: 30_000,
  })

  const [copying, setCopying] = useState(false)
  const events = query.data?.eventos ?? []
  const lines = events.map(formatLine)
  const total = query.data?.paginacao.total ?? 0

  const handleRefresh = () => query.refetch()

  const handleCopy = async () => {
    if (lines.length === 0) return
    setCopying(true)
    try {
      const header = `Logs · ${deviceId} · ${new Date().toLocaleString('pt-BR')}`
      const text = `${header}\n${'='.repeat(50)}\n${lines.join('\n')}`
      await navigator.clipboard.writeText(text)
      toast.success('Logs copiados')
    } catch {
      toast.error('Não foi possível copiar')
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Logs do dispositivo
        </h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={query.isFetching}
          >
            {query.isFetching ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Atualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={lines.length === 0 || copying}
          >
            <Copy className="h-4 w-4 mr-1" />
            Copiar
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="h-[420px] overflow-y-auto">
            {query.isPending ? (
              <div className="p-8 text-center text-muted-foreground">
                <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
                <p className="text-sm">Carregando logs…</p>
              </div>
            ) : query.isError ? (
              <div className="p-8 text-center text-destructive">
                <p className="text-sm">Falha ao carregar eventos.</p>
              </div>
            ) : lines.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Nenhum evento registrado.</p>
                <p className="text-sm mt-1">
                  Os logs aparecem conforme o dispositivo opera.
                </p>
              </div>
            ) : (
              <pre className="p-4 text-xs font-mono whitespace-pre-wrap text-foreground">
                {lines.join('\n')}
              </pre>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Mostrando últimos {lines.length} de {total} evento(s) ·{' '}
        {deviceId}
      </p>
    </div>
  )
}
