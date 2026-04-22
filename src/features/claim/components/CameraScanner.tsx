import { useEffect, useRef, useState } from 'react'
import { CameraOff, Flashlight, FlashlightOff, Loader2, RefreshCcw } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

type Props = {
  /** Só inicializa a câmera quando true (lazy). */
  active: boolean
  onScan: (decodedText: string) => void
  onError?: (err: Error) => void
}

const READER_ID = 'xt-qr-reader'

export function CameraScanner({ active, onScan, onError }: Props) {
  const scannerRef = useRef<import('html5-qrcode').Html5Qrcode | null>(null)
  const [state, setState] = useState<'idle' | 'starting' | 'running' | 'error'>(
    'idle',
  )
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>(
    'environment',
  )
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const scannedRef = useRef(false)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    scannedRef.current = false

    async function boot() {
      setState('starting')
      setErrMsg(null)
      try {
        const mod = await import('html5-qrcode')
        if (cancelled) return
        const Html5Qrcode = mod.Html5Qrcode
        const scanner = new Html5Qrcode(READER_ID, { verbose: false })
        scannerRef.current = scanner

        await scanner.start(
          { facingMode },
          {
            fps: 10,
            qrbox: (viewW: number, viewH: number) => {
              const size = Math.min(viewW, viewH) * 0.8
              return { width: size, height: size }
            },
            aspectRatio: 1,
          },
          (decodedText) => {
            if (scannedRef.current) return
            scannedRef.current = true
            try {
              navigator.vibrate?.(100)
            } catch {
              /* ignore */
            }
            onScan(decodedText)
          },
          () => {
            // frames sem QR — ignorar
          },
        )
        if (cancelled) {
          await scanner.stop().catch(() => {})
          try { scanner.clear() } catch { /* ignore */ }
          return
        }

        // Torch capability
        try {
          const caps = scanner.getRunningTrackCapabilities() as unknown as {
            torch?: boolean
          }
          setTorchSupported(Boolean(caps?.torch))
        } catch {
          setTorchSupported(false)
        }

        setState('running')
      } catch (e) {
        if (cancelled) return
        const err = e instanceof Error ? e : new Error(String(e))
        setState('error')
        setErrMsg(friendly(err))
        onError?.(err)
      }
    }

    void boot()

    return () => {
      cancelled = true
      const s = scannerRef.current
      scannerRef.current = null
      if (s) {
        s.stop()
          .catch(() => {})
          .finally(() => {
            try { s.clear() } catch { /* ignore */ }
          })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, facingMode])

  async function toggleTorch() {
    const s = scannerRef.current
    if (!s || !torchSupported) return
    try {
      await s.applyVideoConstraints({
        advanced: [{ torch: !torchOn } as MediaTrackConstraintSet],
      } as MediaTrackConstraints)
      setTorchOn((v) => !v)
    } catch {
      /* ignore */
    }
  }

  function switchCamera() {
    setFacingMode((v) => (v === 'environment' ? 'user' : 'environment'))
  }

  return (
    <div className="space-y-3">
      <div
        className="relative w-full max-w-md mx-auto aspect-square rounded-lg overflow-hidden bg-slate-950"
        style={{
          boxShadow:
            'inset 0 0 0 3px rgba(255,255,255,0.1)',
        }}
      >
        <div id={READER_ID} className="absolute inset-0 [&_video]:object-cover [&_video]:w-full [&_video]:h-full" />

        {/* overlay corners */}
        {state === 'running' && (
          <div className="pointer-events-none absolute inset-[15%]">
            <Corner className="top-0 left-0" kind="tl" />
            <Corner className="top-0 right-0" kind="tr" />
            <Corner className="bottom-0 left-0" kind="bl" />
            <Corner className="bottom-0 right-0" kind="br" />
          </div>
        )}

        {state === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center text-white text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Iniciando câmera…
          </div>
        )}

        {state === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <Alert variant="destructive" className="bg-slate-900 text-white border-slate-700">
              <CameraOff className="h-4 w-4" />
              <AlertTitle>Câmera indisponível</AlertTitle>
              <AlertDescription>
                {errMsg ?? 'Permita acesso à câmera nas configurações do navegador.'}
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Aponte a câmera para o QR code na etiqueta do produto.
      </p>

      {state === 'running' && (
        <div className="flex justify-center gap-2">
          {torchSupported && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleTorch}
            >
              {torchOn ? (
                <FlashlightOff className="h-4 w-4 mr-2" />
              ) : (
                <Flashlight className="h-4 w-4 mr-2" />
              )}
              {torchOn ? 'Desligar lanterna' : 'Ligar lanterna'}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={switchCamera}>
            <RefreshCcw className="h-4 w-4 mr-2" />
            {facingMode === 'environment' ? 'Câmera frontal' : 'Câmera traseira'}
          </Button>
        </div>
      )}
    </div>
  )
}

function friendly(err: Error): string {
  const msg = (err.message || '').toLowerCase()
  if (msg.includes('permission')) return 'Permita acesso à câmera nas configurações do navegador.'
  if (msg.includes('notfound') || msg.includes('no camera'))
    return 'Nenhuma câmera detectada neste dispositivo.'
  return err.message || 'Não foi possível abrir a câmera.'
}

function Corner({
  className = '',
  kind,
}: {
  className?: string
  kind: 'tl' | 'tr' | 'bl' | 'br'
}) {
  const base = 'absolute h-5 w-5 border-white/90'
  const sides: Record<typeof kind, string> = {
    tl: 'border-t-2 border-l-2',
    tr: 'border-t-2 border-r-2',
    bl: 'border-b-2 border-l-2',
    br: 'border-b-2 border-r-2',
  }
  return <span aria-hidden className={`${base} ${sides[kind]} ${className}`} />
}
