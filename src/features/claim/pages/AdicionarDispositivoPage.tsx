import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Keyboard, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

import { CameraScanner } from '../components/CameraScanner'
import { ManualClaimForm } from '../components/ManualClaimForm'
import { friendlyClaimError, useClaim } from '../hooks'

function isLikelyMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|webOS|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile/i.test(
    navigator.userAgent,
  )
}

function hasSecureCamera(): boolean {
  return Boolean(
    typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      window.isSecureContext,
  )
}

function extractTokenOrPairing(qr: string): {
  token?: string
  serial?: string
  pairing_code?: string
} | null {
  const trimmed = qr.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    const token = url.searchParams.get('token')
    const serial = url.searchParams.get('serial')
    const pairing = url.searchParams.get('pairing_code') || url.searchParams.get('pairing')
    if (token) return { token, serial: serial ?? undefined }
    if (serial && pairing) return { serial, pairing_code: pairing }
    return null
  } catch {
    // Não é URL: assumir que o QR é só o token cru
    if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return { token: trimmed }
    return null
  }
}

export function AdicionarDispositivoPage() {
  const navigate = useNavigate()
  const claim = useClaim()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mobile = useMemo(isLikelyMobile, [])
  const cameraOk = useMemo(hasSecureCamera, [])
  const defaultTab = mobile && cameraOk ? 'scan' : 'manual'
  const [tab, setTab] = useState<'scan' | 'manual'>(defaultTab)

  // Lock body scroll when scanner active
  useEffect(() => {
    if (tab !== 'scan') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [tab])

  async function runClaim(params: {
    token?: string
    serial?: string
    pairing_code?: string
  }) {
    setErrorMessage(null)
    try {
      const result = await claim.mutateAsync(
        params.token
          ? { claim_token: params.token }
          : { serial: params.serial!, pairing_code: params.pairing_code! },
      )
      toast.success('Dispositivo adicionado.')
      navigate(`/dispositivos/${result.dispositivo.id}`, { replace: true })
    } catch (e) {
      const msg = friendlyClaimError(e)
      setErrorMessage(msg)
      toast.error(msg)
      throw e
    }
  }

  function handleScan(decodedText: string) {
    const parsed = extractTokenOrPairing(decodedText)
    if (!parsed) {
      toast.error('QR code não reconhecido. Use a aba Digitar.')
      return
    }
    toast.success('Código detectado, conectando…')
    runClaim(parsed).catch(() => {
      /* erro já mostrado no toast */
    })
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/dispositivos')}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Voltar
      </Button>

      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">Adicionar dispositivo</h2>
        <p className="text-sm text-muted-foreground">
          Escaneie o QR code da etiqueta ou digite o serial e pairing code.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'scan' | 'manual')}>
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="scan" className="h-11" disabled={claim.isPending}>
            <Camera className="h-4 w-4 mr-2" />
            Escanear
          </TabsTrigger>
          <TabsTrigger value="manual" className="h-11" disabled={claim.isPending}>
            <Keyboard className="h-4 w-4 mr-2" />
            Digitar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scan" className="space-y-3 pt-4">
          {!cameraOk && (
            <div className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground text-center">
              Câmera indisponível neste dispositivo ou navegador. Use a aba{' '}
              <strong>Digitar</strong>.
            </div>
          )}
          {cameraOk && (
            <>
              {!mobile && (
                <div className="rounded-md border bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Scan por câmera funciona melhor no celular. Se preferir, use a aba Digitar.
                </div>
              )}
              <CameraScanner
                active={tab === 'scan'}
                onScan={handleScan}
                onError={() => {
                  toast.error('Câmera indisponível — use a aba Digitar.')
                  setTab('manual')
                }}
              />
              {claim.isPending && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Conectando…
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="manual" className="pt-4">
          <ManualClaimForm
            isPending={claim.isPending}
            errorMessage={errorMessage}
            onSubmit={(serial, pairing) =>
              runClaim({ serial, pairing_code: pairing })
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
