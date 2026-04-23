import { Cpu } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { PreviewClaimResponse } from '../types'

export function ClaimPreviewCard({ preview }: { preview: PreviewClaimResponse }) {
  const modeloLabel = preview.modelo?.nome ?? 'Modelo desconhecido'
  const prefixoLabel =
    preview.modelo?.prefixo && preview.modelo?.major_version
      ? `${preview.modelo.prefixo}-${preview.modelo.major_version}`
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reivindicar dispositivo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
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
          <div className="min-w-0 flex-1">
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
      </CardContent>
    </Card>
  )
}
