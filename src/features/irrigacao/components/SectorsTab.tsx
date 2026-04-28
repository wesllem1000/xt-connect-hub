import { useEffect, useState } from 'react'
import { Loader2, Save, Sliders, Sprout } from 'lucide-react'
import { toast } from 'sonner'

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

import { usePatchSetor } from '../hooks/usePatchSetor'
import type {
  IrrigationSector,
  NivelAtivo,
  TipoBotaoFisico,
} from '../types'

type Props = {
  deviceId: string
  setores: IrrigationSector[]
}

type SectorForm = {
  nome: string
  habilitado: boolean
  pausado: boolean
  gpio_rele: number
  nivel_ativo_rele: NivelAtivo
  gpio_botao: number | null
  tipo_botao_fisico: TipoBotaoFisico | null
  debounce_ms: number
}

function fromSector(s: IrrigationSector): SectorForm {
  return {
    nome: s.nome,
    habilitado: s.habilitado,
    pausado: s.pausado,
    gpio_rele: s.gpio_rele,
    nivel_ativo_rele: s.nivel_ativo_rele,
    gpio_botao: s.gpio_botao,
    tipo_botao_fisico: s.tipo_botao_fisico,
    debounce_ms: s.debounce_ms,
  }
}

function diff(a: SectorForm, b: SectorForm) {
  const out: Partial<Record<keyof SectorForm, unknown>> = {}
  for (const k of Object.keys(a) as (keyof SectorForm)[]) {
    if (a[k] !== b[k]) out[k] = a[k]
  }
  return out
}

const BUTTON_TIPO_LABELS: Record<TipoBotaoFisico, string> = {
  pulso_alterna: 'Pulso alterna',
  pulso_liga: 'Pulso liga',
  pulso_desliga: 'Pulso desliga',
  retentivo: 'Retentivo',
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

function SectorCard({
  setor,
  deviceId,
}: {
  setor: IrrigationSector
  deviceId: string
}) {
  const [form, setForm] = useState<SectorForm>(() => fromSector(setor))
  const [initial, setInitial] = useState<SectorForm>(() => fromSector(setor))
  const mutation = usePatchSetor(deviceId)

  useEffect(() => {
    const next = fromSector(setor)
    setForm(next)
    setInitial(next)
  }, [setor])

  const dirtyPatch = diff(form, initial)
  const dirty = Object.keys(dirtyPatch).length > 0

  const set = <K extends keyof SectorForm>(k: K, v: SectorForm[K]) =>
    setForm((s) => ({ ...s, [k]: v }))

  const onSave = async () => {
    if (!dirty) return
    if (!form.nome.trim()) {
      toast.error('Nome não pode ser vazio')
      return
    }
    try {
      await mutation.mutateAsync({
        numero: setor.numero,
        patch: dirtyPatch,
      })
      setInitial(form)
      toast.success(`Setor ${setor.numero} salvo`)
    } catch {
      /* tratado no hook */
    }
  }

  return (
    <Card className={!form.habilitado ? 'opacity-70' : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sprout
            className={
              form.habilitado ? 'h-5 w-5 text-emerald-600' : 'h-5 w-5'
            }
          />
          <span>
            #{setor.numero} · {form.nome || `Setor ${setor.numero}`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input
              value={form.nome}
              onChange={(e) => set('nome', e.target.value)}
              maxLength={48}
              disabled={mutation.isPending}
            />
          </div>
          <div className="space-y-1">
            <Label>Habilitado</Label>
            <Select
              value={form.habilitado ? 'on' : 'off'}
              onValueChange={(v) => set('habilitado', v === 'on')}
              disabled={mutation.isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="on">Sim</SelectItem>
                <SelectItem value="off">Não (oculta no painel)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Pausado</Label>
            <Select
              value={form.pausado ? 'on' : 'off'}
              onValueChange={(v) => set('pausado', v === 'on')}
              disabled={mutation.isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Não</SelectItem>
                <SelectItem value="on">Sim (ignora timers)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>GPIO do relé</Label>
            <Input
              type="number"
              min={0}
              max={48}
              value={form.gpio_rele}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) set('gpio_rele', n)
              }}
              disabled={mutation.isPending}
            />
          </div>
          <div className="space-y-1">
            <Label>Nível ativo do relé</Label>
            <Select
              value={form.nivel_ativo_rele}
              onValueChange={(v) =>
                set('nivel_ativo_rele', v as NivelAtivo)
              }
              disabled={mutation.isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high">Alto (HIGH liga)</SelectItem>
                <SelectItem value="low">Baixo (LOW liga)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Debounce do botão (ms)</Label>
            <Input
              type="number"
              min={0}
              max={2000}
              value={form.debounce_ms}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) set('debounce_ms', n)
              }}
              disabled={mutation.isPending}
            />
          </div>
          <div className="space-y-1">
            <Label>GPIO do botão (opcional)</Label>
            <Input
              type="number"
              min={-1}
              max={48}
              placeholder="vazio = sem botão"
              value={form.gpio_botao ?? ''}
              onChange={(e) => {
                const v = e.target.value
                if (v === '') set('gpio_botao', null)
                else {
                  const n = Number(v)
                  if (Number.isFinite(n)) set('gpio_botao', n)
                }
              }}
              disabled={mutation.isPending}
            />
          </div>
          <div className="space-y-1">
            <Label>Tipo do botão</Label>
            <Select
              value={form.tipo_botao_fisico ?? '_none'}
              onValueChange={(v) =>
                set(
                  'tipo_botao_fisico',
                  v === '_none' ? null : (v as TipoBotaoFisico),
                )
              }
              disabled={mutation.isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Sem botão</SelectItem>
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
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground border-t pt-3">
          <span>
            Último acionamento:{' '}
            <span className="text-foreground">
              {fmtPt(setor.ultimo_acionamento_em)}
            </span>
          </span>
          <span>
            Última duração:{' '}
            <span className="text-foreground">
              {setor.ultima_duracao_s != null
                ? `${setor.ultima_duracao_s}s`
                : '—'}
            </span>
          </span>
          <span>
            Próxima execução:{' '}
            <span className="text-foreground">
              {fmtPt(setor.proxima_execucao_em)}
            </span>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={onSave}
            disabled={!dirty || mutation.isPending}
          >
            {mutation.isPending ? (
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
      </CardContent>
    </Card>
  )
}

export function SectorsTab({ deviceId, setores }: Props) {
  if (setores.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Sliders className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>Nenhum setor provisionado.</p>
          <p className="text-sm mt-1">
            Use Reset de fábrica na aba Sistema pra reaplicar defaults.
          </p>
        </CardContent>
      </Card>
    )
  }

  const ordered = [...setores].sort((a, b) => a.numero - b.numero)
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Configuração por setor. Mudanças no GPIO/relé/botão exigem reboot
        do firmware pra ter efeito (config_reload no painel resolve em
        muitos casos).
      </p>
      {ordered.map((s) => (
        <SectorCard key={s.id} setor={s} deviceId={deviceId} />
      ))}
    </div>
  )
}
