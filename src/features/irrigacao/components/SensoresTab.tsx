import { useEffect, useMemo, useState } from 'react'
import {
  Loader2,
  PlugZap,
  Save,
  Thermometer,
  Trash2,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'

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
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import {
  useCreateSensor,
  useDeleteSensor,
  usePatchSensor,
} from '../hooks/useSensors'
import type { IrrigationTemperatureSensor, SensorRole } from '../types'
import { TemperatureGauge } from './TemperatureGauge'

type Props = {
  deviceId: string
  sensores: IrrigationTemperatureSensor[]
  /** ROM IDs detectados pelo firmware no barramento agora (auto-descoberta).
   *  Os que não estão em `sensores[].rom_id` viram a seção "Sensores detectados". */
  busRomIds?: string[]
  activeAlarmRomIds?: Set<string>
}

const ROLE_LABEL: Record<SensorRole, string> = {
  pump: 'Bomba (motor)',
  inverter: 'Inversor',
  custom: 'Custom',
}

type FormState = {
  nome: string
  role: SensorRole
  nome_custom: string
  rom_id: string
  limite_alarme_c: string
  histerese_c: string
  ack_usuario_requerido: boolean
  ativo: boolean
}

const EMPTY_FORM: FormState = {
  nome: '',
  role: 'pump',
  nome_custom: '',
  rom_id: '',
  limite_alarme_c: '70',
  histerese_c: '5',
  ack_usuario_requerido: true,
  ativo: true,
}

function fromSensor(s: IrrigationTemperatureSensor): FormState {
  return {
    nome: s.nome,
    role: s.role,
    nome_custom: s.nome_custom ?? '',
    rom_id: s.rom_id,
    limite_alarme_c: String(Number(s.limite_alarme_c)),
    histerese_c: String(Number(s.histerese_c)),
    ack_usuario_requerido: s.ack_usuario_requerido,
    ativo: s.ativo,
  }
}

function fmtPt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SensoresTab({
  deviceId,
  sensores,
  busRomIds,
  activeAlarmRomIds,
}: Props) {
  const [editing, setEditing] = useState<IrrigationTemperatureSensor | null>(
    null,
  )
  /** Quando preenchido, abre o form de criação com o rom_id pré-preenchido (e
   *  bloqueado). É o único caminho de criar sensor agora — não há mais campo
   *  livre de ROM no form. */
  const [provisioningRomId, setProvisioningRomId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<
    IrrigationTemperatureSensor | null
  >(null)

  const createMut = useCreateSensor(deviceId)
  const patchMut = usePatchSensor(deviceId)
  const deleteMut = useDeleteSensor(deviceId)

  const ordered = [...sensores].sort((a, b) =>
    a.criado_em.localeCompare(b.criado_em),
  )

  /** ROM IDs detectados pelo firmware que ainda não foram configurados. */
  const detectedRomIds = useMemo(() => {
    const configured = new Set(sensores.map((s) => s.rom_id.toUpperCase()))
    return (busRomIds ?? [])
      .map((r) => r.toUpperCase())
      .filter((r) => !configured.has(r))
  }, [busRomIds, sensores])

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Sensores DS18B20 1-Wire são detectados automaticamente quando você
        conecta no barramento. Aparecem em <strong>Sensores detectados</strong>{' '}
        — basta clicar em "Configurar" pra dar nome e função. Limite: 4 por
        dispositivo.
      </p>

      {/* Seção 1: Sensores detectados (não configurados ainda) */}
      {detectedRomIds.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <PlugZap className="h-4 w-4 text-amber-600" />
            <h3 className="text-sm font-medium">
              Sensores detectados ({detectedRomIds.length})
            </h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {detectedRomIds.map((rom) => (
              <Card
                key={rom}
                className="border-amber-500/40 bg-amber-50/30 dark:bg-amber-950/10"
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Thermometer className="h-5 w-5 text-amber-600" />
                    <p className="font-medium text-sm">Sensor sem nome</p>
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground break-all">
                    ROM: {rom}
                  </p>
                  <Button
                    size="sm"
                    onClick={() => setProvisioningRomId(rom)}
                    disabled={
                      createMut.isPending || sensores.length >= 4
                    }
                    className="w-full"
                  >
                    Configurar este sensor
                  </Button>
                  {sensores.length >= 4 && (
                    <p className="text-[10px] text-red-600">
                      Limite de 4 sensores atingido. Remova um pra configurar
                      este.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Seção 2: Sensores configurados */}
      {ordered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Thermometer className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Nenhum sensor cadastrado.</p>
            <p className="text-sm mt-1">
              Conecte um DS18B20 no barramento 1-Wire e ele vai aparecer em{' '}
              <strong>Sensores detectados</strong> em até 30s.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {ordered.map((s) => {
            const alarme = activeAlarmRomIds?.has(s.rom_id) ?? false
            const desconectado = s.presente === false
            return (
              <Card
                key={s.id}
                className={
                  alarme
                    ? 'border-red-500/60'
                    : desconectado
                      ? 'border-red-500/40 bg-red-50/30 dark:bg-red-950/10'
                      : undefined
                }
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <Thermometer
                        className={
                          alarme
                            ? 'h-5 w-5 text-red-600'
                            : desconectado
                              ? 'h-5 w-5 text-red-500 opacity-70'
                              : s.ativo
                                ? 'h-5 w-5 text-emerald-600'
                                : 'h-5 w-5 opacity-50'
                        }
                      />
                      <span className="truncate">{s.nome}</span>
                    </span>
                    {alarme && (
                      <span className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">
                        ALARME
                      </span>
                    )}
                    {!alarme && desconectado && (
                      <span className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white inline-flex items-center gap-1">
                        <WifiOff className="h-3 w-3" />
                        DESCONECTADO
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-center py-1">
                    <TemperatureGauge
                      valueC={
                        s.ultima_leitura_c != null
                          ? Number(s.ultima_leitura_c)
                          : null
                      }
                      limiteC={Number(s.limite_alarme_c)}
                      histereseC={Number(s.histerese_c)}
                      alarme={alarme}
                      size={220}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t">
                    <Info label="Função" value={ROLE_LABEL[s.role]} />
                    <Info
                      label="Status"
                      value={
                        alarme
                          ? 'Alarme ativo'
                          : s.ativo
                            ? 'Monitorando'
                            : 'Inativo'
                      }
                    />
                    <Info
                      label="Histerese"
                      value={`${Number(s.histerese_c).toFixed(1)}°C`}
                    />
                    <Info
                      label="Último contato"
                      value={fmtPt(s.ultimo_contato_em)}
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono break-all">
                    ROM: {s.rom_id}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(s)}
                      disabled={patchMut.isPending}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmDelete(s)}
                      disabled={deleteMut.isPending}
                      className="text-red-700 hover:text-red-800"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <SensorFormDialog
        open={provisioningRomId !== null || editing !== null}
        sensor={editing}
        provisioningRomId={provisioningRomId}
        pending={createMut.isPending || patchMut.isPending}
        onClose={() => {
          setEditing(null)
          setProvisioningRomId(null)
        }}
        onSubmit={async (data, isCreate) => {
          if (!isCreate && editing) {
            await patchMut.mutateAsync({ id: editing.id, patch: data })
            toast.success(`Sensor "${data.nome ?? editing.nome}" atualizado`)
          } else {
            await createMut.mutateAsync({
              nome: data.nome!,
              role: data.role!,
              nome_custom: data.nome_custom ?? null,
              rom_id: provisioningRomId,
              limite_alarme_c: data.limite_alarme_c!,
              histerese_c: data.histerese_c,
              ack_usuario_requerido: data.ack_usuario_requerido,
              ativo: data.ativo,
            })
          }
          setEditing(null)
          setProvisioningRomId(null)
        }}
      />

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover sensor?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmDelete?.nome}" vai ser removido do banco e do firmware
              (via <code>config/push</code>). Eventos de alarme já registrados
              são preservados no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={async () => {
                if (!confirmDelete) return
                try {
                  await deleteMut.mutateAsync(confirmDelete.id)
                } catch {
                  /* tratado no hook */
                }
                setConfirmDelete(null)
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="uppercase tracking-wide text-muted-foreground text-[10px]">
        {label}
      </p>
      <p className="font-medium">{value}</p>
    </div>
  )
}

type FormSubmitData = Partial<{
  nome: string
  role: SensorRole
  nome_custom: string | null
  rom_id: string | null
  limite_alarme_c: number
  histerese_c: number
  ack_usuario_requerido: boolean
  ativo: boolean
}>

function SensorFormDialog({
  open,
  sensor,
  provisioningRomId,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean
  sensor: IrrigationTemperatureSensor | null
  provisioningRomId: string | null
  pending: boolean
  onClose: () => void
  onSubmit: (data: FormSubmitData, isCreate: boolean) => Promise<void>
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  // Re-sincroniza o form quando o dialog abre ou o sensor sendo editado muda.
  useEffect(() => {
    if (!open) return
    if (sensor) {
      setForm(fromSensor(sensor))
    } else {
      setForm({ ...EMPTY_FORM, rom_id: provisioningRomId ?? '' })
    }
  }, [open, sensor, provisioningRomId])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }))

  async function handleSave() {
    if (!form.nome.trim()) {
      toast.error('Nome obrigatório')
      return
    }
    const limite = Number(form.limite_alarme_c)
    if (!Number.isFinite(limite)) {
      toast.error('Limite (°C) inválido')
      return
    }
    const histerese = Number(form.histerese_c)
    if (!Number.isFinite(histerese) || histerese < 0 || histerese > 50) {
      toast.error('Histerese deve estar entre 0 e 50')
      return
    }
    const data: FormSubmitData = {
      nome: form.nome.trim(),
      role: form.role,
      nome_custom: form.role === 'custom' ? form.nome_custom.trim() || null : null,
      limite_alarme_c: limite,
      histerese_c: histerese,
      ack_usuario_requerido: form.ack_usuario_requerido,
      ativo: form.ativo,
    }
    if (!sensor) {
      // Em create, rom_id sempre vem do provisioningRomId (sensor detectado pelo
      // firmware). Não há mais campo livre — o pai do dialog garante isso.
      data.rom_id = provisioningRomId
    }
    try {
      await onSubmit(data, !sensor)
    } catch {
      /* tratado no hook */
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {sensor ? 'Editar sensor' : 'Configurar sensor detectado'}
          </DialogTitle>
          <DialogDescription>
            {sensor
              ? 'Mudanças são empurradas ao firmware via config/push.'
              : 'Dê um nome e configure a função do sensor. O firmware vai começar a publicar a temperatura assim que salvar.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input
              value={form.nome}
              maxLength={96}
              onChange={(e) => set('nome', e.target.value)}
              disabled={pending}
              placeholder="Ex.: Bomba motor"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Função</Label>
              <Select
                value={form.role}
                onValueChange={(v) => set('role', v as SensorRole)}
                disabled={pending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pump">Bomba (motor)</SelectItem>
                  <SelectItem value="inverter">Inversor</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.role === 'custom' && (
              <div className="space-y-1">
                <Label>Nome custom</Label>
                <Input
                  value={form.nome_custom}
                  onChange={(e) => set('nome_custom', e.target.value)}
                  disabled={pending}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Limite alarme (°C)</Label>
              <Input
                type="number"
                step="0.1"
                value={form.limite_alarme_c}
                onChange={(e) => set('limite_alarme_c', e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1">
              <Label>Histerese (°C)</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="50"
                value={form.histerese_c}
                onChange={(e) => set('histerese_c', e.target.value)}
                disabled={pending}
              />
            </div>
          </div>

          {!sensor && provisioningRomId && (
            <div className="space-y-1">
              <Label>ROM ID (detectado pelo firmware)</Label>
              <Input
                value={provisioningRomId}
                readOnly
                disabled
                className="font-mono text-xs bg-muted"
              />
              <p className="text-[10px] text-muted-foreground">
                Identificador único do DS18B20 lido do barramento 1-Wire — não
                editável.
              </p>
            </div>
          )}

          <div className="space-y-1">
            <Label>ACK do usuário</Label>
            <Select
              value={form.ack_usuario_requerido ? 'on' : 'off'}
              onValueChange={(v) => set('ack_usuario_requerido', v === 'on')}
              disabled={pending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="on">
                  Exige ACK do usuário (R-temp-2)
                </SelectItem>
                <SelectItem value="off">
                  Auto-desarma quando temperatura baixa
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Ativo</Label>
            <Select
              value={form.ativo ? 'on' : 'off'}
              onValueChange={(v) => set('ativo', v === 'on')}
              disabled={pending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="on">Sim — monitora alarme</SelectItem>
                <SelectItem value="off">
                  Não — leitura sem ação de alarme
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
