import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'

export function VerifyPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      navigate('/login?verified=invalid', { replace: true })
      return
    }
    window.location.href = '/api/auth/verify?token=' + encodeURIComponent(token)
  }, [navigate, params])

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-base text-muted-foreground">
            Confirmando seu e-mail…
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
