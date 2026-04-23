import { Link, useRouteError } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function ClaimErrorBoundary() {
  const error = useRouteError()

  if (import.meta.env.DEV) {
    console.error('ClaimErrorBoundary caught:', error)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-muted/30">
      <AlertCircle className="h-12 w-12 text-destructive" />
      <h1 className="text-xl font-semibold">Algo deu errado</h1>
      <p className="text-sm text-muted-foreground max-w-md">
        Não conseguimos carregar o fluxo de adicionar dispositivo. Tente voltar
        e tentar de novo.
      </p>
      <div className="flex gap-2">
        <Button asChild variant="outline">
          <Link to="/dispositivos">Voltar pra Dispositivos</Link>
        </Button>
        <Button onClick={() => window.location.reload()}>Recarregar</Button>
      </div>
    </div>
  )
}
