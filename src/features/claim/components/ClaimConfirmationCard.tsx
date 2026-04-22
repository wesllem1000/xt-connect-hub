import { useState } from 'react'
import { Check, Cpu, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { PreviewClaimResponse } from '../types'

type Props = {
  preview: PreviewClaimResponse
  onConfirm: (apelido: string | null) => void
  onCancel: () => void
  loading?: boolean
}

const MAX_LEN = 80

export function ClaimConfirmationCard({
  preview,
  onConfirm,
  onCancel,
  loading,
}: Props) {
  const [apelido, setApelido] = useState('')
  const modeloLabel = preview.modelo?.nome ?? 'Modelo desconhecido'
  const prefixoLabel =
    preview.modelo?.prefixo && preview.modelo?.major_version
      ? `${preview.modelo.prefixo}-${preview.modelo.major_version}`
      : null
  const trimmed = apelido.trim()
  const tooLong = trimmed.length > MAX_LEN

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (tooLong || loading) return
    onConfirm(trimmed.length > 0 ? trimmed : null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Confirma este dispositivo?</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
            <div className="rounded-md bg-primary/10 p-3 shrink-0">
              {preview.modelo?.icone ? (
                <img
                  src={preview.modelo.icone}
                  alt=""
                  className="h-8 w-8 object-contain"
                />
              ) : (
                <Cpu className="h-8 w-8 text-primary" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="font-mono text-base font-semibold truncate">
                {preview.serial}
              </p>
              <p className="text-sm text-muted-foreground truncate">
                {modeloLabel}
                {prefixoLabel && (
                  <span className="ml-2 text-xs font-mono">({prefixoLabel})</span>
                )}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="claim-apelido">Apelido (opcional)</Label>
            <Input
              id="claim-apelido"
              type="text"
              maxLength={MAX_LEN}
              inputMode="text"
              autoComplete="off"
              placeholder={preview.serial}
              value={apelido}
              onChange={(e) => setApelido(e.target.value)}
              disabled={loading}
              aria-invalid={tooLong || undefined}
            />
            {tooLong ? (
              <p className="text-xs text-destructive">
                Máximo de {MAX_LEN} caracteres.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Deixe em branco pra usar o serial.
              </p>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={loading}
              className="w-full sm:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={loading || tooLong}
              className="w-full sm:w-auto h-11"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Adicionar dispositivo
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

