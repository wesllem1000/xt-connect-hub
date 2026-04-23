import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  createModelo,
  getModelo,
  updateModelo,
  type ModeloInput,
  type ModeloWidgetInput,
} from '@/api/modelos'
import { listCatalogoWidgets, type CatalogoWidget } from '@/api/widgets'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { extractApiError } from '@/lib/api'

type SelectedWidget = {
  catalogo_widget_id: string
  titulo: string
  config_padrao: string
  configError?: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  modeloId?: string
}

function widgetToSelected(
  catalogo: CatalogoWidget[],
  w: { catalogo_widget_id: string; titulo?: string; config_padrao?: Record<string, unknown> | null },
): SelectedWidget {
  const cw = catalogo.find((c) => c.id === w.catalogo_widget_id)
  return {
    catalogo_widget_id: w.catalogo_widget_id,
    titulo: w.titulo || cw?.nome || '',
    config_padrao: JSON.stringify(
      w.config_padrao && Object.keys(w.config_padrao).length > 0
        ? w.config_padrao
        : cw?.configuracao_padrao ?? {},
      null,
      2,
    ),
  }
}

export function ModeloFormDialog({ open, onOpenChange, modeloId }: Props) {
  const isEdit = Boolean(modeloId)
  const qc = useQueryClient()

  const catalogo = useQuery({
    queryKey: ['catalogo-widgets'],
    queryFn: listCatalogoWidgets,
  })

  const detail = useQuery({
    queryKey: ['modelo', modeloId],
    queryFn: () => getModelo(modeloId!),
    enabled: isEdit,
  })

  const [nome, setNome] = useState('')
  const [fabricante, setFabricante] = useState('')
  const [descricao, setDescricao] = useState('')
  const [selected, setSelected] = useState<SelectedWidget[]>([])

  useEffect(() => {
    if (!open) return
    if (isEdit && detail.data && catalogo.data) {
      setNome(detail.data.nome)
      setFabricante(detail.data.fabricante)
      setDescricao(detail.data.descricao ?? '')
      setSelected(
        detail.data.widgets.map((w) =>
          widgetToSelected(catalogo.data, {
            catalogo_widget_id: w.catalogo_widget_id,
            titulo: w.titulo,
            config_padrao: w.config_padrao,
          }),
        ),
      )
    } else if (!isEdit) {
      setNome('')
      setFabricante('')
      setDescricao('')
      setSelected([])
    }
  }, [open, isEdit, detail.data, catalogo.data])

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.catalogo_widget_id)), [selected])

  function toggleWidget(w: CatalogoWidget) {
    if (selectedIds.has(w.id)) {
      setSelected((prev) => prev.filter((s) => s.catalogo_widget_id !== w.id))
      return
    }
    setSelected((prev) => [
      ...prev,
      {
        catalogo_widget_id: w.id,
        titulo: w.nome,
        config_padrao: JSON.stringify(w.configuracao_padrao ?? {}, null, 2),
      },
    ])
  }

  function move(index: number, delta: number) {
    setSelected((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function updateSelected(index: number, patch: Partial<SelectedWidget>) {
    setSelected((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  const mutation = useMutation({
    mutationFn: (input: ModeloInput) =>
      isEdit ? updateModelo(modeloId!, input) : createModelo(input),
    onSuccess: () => {
      toast.success(isEdit ? 'Modelo atualizado.' : 'Modelo criado.')
      qc.invalidateQueries({ queryKey: ['modelos'] })
      if (isEdit) qc.invalidateQueries({ queryKey: ['modelo', modeloId] })
      onOpenChange(false)
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao salvar modelo.')
      toast.error(msg)
    },
  })

  function handleSubmit() {
    if (!nome.trim()) {
      toast.error('Informe o nome.')
      return
    }
    if (!fabricante.trim()) {
      toast.error('Informe o fabricante.')
      return
    }
    const widgets: ModeloWidgetInput[] = []
    for (let i = 0; i < selected.length; i++) {
      const s = selected[i]
      let config: Record<string, unknown> | null = null
      if (s.config_padrao.trim()) {
        try {
          const parsed = JSON.parse(s.config_padrao)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            config = parsed as Record<string, unknown>
          } else {
            toast.error(`Config do widget "${s.titulo}" precisa ser um objeto JSON.`)
            return
          }
        } catch {
          toast.error(`JSON inválido no widget "${s.titulo}".`)
          return
        }
      }
      widgets.push({
        catalogo_widget_id: s.catalogo_widget_id,
        ordem: i,
        titulo: s.titulo,
        config_padrao: config,
      })
    }
    mutation.mutate({
      nome: nome.trim(),
      fabricante: fabricante.trim(),
      descricao: descricao.trim() || null,
      widgets,
    })
  }

  const loadingInitial = isEdit && (detail.isPending || catalogo.isPending)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar modelo' : 'Novo modelo de dispositivo'}</DialogTitle>
          <DialogDescription>
            Defina os metadados e escolha quais widgets ficarão disponíveis para cada dispositivo deste modelo.
          </DialogDescription>
        </DialogHeader>

        {loadingInitial ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="mod-nome">Nome</Label>
                <Input
                  id="mod-nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex: ESP32 Irrigação v1"
                />
              </div>
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="mod-fab">Fabricante</Label>
                <Input
                  id="mod-fab"
                  value={fabricante}
                  onChange={(e) => setFabricante(e.target.value)}
                  placeholder="Ex: XT Conect"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="mod-desc">Descrição</Label>
                <Textarea
                  id="mod-desc"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Descrição opcional do modelo"
                  rows={2}
                />
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Widgets do modelo</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border p-3 space-y-2 max-h-96 overflow-y-auto">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Catálogo
                  </p>
                  {catalogo.isPending && (
                    <p className="text-sm text-muted-foreground">Carregando…</p>
                  )}
                  {catalogo.data?.map((w) => (
                    <label
                      key={w.id}
                      className="flex items-start gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-2 py-1.5"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selectedIds.has(w.id)}
                        onChange={() => toggleWidget(w)}
                      />
                      <div className="flex-1">
                        <div className="font-medium">{w.nome}</div>
                        {w.descricao && (
                          <div className="text-xs text-muted-foreground">{w.descricao}</div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>

                <div className="rounded-md border p-3 space-y-3 max-h-96 overflow-y-auto">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Selecionados ({selected.length})
                  </p>
                  {selected.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Marque os widgets do catálogo ao lado para adicionar ao modelo.
                    </p>
                  )}
                  {selected.map((s, i) => (
                    <div key={s.catalogo_widget_id} className="rounded-md border p-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground w-6">
                          {i + 1}.
                        </span>
                        <Input
                          value={s.titulo}
                          onChange={(e) => updateSelected(i, { titulo: e.target.value })}
                          className="h-8"
                          placeholder="Título"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          aria-label="Subir"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => move(i, 1)}
                          disabled={i === selected.length - 1}
                          aria-label="Descer"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() =>
                            setSelected((prev) => prev.filter((_, idx) => idx !== i))
                          }
                          aria-label="Remover"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <Textarea
                        value={s.config_padrao}
                        onChange={(e) => updateSelected(i, { config_padrao: e.target.value })}
                        rows={4}
                        className="font-mono text-xs"
                        spellCheck={false}
                        placeholder='{ "unidade": "°C" }'
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending || loadingInitial}>
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
