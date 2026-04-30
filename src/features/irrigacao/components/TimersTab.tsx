import { useEffect, useMemo, useState } from 'react'
import { HTTPError } from 'ky'
import {
  AlertTriangle,
  Calendar,
  Clock,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'

import type { PostTimerInput } from '../api'
import {
  useCreateTimer,
  useDeleteTimer,
  useTimers,
  useUpdateTimer,
} from '../hooks/useTimers'
import type {
  IrrigationSector,
  IrrigationTimer,
  TimerAlvoTipo,
  TimerTipo,
} from '../types'

// dias_semana é bitmask: bit d = dia d, 0=domingo..6=sábado
const DAYS = [
  { bit: 0, label: 'Dom' },
  { bit: 1, label: 'Seg' },
  { bit: 2, label: 'Ter' },
  { bit: 3, label: 'Qua' },
  { bit: 4, label: 'Qui' },
  { bit: 5, label: 'Sex' },
  { bit: 6, label: 'Sáb' },
]

const PRESET_DIAS: Record<string, number> = {
  todos: 0b1111111,
  uteis: 0b0111110,
  fimdesemana: 0b1000001,
}

function maskToList(mask: number): number[] {
  const out: number[] = []
  for (let d = 0; d < 7; d++) if (mask & (1 << d)) out.push(d)
  return out
}

function shortHm(t: string | null): string {
  if (!t) return ''
  // backend retorna "HH:MM:SS" às vezes
  return t.length >= 5 ? t.slice(0, 5) : t
}

function summaryLabel(t: IrrigationTimer): string {
  const dur = t.duracao_s ? `${t.duracao_s}s` : `${t.duracao_min ?? '?'} min`
  const on = t.on_seconds ? `${t.on_seconds}s` : `${t.on_minutes}m`
  const off = t.off_seconds ? `${t.off_seconds}s` : `${t.off_minutes}m`
  if (t.tipo === 'fixed') {
    return `${shortHm(t.hora_inicio)} por ${dur}`
  }
  if (t.tipo === 'cyclic_window') {
    return `${shortHm(t.hora_inicio)}–${shortHm(t.hora_fim)} · ${on} on / ${off} off`
  }
  return `24h · ${on} on / ${off} off`
}

const TIPO_LABEL: Record<TimerTipo, string> = {
  fixed: 'Fixo',
  cyclic_window: 'Cíclico (janela)',
  cyclic_continuous: 'Cíclico (24h)',
}

type Unidade = 'min' | 's'

type FormState = {
  alvo_tipo: TimerAlvoTipo
  alvo_id: string | null
  tipo: TimerTipo
  nome: string
  hora_inicio: string
  hora_fim: string
  // Valores brutos digitados; a unidade decide se vão como *_min ou *_seconds.
  duracao: number
  on: number
  off: number
  unidade: Unidade
  dias_mask: number
  observacao: string
}

function defaultForm(): FormState {
  return {
    alvo_tipo: 'pump',
    alvo_id: null,
    tipo: 'fixed',
    nome: '',
    hora_inicio: '06:00',
    hora_fim: '08:00',
    duracao: 30,
    on: 5,
    off: 10,
    unidade: 'min',
    dias_mask: PRESET_DIAS.uteis,
    observacao: '',
  }
}

function fromTimer(t: IrrigationTimer): FormState {
  // Se o timer existente foi salvo em segundos, mostra em segundos. Caso contrário,
  // minutos.
  const usingSeconds =
    (t.duracao_s ?? 0) > 0 ||
    (t.on_seconds ?? 0) > 0 ||
    (t.off_seconds ?? 0) > 0
  return {
    alvo_tipo: t.alvo_tipo,
    alvo_id: t.alvo_id,
    tipo: t.tipo,
    nome: t.nome,
    hora_inicio: shortHm(t.hora_inicio) || '06:00',
    hora_fim: shortHm(t.hora_fim) || '08:00',
    duracao: usingSeconds ? (t.duracao_s ?? 30) : (t.duracao_min ?? 30),
    on: usingSeconds ? (t.on_seconds ?? 30) : (t.on_minutes ?? 5),
    off: usingSeconds ? (t.off_seconds ?? 15) : (t.off_minutes ?? 10),
    unidade: usingSeconds ? 's' : 'min',
    dias_mask: t.dias_semana,
    observacao: t.observacao ?? '',
  }
}

function toInput(f: FormState, overlap_confirmed = false): PostTimerInput {
  const base: PostTimerInput = {
    alvo_tipo: f.alvo_tipo,
    alvo_id: f.alvo_tipo === 'sector' ? f.alvo_id ?? null : null,
    tipo: f.tipo,
    nome: f.nome.trim(),
    dias_semana: f.dias_mask,
    observacao: f.observacao.trim() || undefined,
    overlap_confirmed,
  }
  // Manda o par escolhido preenchido e o outro como null (firmware/banco
  // ignoram null). Isso evita ambiguidade ao editar timers depois.
  const inSeconds = f.unidade === 's'
  if (f.tipo === 'fixed') {
    base.hora_inicio = f.hora_inicio
    if (inSeconds) {
      base.duracao_s = f.duracao
      base.duracao_min = null
    } else {
      base.duracao_min = f.duracao
      base.duracao_s = null
    }
  } else {
    if (f.tipo === 'cyclic_window') {
      base.hora_inicio = f.hora_inicio
      base.hora_fim = f.hora_fim
    }
    if (inSeconds) {
      base.on_seconds = f.on
      base.off_seconds = f.off
      base.on_minutes = null
      base.off_minutes = null
    } else {
      base.on_minutes = f.on
      base.off_minutes = f.off
      base.on_seconds = null
      base.off_seconds = null
    }
  }
  return base
}

type ConflictBody = {
  error?: string
  conflitos?: Array<{
    with_timer_name?: string
    overlap_windows?: Array<{ dia: number; start: string; end: string }>
  }>
  requires?: string
}

async function readConflict(err: unknown): Promise<ConflictBody | null> {
  if (!(err instanceof HTTPError)) return null
  try {
    return (await err.response.clone().json()) as ConflictBody
  } catch {
    return null
  }
}

type Props = {
  deviceId: string
  setores: IrrigationSector[]
}

export function TimersTab({ deviceId, setores }: Props) {
  const list = useTimers(deviceId)
  const create = useCreateTimer(deviceId)
  const update = useUpdateTimer(deviceId)
  const remove = useDeleteTimer(deviceId)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(defaultForm)
  const [busy, setBusy] = useState(false)
  const [overlapWarn, setOverlapWarn] = useState<ConflictBody | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<IrrigationTimer | null>(
    null,
  )

  const sectorById = useMemo(() => {
    const m = new Map<string, IrrigationSector>()
    for (const s of setores) m.set(s.id, s)
    return m
  }, [setores])

  // sectorId default no form quando muda alvo_tipo pra sector e atual é null
  useEffect(() => {
    if (form.alvo_tipo === 'sector' && !form.alvo_id && setores.length > 0) {
      setForm((f) => ({ ...f, alvo_id: setores[0].id }))
    }
  }, [form.alvo_tipo, form.alvo_id, setores])

  const openCreate = () => {
    setEditingId(null)
    setForm(defaultForm())
    setOverlapWarn(null)
    setDialogOpen(true)
  }

  const openEdit = (t: IrrigationTimer) => {
    setEditingId(t.id)
    setForm(fromTimer(t))
    setOverlapWarn(null)
    setDialogOpen(true)
  }

  const closeDialog = () => {
    if (busy) return
    setDialogOpen(false)
    setOverlapWarn(null)
  }

  const handleSubmit = async (overlap_confirmed = false) => {
    // Validações básicas
    if (!form.nome.trim()) {
      toast.error('Nome obrigatório')
      return
    }
    if (form.dias_mask === 0) {
      toast.error('Selecione ao menos um dia')
      return
    }
    if (form.alvo_tipo === 'sector' && !form.alvo_id) {
      toast.error('Selecione o setor')
      return
    }

    setBusy(true)
    setOverlapWarn(null)
    try {
      const input = toInput(form, overlap_confirmed)
      if (editingId) {
        await update.mutateAsync({ id: editingId, patch: input })
        toast.success('Timer atualizado')
      } else {
        await create.mutateAsync(input)
        toast.success('Timer criado')
      }
      setDialogOpen(false)
    } catch (err) {
      const body = await readConflict(err)
      if (
        body &&
        (body.error === 'conflito_alvo_diferente' ||
          body.requires === 'overlap_confirmed')
      ) {
        setOverlapWarn(body)
      }
      // toast já tratado nos hooks pra outros erros
    } finally {
      setBusy(false)
    }
  }

  const toggleAtivo = async (t: IrrigationTimer) => {
    try {
      await update.mutateAsync({
        id: t.id,
        patch: { ativo: !t.ativo } as unknown as Partial<PostTimerInput>,
      })
    } catch {
      /* hook trata */
    }
  }

  const togglePausado = async (t: IrrigationTimer) => {
    try {
      await update.mutateAsync({
        id: t.id,
        patch: { pausado: !t.pausado } as unknown as Partial<PostTimerInput>,
      })
    } catch {
      /* hook trata */
    }
  }

  const handleConfirmDelete = () => {
    if (!confirmDelete) return
    remove.mutate(confirmDelete.id, {
      onSettled: () => setConfirmDelete(null),
    })
  }

  const timers = list.data ?? []

  const setDays = (mask: number) => setForm((f) => ({ ...f, dias_mask: mask }))
  const toggleDay = (bit: number) =>
    setForm((f) => ({ ...f, dias_mask: f.dias_mask ^ (1 << bit) }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Timers programados
        </h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => list.refetch()}
            disabled={list.isFetching}
          >
            {list.isFetching ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Atualizar
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Novo timer
          </Button>
        </div>
      </div>

      {list.isPending ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
            <p className="text-sm">Carregando timers…</p>
          </CardContent>
        </Card>
      ) : list.isError ? (
        <Card>
          <CardContent className="py-8 text-center text-destructive">
            <p className="text-sm">Falha ao carregar timers.</p>
          </CardContent>
        </Card>
      ) : timers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Nenhum timer programado.</p>
            <p className="text-sm mt-1">
              Crie um timer pra agendar irrigação automática.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {timers.map((t) => {
            const dias = maskToList(t.dias_semana)
            const setor =
              t.alvo_tipo === 'sector' && t.alvo_id
                ? sectorById.get(t.alvo_id)
                : null
            const targetLabel = setor
              ? `Setor ${setor.numero} · ${setor.nome}`
              : t.alvo_tipo === 'sector'
                ? `Setor (${t.alvo_id ?? '?'})`
                : 'Bomba'
            return (
              <Card
                key={t.id}
                className={!t.ativo ? 'opacity-60' : undefined}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{t.nome}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {targetLabel}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {TIPO_LABEL[t.tipo]}
                        </Badge>
                        {t.pausado && (
                          <Badge className="text-[10px] bg-amber-500 hover:bg-amber-500">
                            Pausado
                          </Badge>
                        )}
                        {!t.ativo && (
                          <Badge variant="secondary" className="text-[10px]">
                            Inativo
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {summaryLabel(t)}
                      </p>
                      <div className="flex gap-1 flex-wrap">
                        {DAYS.map((d) => (
                          <Badge
                            key={d.bit}
                            variant={
                              dias.includes(d.bit) ? 'default' : 'outline'
                            }
                            className="text-[10px] px-1.5"
                          >
                            {d.label}
                          </Badge>
                        ))}
                      </div>
                      {t.observacao && (
                        <p className="text-xs text-muted-foreground italic">
                          {t.observacao}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(t)}
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setConfirmDelete(t)}
                          className="text-destructive"
                          title="Excluir"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant={t.ativo ? 'default' : 'outline'}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => toggleAtivo(t)}
                          disabled={update.isPending}
                        >
                          {t.ativo ? 'Ativo' : 'Inativo'}
                        </Button>
                        <Button
                          variant={t.pausado ? 'default' : 'outline'}
                          size="sm"
                          className={`h-7 text-xs ${t.pausado ? 'bg-amber-500 hover:bg-amber-500' : ''}`}
                          onClick={() => togglePausado(t)}
                          disabled={update.isPending}
                        >
                          {t.pausado ? 'Retomar' : 'Pausar'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Dialog criar/editar */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!o) closeDialog()
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Editar timer' : 'Novo timer'}
            </DialogTitle>
            <DialogDescription>
              Agende a irrigação por horário fixo, ciclo dentro de uma janela
              ou ciclo contínuo 24h.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Nome */}
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input
                value={form.nome}
                onChange={(e) =>
                  setForm((f) => ({ ...f, nome: e.target.value }))
                }
                placeholder="Ex.: Manhã setor da horta"
                maxLength={64}
                disabled={busy}
              />
            </div>

            {/* Alvo */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Alvo</Label>
                <Select
                  value={form.alvo_tipo}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      alvo_tipo: v as TimerAlvoTipo,
                      alvo_id: v === 'sector' && setores[0] ? setores[0].id : null,
                    }))
                  }
                  disabled={busy || Boolean(editingId)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pump">Bomba</SelectItem>
                    <SelectItem value="sector">Setor</SelectItem>
                  </SelectContent>
                </Select>
                {editingId && (
                  <p className="text-xs text-muted-foreground">
                    Alvo não pode ser trocado depois de criado.
                  </p>
                )}
              </div>
              {form.alvo_tipo === 'sector' && (
                <div className="space-y-1">
                  <Label>Setor</Label>
                  <Select
                    value={form.alvo_id ?? ''}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, alvo_id: v }))
                    }
                    disabled={busy || Boolean(editingId)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione…" />
                    </SelectTrigger>
                    <SelectContent>
                      {setores.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          #{s.numero} · {s.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Tipo */}
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select
                value={form.tipo}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, tipo: v as TimerTipo }))
                }
                disabled={busy}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">
                    Fixo — horário e duração
                  </SelectItem>
                  <SelectItem value="cyclic_window">
                    Cíclico — alterna on/off dentro de uma janela
                  </SelectItem>
                  <SelectItem value="cyclic_continuous">
                    Cíclico contínuo — alterna on/off 24 horas
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Toggle de unidade — visível pra qualquer tipo (fica acima dos campos numéricos). */}
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Unidade dos tempos</Label>
              <Select
                value={form.unidade}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, unidade: v as Unidade }))
                }
                disabled={busy}
              >
                <SelectTrigger className="h-8 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="min">Minutos</SelectItem>
                  <SelectItem value="s">Segundos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Campos por tipo */}
            {form.tipo === 'fixed' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Horário</Label>
                  <Input
                    type="time"
                    value={form.hora_inicio}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, hora_inicio: e.target.value }))
                    }
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Duração ({form.unidade === 's' ? 'seg' : 'min'})</Label>
                  <Input
                    type="number"
                    min={1}
                    max={form.unidade === 's' ? 86400 : 480}
                    value={form.duracao}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        duracao: Number(e.target.value),
                      }))
                    }
                    disabled={busy}
                  />
                </div>
              </div>
            )}

            {form.tipo === 'cyclic_window' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Início da janela</Label>
                  <Input
                    type="time"
                    value={form.hora_inicio}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, hora_inicio: e.target.value }))
                    }
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Fim da janela</Label>
                  <Input
                    type="time"
                    value={form.hora_fim}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, hora_fim: e.target.value }))
                    }
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1">
                  <Label>On ({form.unidade === 's' ? 'seg' : 'min'})</Label>
                  <Input
                    type="number"
                    min={1}
                    max={form.unidade === 's' ? 86400 : 120}
                    value={form.on}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        on: Number(e.target.value),
                      }))
                    }
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Off ({form.unidade === 's' ? 'seg' : 'min'})</Label>
                  <Input
                    type="number"
                    min={0}
                    max={form.unidade === 's' ? 86400 : 1440}
                    value={form.off}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        off: Number(e.target.value),
                      }))
                    }
                    disabled={busy}
                  />
                </div>
              </div>
            )}

            {form.tipo === 'cyclic_continuous' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>On ({form.unidade === 's' ? 'seg' : 'min'})</Label>
                  <Input
                    type="number"
                    min={1}
                    max={form.unidade === 's' ? 86400 : 120}
                    value={form.on}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        on: Number(e.target.value),
                      }))
                    }
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Off ({form.unidade === 's' ? 'seg' : 'min'})</Label>
                  <Input
                    type="number"
                    min={0}
                    max={form.unidade === 's' ? 86400 : 1440}
                    value={form.off}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        off: Number(e.target.value),
                      }))
                    }
                    disabled={busy}
                  />
                </div>
              </div>
            )}

            {/* Dias da semana */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Dias da semana</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setDays(PRESET_DIAS.todos)}
                    disabled={busy}
                  >
                    Todos
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setDays(PRESET_DIAS.uteis)}
                    disabled={busy}
                  >
                    Úteis
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setDays(PRESET_DIAS.fimdesemana)}
                    disabled={busy}
                  >
                    Fim de semana
                  </Button>
                </div>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {DAYS.map((d) => {
                  const on = (form.dias_mask & (1 << d.bit)) !== 0
                  return (
                    <Button
                      key={d.bit}
                      type="button"
                      variant={on ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 w-12 text-xs"
                      onClick={() => toggleDay(d.bit)}
                      disabled={busy}
                    >
                      {d.label}
                    </Button>
                  )
                })}
              </div>
            </div>

            {/* Observação */}
            <div className="space-y-1">
              <Label>Observação (opcional)</Label>
              <Textarea
                value={form.observacao}
                onChange={(e) =>
                  setForm((f) => ({ ...f, observacao: e.target.value }))
                }
                rows={2}
                maxLength={240}
                disabled={busy}
              />
            </div>

            {/* Conflito alvo diferente — pede confirmação */}
            {overlapWarn && (
              <Alert className="border-amber-300 bg-amber-50 text-amber-900">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="space-y-2 text-amber-900">
                  <p className="font-medium">
                    Conflito com timer de outro alvo detectado
                  </p>
                  {overlapWarn.conflitos?.map((c, i) => (
                    <div key={i} className="text-xs">
                      • <strong>{c.with_timer_name}</strong>
                      {c.overlap_windows && c.overlap_windows.length > 0 && (
                        <span className="text-muted-foreground">
                          {' '}
                          —{' '}
                          {c.overlap_windows
                            .map(
                              (w) =>
                                `${DAYS[w.dia]?.label ?? w.dia} ${w.start}–${w.end}`,
                            )
                            .join(', ')}
                        </span>
                      )}
                    </div>
                  ))}
                  <p className="text-xs">
                    Esses alvos podem operar em paralelo (bomba + setor de
                    outro grupo, por exemplo). Se for intencional, confirme.
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={busy}>
              Cancelar
            </Button>
            {overlapWarn ? (
              <Button
                onClick={() => handleSubmit(true)}
                disabled={busy}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Confirmar e salvar
              </Button>
            ) : (
              <Button onClick={() => handleSubmit(false)} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {editingId ? 'Salvar' : 'Criar'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => {
          if (!o && !remove.isPending) setConfirmDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover timer?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{confirmDelete?.nome}</strong> será removido. Esta ação
              não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault()
                handleConfirmDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {remove.isPending && (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              )}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
