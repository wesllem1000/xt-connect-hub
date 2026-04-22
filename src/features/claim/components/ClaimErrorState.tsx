import { Link } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export function ClaimErrorState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="max-w-md mx-auto space-y-4">
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
      <Button variant="outline" asChild className="w-full">
        <Link to="/dispositivos">Voltar pra meus dispositivos</Link>
      </Button>
    </div>
  )
}
