import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { HTTPError } from 'ky'
import { toast } from 'sonner'

import { useAuthStore } from '@/stores/auth'
import { ClaimConfirmationCard } from '../components/ClaimConfirmationCard'
import { ClaimErrorState } from '../components/ClaimErrorState'
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
      <div className="min-h-screen flex items-center justify-center bg-muted p-4">
        <ClaimErrorState
          title="Link incompleto"
          description="Esse link não tem código de pareamento. Peça um novo link ou use a tela de adicionar dispositivo."
        />
      </div>
    )
  }

  async function handleConfirm(apelido: string | null) {
    try {
      const res = await claim.mutateAsync(
        token
          ? { claim_token: token, apelido }
          : { serial: serial!, pairing_code: pairing!, apelido },
      )
      const displayName =
        res.dispositivo.apelido ||
        res.dispositivo.serial ||
        'Dispositivo adicionado'
      toast.success(`${displayName} adicionado.`)
      navigate(`/dispositivos/${res.dispositivo.id}`, { replace: true })
    } catch (e) {
      toast.error(friendlyClaimError(e))
    }
  }

  function handleCancel() {
    navigate('/dispositivos', { replace: true })
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

        {preview.isPending && <Skeleton className="h-40 w-full" />}

        {preview.isError && (
          <ClaimErrorState
            title={previewErrTitle(preview.error)}
            description={previewErrDesc(preview.error)}
          />
        )}

        {preview.isSuccess && (
          <ClaimConfirmationCard
            preview={preview.data}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            loading={claim.isPending}
          />
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
