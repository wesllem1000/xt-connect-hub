import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bot,
  Loader2,
  Mail,
  Plus,
  Power,
  Save,
  Sparkles,
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { listDispositivos } from '@/api/dispositivos'

import {
  useAutomacoes,
  useCreateAutomacao,
  useDeleteAutomacao,
  usePatchAutomacao,
} from '../hooks'
import type {
  AutomationAcao,
  AutomationRule,
  TriggerType,
} from '../types'

const TRIGGER_LABEL: Record<TriggerType, string> = {
  irrigation_alarm_created: 'Alarme de irrigação criado',
  device_offline: 'Dispositivo offline (futuro)',
  manual: 'Manual (via API)',
}

const COMANDOS = [
  { value: 'pump_off', label: 'Desligar bomba' },
  { value: 'safe_closure', label: 'Fechamento seguro (bomba + setores)' },
  { value: 'sector_close', label: 'Fechar setor (params.numero)' },
  { value: 'mode_set', label: 'Trocar modo (params.modo)' },
] as const

export function AutomacoesPage() {
  const query = useAutomacoes()
  const [editing, setEditing] = useState<AutomationRule | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<AutomationRule | null>(null)

  const patch = usePatchAutomacao()
  const del = useDeleteAutomacao()

  const sorted = useMemo(() => {
    if (!query.data) return []
    return [...query.data].sort((a, b) =>
      a.criado_em.localeCompare(b.criado_em),
    )
  }, [query.data])

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Automações
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Regras que reagem a eventos do sistema. Disparam ações como enviar
            e-mail extra ou cortar bomba/setores via comando MQTT.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Nova automação
        </Button>
      </div>

      {query.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : query.isError ? (
        <Card>
          <CardContent className="py-8 text-center text-destructive">
            Falha ao carregar:{' '}
            {query.error instanceof Error ? query.error.message : 'erro'}
          </CardContent>
        </Card>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Nenhuma automação cadastrada.</p>
            <p className="text-sm mt-1">
              Clique em <strong>Nova automação</strong> para criar a primeira.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sorted.map((r) => (
            <Card key={r.id} className={r.ativo ? '' : 'opacity-70'}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-primary" />
                    {r.nome}
                    {!r.ativo && (
                      <Badge variant="outline" className="text-[10px]">
                        INATIVA
                      </Badge>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        patch.mutate({
                          id: r.id,
                          patch: { ativo: !r.ativo },
                        })
                      }
                      disabled={patch.isPending}
                    >
                      <Power className="h-4 w-4 mr-1" />
                      {r.ativo ? 'Desativar' : 'Ativar'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(r)}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-700"
                      onClick={() => setConfirmDelete(r)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {r.descricao && (
                  <p className="text-muted-foreground">{r.descricao}</p>
                )}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Info
                    label="Quando"
                    value={TRIGGER_LABEL[r.trigger_type]}
                  />
                  <Info
                    label="Dispositivo"
                    value={r.device_nome || 'todos os meus'}
                  />
                  <Info
                    label="Cooldown"
                    value={
                      r.cooldown_minutes > 0
                        ? `${r.cooldown_minutes} min`
                        : 'sem cooldown'
                    }
                  />
                  <Info
                    label="Última execução"
                    value={
                      r.last_fired_at
                        ? new Date(r.last_fired_at).toLocaleString('pt-BR')
                        : 'nunca'
                    }
                  />
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground tracking-wide mb-1">
                    Ações
                  </p>
                  <div className="space-y-1">
                    {r.acoes.map((a, i) => (
                      <div
                        key={i}
                        className="text-xs bg-muted/50 rounded px-2 py-1 font-mono"
                      >
                        {acaoSummary(a)}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AutomationFormDialog
        open={creating || editing !== null}
        regra={editing}
        onClose={() => {
          setEditing(null)
          setCreating(false)
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
            <AlertDialogTitle>Remover automação?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmDelete?.nome}" vai parar de disparar. O histórico de
              execuções é apagado junto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={async () => {
                if (!confirmDelete) return
                try {
                  await del.mutateAsync(confirmDelete.id)
                } catch {
                  /* tratado */
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

function acaoSummary(a: AutomationAcao): string {
  if (a.type === 'send_email') {
    const recipients = (a.params.recipients || []).join(', ') || '(vazio)'
    return `📧 Enviar e-mail para: ${recipients}`
  }
  if (a.type === 'publish_command') {
    const p = a.params.params
      ? ` ${JSON.stringify(a.params.params)}`
      : ''
    return `⚡ Comando: ${a.params.cmd}${p}`
  }
  return JSON.stringify(a)
}

// =============================================================
// Form
// =============================================================

type FormState = {
  nome: string
  descricao: string
  device_id: string // '' = todos
  ativo: boolean
  trigger_type: TriggerType
  alarm_tipo_filter: string // 'any' | 'temperature_high' | 'sensor_missing'
  cooldown_minutes: string
  acoes: AutomationAcao[]
}

const EMPTY_FORM: FormState = {
  nome: '',
  descricao: '',
  device_id: '',
  ativo: true,
  trigger_type: 'irrigation_alarm_created',
  alarm_tipo_filter: 'any',
  cooldown_minutes: '0',
  acoes: [
    { type: 'send_email', params: { recipients: [] } },
  ],
}

function fromRegra(r: AutomationRule): FormState {
  const tp = r.trigger_params || {}
  const tipo =
    typeof (tp as { alarm_tipo?: string }).alarm_tipo === 'string'
      ? ((tp as { alarm_tipo: string }).alarm_tipo as string)
      : 'any'
  return {
    nome: r.nome,
    descricao: r.descricao ?? '',
    device_id: r.device_id ?? '',
    ativo: r.ativo,
    trigger_type: r.trigger_type,
    alarm_tipo_filter: tipo,
    cooldown_minutes: String(r.cooldown_minutes ?? 0),
    acoes: r.acoes,
  }
}

function AutomationFormDialog({
  open,
  regra,
  onClose,
}: {
  open: boolean
  regra: AutomationRule | null
  onClose: () => void
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const create = useCreateAutomacao()
  const patch = usePatchAutomacao()
  const pending = create.isPending || patch.isPending

  const devicesQuery = useQuery({
    queryKey: ['dispositivos', 'list-for-automacoes'],
    queryFn: listDispositivos,
    staleTime: 60_000,
  })

  // Re-sync quando abre / regra muda
  useEffect(() => {
    if (!open) return
    setForm(regra ? fromRegra(regra) : EMPTY_FORM)
  }, [open, regra])

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }))
  }

  function setAcao(i: number, a: AutomationAcao) {
    setForm((s) => ({
      ...s,
      acoes: s.acoes.map((x, idx) => (idx === i ? a : x)),
    }))
  }

  function addAcao(type: AutomationAcao['type']) {
    setForm((s) => ({
      ...s,
      acoes: [
        ...s.acoes,
        type === 'send_email'
          ? { type: 'send_email', params: { recipients: [] } }
          : { type: 'publish_command', params: { cmd: 'pump_off' } },
      ],
    }))
  }

  function removeAcao(i: number) {
    setForm((s) => ({ ...s, acoes: s.acoes.filter((_, idx) => idx !== i) }))
  }

  async function handleSave() {
    if (!form.nome.trim()) {
      toast.error('Nome obrigatório')
      return
    }
    if (form.acoes.length === 0) {
      toast.error('Adicione pelo menos uma ação')
      return
    }
    // Valida send_email tem recipients
    for (const a of form.acoes) {
      if (a.type === 'send_email' && a.params.recipients.length === 0) {
        toast.error('Ação de e-mail precisa de pelo menos um destinatário')
        return
      }
    }
    const trigger_params: Record<string, unknown> = {}
    if (
      form.trigger_type === 'irrigation_alarm_created' &&
      form.alarm_tipo_filter !== 'any'
    ) {
      trigger_params.alarm_tipo = form.alarm_tipo_filter
    }
    const cooldown = Math.max(
      0,
      Math.min(10080, parseInt(form.cooldown_minutes, 10) || 0),
    )
    const payload = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim() || null,
      device_id: form.device_id || null,
      ativo: form.ativo,
      trigger_type: form.trigger_type,
      trigger_params,
      acoes: form.acoes,
      cooldown_minutes: cooldown,
    }
    try {
      if (regra) {
        await patch.mutateAsync({ id: regra.id, patch: payload })
      } else {
        await create.mutateAsync(payload)
      }
      onClose()
      setForm(EMPTY_FORM)
    } catch {
      /* tratado nos hooks */
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose()
          setForm(EMPTY_FORM)
        }
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {regra ? 'Editar automação' : 'Nova automação'}
          </DialogTitle>
          <DialogDescription>
            Defina quando a regra dispara e o que ela faz.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input
              value={form.nome}
              maxLength={96}
              onChange={(e) => setField('nome', e.target.value)}
              disabled={pending}
              placeholder="Ex.: Avisar técnico em alarme"
            />
          </div>

          <div className="space-y-1">
            <Label>Descrição (opcional)</Label>
            <Textarea
              value={form.descricao}
              onChange={(e) => setField('descricao', e.target.value)}
              disabled={pending}
              rows={2}
              placeholder="Quando e por que essa regra existe"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Dispositivo</Label>
              <Select
                value={form.device_id || '_all'}
                onValueChange={(v) =>
                  setField('device_id', v === '_all' ? '' : v)
                }
                disabled={pending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos os meus</SelectItem>
                  {(devicesQuery.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.apelido || d.nome || d.serial} ({d.serial})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Ativa</Label>
              <Select
                value={form.ativo ? 'on' : 'off'}
                onValueChange={(v) => setField('ativo', v === 'on')}
                disabled={pending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on">Sim</SelectItem>
                  <SelectItem value="off">Não (pausada)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Quando disparar (trigger)</Label>
            <Select
              value={form.trigger_type}
              onValueChange={(v) =>
                setField('trigger_type', v as TriggerType)
              }
              disabled={pending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="irrigation_alarm_created">
                  Alarme de irrigação criado
                </SelectItem>
                <SelectItem value="manual">Manual (via API)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.trigger_type === 'irrigation_alarm_created' && (
            <div className="space-y-1">
              <Label>Filtrar por tipo de alarme</Label>
              <Select
                value={form.alarm_tipo_filter}
                onValueChange={(v) => setField('alarm_tipo_filter', v)}
                disabled={pending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Qualquer tipo</SelectItem>
                  <SelectItem value="temperature_high">
                    Temperatura alta
                  </SelectItem>
                  <SelectItem value="sensor_missing">
                    Sensor perdido
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label>Cooldown entre disparos (minutos)</Label>
            <Input
              type="number"
              min="0"
              max="10080"
              value={form.cooldown_minutes}
              onChange={(e) => setField('cooldown_minutes', e.target.value)}
              disabled={pending}
            />
            <p className="text-[11px] text-muted-foreground">
              0 = sem cooldown. Útil pra evitar spam de e-mail em alarme
              oscilando.
            </p>
          </div>

          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Ações</Label>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => addAcao('send_email')}
                  disabled={pending}
                >
                  <Mail className="h-4 w-4 mr-1" />
                  + E-mail
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => addAcao('publish_command')}
                  disabled={pending}
                >
                  ⚡ + Comando
                </Button>
              </div>
            </div>

            {form.acoes.map((a, i) => (
              <div
                key={i}
                className="rounded border p-3 space-y-2 bg-muted/30"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide">
                    {a.type === 'send_email'
                      ? '📧 Enviar e-mail'
                      : '⚡ Publicar comando'}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeAcao(i)}
                    disabled={pending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {a.type === 'send_email' ? (
                  <SendEmailEditor
                    acao={a}
                    onChange={(next) => setAcao(i, next)}
                    disabled={pending}
                  />
                ) : (
                  <PublishCommandEditor
                    acao={a}
                    onChange={(next) => setAcao(i, next)}
                    disabled={pending}
                  />
                )}
              </div>
            ))}

            {form.acoes.length === 0 && (
              <p className="text-sm text-muted-foreground italic">
                Adicione pelo menos uma ação.
              </p>
            )}
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

function SendEmailEditor({
  acao,
  onChange,
  disabled,
}: {
  acao: Extract<AutomationAcao, { type: 'send_email' }>
  onChange: (a: Extract<AutomationAcao, { type: 'send_email' }>) => void
  disabled: boolean
}) {
  const recipientsStr = acao.params.recipients.join(', ')
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-xs">Destinatários (e-mails separados por vírgula)</Label>
        <Input
          value={recipientsStr}
          onChange={(e) => {
            const list = e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
            onChange({
              ...acao,
              params: { ...acao.params, recipients: list },
            })
          }}
          disabled={disabled}
          placeholder="tecnico@empresa.com, dono@gmail.com"
          className="text-xs font-mono"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Assunto (opcional)</Label>
        <Input
          value={acao.params.subject ?? ''}
          onChange={(e) =>
            onChange({
              ...acao,
              params: { ...acao.params, subject: e.target.value || undefined },
            })
          }
          disabled={disabled}
          placeholder="[XT Connect] Automação: nome da regra (default)"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Texto do e-mail (opcional)</Label>
        <Textarea
          value={acao.params.body_text ?? ''}
          onChange={(e) =>
            onChange({
              ...acao,
              params: {
                ...acao.params,
                body_text: e.target.value || undefined,
              },
            })
          }
          disabled={disabled}
          rows={3}
          placeholder="Default: 'Regra X disparada. Trigger: Y. Payload: {...}'"
        />
      </div>
    </div>
  )
}

function PublishCommandEditor({
  acao,
  onChange,
  disabled,
}: {
  acao: Extract<AutomationAcao, { type: 'publish_command' }>
  onChange: (a: Extract<AutomationAcao, { type: 'publish_command' }>) => void
  disabled: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-xs">Comando</Label>
        <Select
          value={acao.params.cmd}
          onValueChange={(v) =>
            onChange({
              ...acao,
              params: {
                ...acao.params,
                cmd: v as Extract<
                  AutomationAcao,
                  { type: 'publish_command' }
                >['params']['cmd'],
              },
            })
          }
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMANDOS.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {acao.params.cmd === 'sector_close' && (
        <div className="space-y-1">
          <Label className="text-xs">Número do setor</Label>
          <Input
            type="number"
            min="1"
            max="8"
            value={
              (acao.params.params as { numero?: number } | undefined)
                ?.numero ?? ''
            }
            onChange={(e) => {
              const n = parseInt(e.target.value, 10)
              onChange({
                ...acao,
                params: {
                  ...acao.params,
                  params: Number.isFinite(n) ? { numero: n } : {},
                },
              })
            }}
            disabled={disabled}
          />
        </div>
      )}
      {acao.params.cmd === 'mode_set' && (
        <div className="space-y-1">
          <Label className="text-xs">Modo</Label>
          <Select
            value={
              ((acao.params.params as { modo?: string } | undefined)?.modo ??
                'manual') as string
            }
            onValueChange={(v) =>
              onChange({
                ...acao,
                params: { ...acao.params, params: { modo: v } },
              })
            }
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="automatico">Automático</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Comando vai pra <code>devices/&lt;serial&gt;/commands</code>. Se a
        regra não filtra device_id, o comando vai pra o device do trigger.
      </p>
    </div>
  )
}
