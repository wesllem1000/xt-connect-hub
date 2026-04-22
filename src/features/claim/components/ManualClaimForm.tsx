import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import { SERIAL_REGEX, PAIRING_ALPHABET } from '../types'

type Props = {
  onSubmit: (serial: string, pairingCode: string) => Promise<void> | void
  isPending?: boolean
  errorMessage?: string | null
  initialSerial?: string
  initialPairing?: string
}

export function ManualClaimForm({
  onSubmit,
  isPending,
  errorMessage,
  initialSerial = '',
  initialPairing = '',
}: Props) {
  const [serial, setSerial] = useState(initialSerial.toUpperCase())
  const [pairing, setPairing] = useState(initialPairing.toUpperCase())

  const serialValid = SERIAL_REGEX.test(serial)
  const pairingValid = PAIRING_ALPHABET.test(pairing)
  const canSubmit = serialValid && pairingValid && !isPending

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    void onSubmit(serial, pairing)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="serial">Serial do dispositivo</Label>
        <div className="relative">
          <Input
            id="serial"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="IRR-V1-00042"
            value={serial}
            onChange={(e) => setSerial(e.target.value.toUpperCase())}
            className={cn(
              'font-mono text-base pr-9',
              serial && (serialValid ? 'border-emerald-500' : 'border-destructive'),
            )}
            aria-invalid={serial && !serialValid ? true : undefined}
          />
          {serial && serialValid && (
            <Check className="h-4 w-4 text-emerald-600 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          )}
        </div>
        {serial && !serialValid && (
          <p className="text-xs text-destructive">
            Formato esperado: 3 letras, versão (V1, V2.1…) e 5 dígitos.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Impresso na etiqueta do produto, acima do QR code.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="pairing">Código de pareamento</Label>
        <div className="relative">
          <Input
            id="pairing"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={6}
            placeholder="X7K4M2"
            value={pairing}
            onChange={(e) =>
              setPairing(e.target.value.toUpperCase().slice(0, 6))
            }
            className={cn(
              'font-mono text-xl tracking-widest pr-9',
              pairing && (pairingValid ? 'border-emerald-500' : 'border-destructive'),
            )}
            aria-invalid={pairing && !pairingValid ? true : undefined}
          />
          {pairing && pairingValid && (
            <Check className="h-4 w-4 text-emerald-600 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          )}
        </div>
        {pairing && !pairingValid && (
          <p className="text-xs text-destructive">
            6 caracteres do alfabeto (sem 0, O, 1, I, L).
          </p>
        )}
        <p className="text-xs text-muted-foreground">6 caracteres ao lado do QR code.</p>
      </div>

      {errorMessage && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {errorMessage}
        </div>
      )}

      <Button
        type="submit"
        className="w-full h-12 text-base"
        disabled={!canSubmit}
      >
        {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {isPending ? 'Conectando…' : 'Adicionar dispositivo'}
      </Button>
    </form>
  )
}
