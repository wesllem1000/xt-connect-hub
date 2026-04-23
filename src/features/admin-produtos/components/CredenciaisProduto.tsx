import { QRCodeSVG } from 'qrcode.react'
import { AlertTriangle } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { CopyField } from './CopyField'
import type { MqttInfo } from '../types'

type Props = {
  serial: string
  modeloNome?: string | null
  pairingCode: string
  claimUrl: string
  mqtt?: MqttInfo | null
  /** True quando a senha MQTT ainda está exposta (tela de provisionamento). */
  showMqttPassword?: boolean
}

export function CredenciaisProduto({
  serial,
  modeloNome,
  pairingCode,
  claimUrl,
  mqtt,
  showMqttPassword,
}: Props) {
  return (
    <div className="space-y-5">
      {showMqttPassword && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-900">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-900">
            <strong>Guarde estas informações agora.</strong> A senha MQTT não
            será mostrada novamente. Se perder, só via <em>Reset</em> (que
            regenera tudo e exige reflash do firmware).
          </AlertDescription>
        </Alert>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Identificação</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyField label="Serial" value={serial} valueClassName="font-mono text-base font-semibold" />
          {modeloNome && (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Modelo
              </p>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                {modeloNome}
              </div>
            </div>
          )}
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Claim pelo cliente</h3>
        <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
          <div className="flex justify-center rounded-md border bg-white p-3">
            <QRCodeSVG
              value={claimUrl}
              size={150}
              level="M"
              includeMargin={false}
              aria-label={`QR code do claim de ${serial}`}
            />
          </div>
          <div className="space-y-3">
            <CopyField
              label="Pairing code"
              value={pairingCode}
              valueClassName="font-mono text-xl font-bold tracking-widest"
            />
            <CopyField label="Link de claim" value={claimUrl} valueClassName="font-mono text-xs" />
          </div>
        </div>
      </section>

      {mqtt && (
        <>
          <Separator />
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Credenciais MQTT (firmware)</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <CopyField label="Host MQTTS" value={mqtt.host} valueClassName="font-mono text-xs" />
              <CopyField label="Host WSS" value={mqtt.ws} valueClassName="font-mono text-xs" />
              <CopyField label="Username" value={mqtt.username} valueClassName="font-mono text-xs" />
              {showMqttPassword ? (
                <CopyField
                  label="Password (única vez)"
                  value={mqtt.password}
                  valueClassName="font-mono text-xs"
                />
              ) : (
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Password
                  </p>
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground italic">
                    já consumida — use "Reset" pra regenerar
                  </div>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
