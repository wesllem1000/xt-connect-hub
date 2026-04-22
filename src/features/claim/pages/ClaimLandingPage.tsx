import { useState } from 'react'
import {
  Link,
  Navigate,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { HTTPError } from 'ky'

import { useAuthStore } from '@/stores/auth'
import { ClaimErrorState } from '../components/ClaimErrorState'
import { ClaimPreviewCard } from '../components/ClaimPreviewCard'
import { friendlyClaimError, useClaim, usePreviewClaim } from '../hooks'

function sanitizeQueryForNext(sp: URLSearchParams): string {
  const keep = new URLSearchParams()
  const token = sp.get('token')
  const serial = sp.get('serial')
  const pairing = sp.get('pairing_code') || sp.get('pairing')
  if (token) keep.set('token', token)
  if (serial) keep.set('serial', serial)
  if (pairing) keep.set('pairing_code', pairing)
  const qs = keep.toString()
  return '/claim' + (qs ? '?' + qs : '')
}

export function ClaimLandingPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const isAuthed = useAuthStore((s) =>
    Boolean(s.user && (s.accessToken || s.refreshToken)),
  )

  const token = params.get('token') || undefined
  const serial = params.get('serial') || undefined
  const pairing = params.get('pairing_code') || params.get('pairing') || undefined

  const hasAnyParam = Boolean(token || (serial && pairing))

  const preview = usePreviewClaim({
    token,
    serial,
    pairing_code: pairing,
    enabled: isAuthed && hasAnyParam,
  })
  const claim = useClaim()

  if (!isAuthed) {
    const next = sanitizeQueryForNext(params)
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }

  if (!hasAnyParam) {
    return (
      <ClaimErrorState
        title="Link incompleto"
        description="Esse link não tem código de pareamento. Peça um novo link ou use a tela de adicionar dispositivo."
      />
    )
  }

  async function handleConfirm() {
    setErrMsg(null)
    try {
      const res = await claim.mutateAsync(
        token
          ? { claim_token: token }
          : { serial: serial!, pairing_code: pairing! },
      )
      toast.success('Dispositivo adicionado.')
      navigate(`/dispositivos/${res.dispositivo.id}`, { replace: true })
    } catch (e) {
      setErrMsg(friendlyClaimError(e))
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-4">
      <div className="w-full max-w-md space-y-4">
        <div>
          <h1 className="text-xl font-bold">Reivindicar dispositivo</h1>
          <p className="text-sm text-muted-foreground">
            Confirme os dados antes de adicionar à sua conta.
          </p>
        </div>

        {preview.isPending && <Skeleton className="h-32 w-full" />}

        {preview.isError && (
          <ClaimErrorState
            title={previewErrTitle(preview.error)}
            description={previewErrDesc(preview.error)}
          />
        )}

        {preview.isSuccess && (
          <>
            <ClaimPreviewCard preview={preview.data} />

            {errMsg && (
              <div
                className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {errMsg}
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <Button variant="ghost" asChild className="sm:w-auto w-full">
                <Link to="/dispositivos">Cancelar</Link>
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={claim.isPending}
                className="sm:flex-1 w-full h-11"
              >
                {claim.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Confirmar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function previewErrTitle(err: unknown): string {
  if (err instanceof HTTPError) {
    if (err.response.status === 409) return 'Dispositivo já ativado'
    if (err.response.status === 404) return 'Código inválido'
  }
  return 'Não foi possível verificar'
}

function previewErrDesc(err: unknown): string {
  if (err instanceof HTTPError) {
    if (err.response.status === 409)
      return 'Este dispositivo já foi ativado. Se você é o dono, ele já está na sua lista.'
    if (err.response.status === 404)
      return 'Código inválido. Confira serial e pairing code na etiqueta ou peça um novo link.'
  }
  return 'Erro de conexão. Tente abrir o link de novo em alguns instantes.'
}
