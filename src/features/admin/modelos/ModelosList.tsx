import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { deleteModelo, listModelos, type Modelo } from '@/api/modelos'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { extractApiError } from '@/lib/api'

import { ModeloFormDialog } from './ModeloFormDialog'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateFormatter.format(d)
}

export function ModelosList() {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['modelos'],
    queryFn: listModelos,
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteModelo(id),
    onSuccess: () => {
      toast.success('Modelo excluído.')
      qc.invalidateQueries({ queryKey: ['modelos'] })
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao excluir modelo.')
      toast.error(msg)
    },
  })

  function handleDelete(m: Modelo) {
    if (m.total_dispositivos > 0) {
      toast.error('Não é possível excluir: modelo em uso por dispositivos.')
      return
    }
    if (!window.confirm(`Excluir o modelo "${m.nome}"?`)) return
    remove.mutate(m.id)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Modelos definem a estrutura (widgets) que cada dispositivo vai apresentar.
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Novo modelo
        </Button>
      </div>

      {query.isPending && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {query.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>Falha ao buscar modelos.</AlertDescription>
        </Alert>
      )}

      {query.isSuccess && query.data.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum modelo cadastrado ainda. Clique em "Novo modelo" para começar.
        </div>
      )}

      {query.isSuccess && query.data.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Fabricante</TableHead>
                <TableHead className="text-center">Dispositivos</TableHead>
                <TableHead>Criado</TableHead>
                <TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((m) => (
                <TableRow key={m.id} className="group">
                  <TableCell className="font-medium">{m.nome}</TableCell>
                  <TableCell>{m.fabricante}</TableCell>
                  <TableCell className="text-center">
                    {m.total_dispositivos > 0 ? (
                      <Badge variant="secondary">{m.total_dispositivos}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(m.criado_em)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setEditingId(m.id)}
                        aria-label={`Editar ${m.nome}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDelete(m)}
                        disabled={remove.isPending}
                        aria-label={`Excluir ${m.nome}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {creating && (
        <ModeloFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setCreating(false)
          }}
        />
      )}

      {editingId && (
        <ModeloFormDialog
          open
          modeloId={editingId}
          onOpenChange={(open) => {
            if (!open) setEditingId(null)
          }}
        />
      )}
    </div>
  )
}
