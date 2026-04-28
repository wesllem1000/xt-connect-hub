import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Clock,
  Cpu,
  Hand,
  Info,
  Loader2,
  RotateCcw,
  Save,
} from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

import { useFactoryReset } from '../hooks/useFactoryReset'
import { usePatchConfig } from '../hooks/usePatchConfig'
import type { IrrigationConfig, TipoBotaoFisico } from '../types'

type Props = {
  deviceId: string
  config: IrrigationConfig | null | undefined
  serial: string
  modelo: string
  timeValid?: boolean | null
  receivedAt?: string | null
}

type FormState = {
  botao_fisico_tipo: TipoBotaoFisico
  botao_debounce_ms: number
  botao_assume_manual: boolean
  gpio_1wire: number
}

const DEFAULTS: FormState = {
  botao_fisico_tipo: 'pulso_alterna',
  botao_debounce_ms: 50,
  botao_assume_manual: true,
  gpio_1wire: 4,
}

function fromConfig(c: IrrigationConfig | null | undefined): FormState {
  if (!c) return { ...DEFAULTS }
  return {
    botao_fisico_tipo: c.botao_fisico_tipo,
    botao_debounce_ms: c.botao_debounce_ms,
    botao_assume_manual: c.botao_assume_manual,
    gpio_1wire: c.gpio_1wire,
  }
}

function diff(a: FormState, b: FormState) {
  const out: Partial<Record<keyof FormState, unknown>> = {}
  for (const k of Object.keys(a) as (keyof FormState)[]) {
    if (a[k] !== b[k]) out[k] = a[k]
  }
  return out
}

const BUTTON_TIPO_LABELS: Record<TipoBotaoFisico, string> = {
  pulso_alterna: 'Pulso alterna (toggle)',
  pulso_liga: 'Pulso liga',
  pulso_desliga: 'Pulso desliga',
  retentivo: 'Retentivo (chave)',
}

export function SystemTab({
  deviceId,
  config,
  serial,
  modelo,
  timeValid,
  receivedAt,
}: Props) {
  const [form, setForm] = useState<FormState>(() => fromConfig(config))
  const [initial, setInitial] = useState<FormState>(() => fromConfig(config))
  const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0)

  const patch = usePatchConfig(deviceId)
  const reset = useFactoryReset(deviceId)

  useEffect(() => {
    const next = fromConfig(config)
    setForm(next)
    setInitial(next)
  }, [config])

  const dirtyPatch = diff(form, initial)
  const dirty = Object.keys(dirtyPatch).length > 0

  const onSave = async () => {
    if (!dirty) return
    try {
      await patch.mutateAsync(dirtyPatch)
      setInitial(form)
    } catch {
      /* tratado no hook */
    }
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }))

  return (
    <div className="space-y-4">
      {/* Botão físico */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Hand className="h-5 w-5" />
            Botão físico
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select
                value={form.botao_fisico_tipo}
                onValueChange={(v) =>
                  set('botao_fisico_tipo', v as TipoBotaoFisico)
                }
                disabled={patch.isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(BUTTON_TIPO_LABELS) as TipoBotaoFisico[]
                  ).map((t) => (
                    <SelectItem key={t} value={t}>
                      {BUTTON_TIPO_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Debounce (ms)</Label>
              <Input
                type="number"
                min={10}
                max={2000}
                value={form.botao_debounce_ms}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n)) set('botao_debounce_ms', n)
                }}
                disabled={patch.isPending}
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label>Botão assume modo manual?</Label>
              <Select
                value={form.botao_assume_manual ? 'on' : 'off'}
                onValueChange={(v) => set('botao_assume_manual', v === 'on')}
                disabled={patch.isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on">Sim — toca botão = vai pra manual</SelectItem>
                  <SelectItem value="off">Não — manter modo atual</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Se ativo, pressionar o botão físico durante automação
                interrompe e volta pra modo manual.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Hardware (GPIO) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            Hardware
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert className="border-amber-300 bg-amber-50 text-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-900">
              Mexer no GPIO requer reflash/reboot do firmware. Só altere
              se você instalou o hardware.
            </AlertDescription>
          </Alert>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>GPIO do barramento 1-Wire (DS18B20)</Label>
              <Input
                type="number"
                min={0}
                max={48}
                value={form.gpio_1wire}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n)) set('gpio_1wire', n)
                }}
                disabled={patch.isPending}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save bar */}
      <div className="flex items-center gap-3">
        <Button onClick={onSave} disabled={!dirty || patch.isPending}>
          {patch.isPending ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-1" />
          )}
          Salvar
        </Button>
        {dirty && (
          <span className="text-xs text-muted-foreground">
            Alterações não salvas
          </span>
        )}
      </div>

      {/* Sobre */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-5 w-5" />
            Sobre
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Serial
              </dt>
              <dd className="font-mono">{serial}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Modelo
              </dt>
              <dd>{modelo}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Protocolo
              </dt>
              <dd>v{config?.protocol_version ?? '?'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Hora do dispositivo
              </dt>
              <dd
                className={cn(
                  timeValid ? 'text-emerald-600' : 'text-amber-600',
                )}
              >
                {timeValid ? 'Sincronizada (NTP)' : 'Não sincronizada'}
              </dd>
            </div>
            {receivedAt && (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Último state recebido
                </dt>
                <dd className="text-xs font-mono text-muted-foreground">
                  {receivedAt}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Reset de fábrica */}
      <Card className="border-destructive/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-destructive">
            <RotateCcw className="h-5 w-5" />
            Reset de fábrica
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Apaga todas as configurações, setores customizados, timers e
            sensores deste dispositivo, reaplica defaults e envia comando
            pro firmware limpar a NVS. <strong>Não pode ser desfeito.</strong>
          </p>
          <Button
            variant="destructive"
            onClick={() => setConfirmStep(1)}
            disabled={reset.isPending}
          >
            {reset.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-1" />
            )}
            Reset de fábrica
          </Button>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmStep > 0}
        onOpenChange={(o) => {
          if (!o && !reset.isPending) setConfirmStep(0)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmStep === 1
                ? 'Resetar este dispositivo?'
                : 'Confirmação final'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {confirmStep === 1 ? (
                  <>
                    <p>
                      Vou apagar todos os timers, setores customizados,
                      sensores de temperatura e configs deste dispositivo
                      ({serial}), e reaplicar os defaults do modelo.
                    </p>
                    <Alert className="border-amber-300 bg-amber-50 text-amber-900">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <AlertDescription>
                        Histórico de eventos é <strong>preservado</strong>.
                      </AlertDescription>
                    </Alert>
                  </>
                ) : (
                  <p>
                    Última confirmação. Essa ação é imediata e o firmware
                    receberá o comando assim que estiver online.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reset.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={reset.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (confirmStep === 1) {
                  setConfirmStep(2)
                } else {
                  reset.mutate(undefined, {
                    onSettled: () => setConfirmStep(0),
                  })
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {reset.isPending && (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              )}
              {confirmStep === 1 ? 'Continuar' : 'Resetar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}
