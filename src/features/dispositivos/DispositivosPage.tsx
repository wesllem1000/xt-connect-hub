import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Cpu, Plus } from 'lucide-react'

import { listDispositivos, type Dispositivo } from '@/api/dispositivos'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { extractApiError } from '@/lib/api'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function formatPt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return dateFormatter.format(d)
}

function DispositivoCard({ dispositivo }: { dispositivo: Dispositivo }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base leading-tight">{dispositivo.nome}</CardTitle>
          {dispositivo.modelo ? (
            <Badge variant="secondary">{dispositivo.modelo}</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">sem modelo</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Serial</p>
          <p className="font-mono text-xs">{dispositivo.serial}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Último dado</p>
          <p>{formatPt(dispositivo.ultimo_valor)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Cadastrado</p>
          <p>{formatPt(dispositivo.criado_em)}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function LoadingState() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-3/4" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <Card className="max-w-md mx-auto text-center">
      <CardHeader>
        <div className="mx-auto rounded-full bg-primary/10 p-3 w-fit">
          <Cpu className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="mt-3">Nenhum dispositivo cadastrado</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Cadastre um dispositivo para começar a receber telemetria.
        </p>
        <Button disabled>
          <Plus className="h-4 w-4 mr-2" />
          Adicionar dispositivo
        </Button>
      </CardContent>
    </Card>
  )
}

function ErrorMessage({ error }: { error: unknown }) {
  const [message, setMessage] = useState('Falha ao buscar dispositivos.')
  useEffect(() => {
    let cancelled = false
    extractApiError(error, 'Falha ao buscar dispositivos.').then((m) => {
      if (!cancelled) setMessage(m)
    })
    return () => {
      cancelled = true
    }
  }, [error])
  return <>{message}</>
}

export function DispositivosPage() {
  const query = useQuery({
    queryKey: ['dispositivos'],
    queryFn: listDispositivos,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dispositivos</h2>
          <p className="text-muted-foreground text-sm">
            Seus dispositivos conectados ao hub.
          </p>
        </div>
        <Button disabled>
          <Plus className="h-4 w-4 mr-2" />
          Adicionar
        </Button>
      </div>

      {query.isPending && <LoadingState />}

      {query.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>
            <ErrorMessage error={query.error} />
          </AlertDescription>
        </Alert>
      )}

      {query.isSuccess && query.data.length === 0 && <EmptyState />}

      {query.isSuccess && query.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {query.data.map((d) => (
            <DispositivoCard key={d.id} dispositivo={d} />
          ))}
        </div>
      )}
    </div>
  )
}
