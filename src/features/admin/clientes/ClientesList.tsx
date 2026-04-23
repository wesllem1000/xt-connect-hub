import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertCircle, ChevronRight, Plus } from 'lucide-react'

import { listClientes, type CreateClienteResponse } from '@/api/admin'
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

import { NovoClienteDialog } from './NovoClienteDialog'
import { SenhaTemporariaDialog } from './SenhaTemporariaDialog'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateFormatter.format(d)
}

export function ClientesList() {
  const [creating, setCreating] = useState(false)
  const [senhaDialog, setSenhaDialog] = useState<CreateClienteResponse | null>(
    null,
  )

  const query = useQuery({
    queryKey: ['clientes'],
    queryFn: listClientes,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Clientes que podem criar e gerenciar seus próprios dispositivos.
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Novo cliente
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
          <AlertDescription>Falha ao buscar clientes.</AlertDescription>
        </Alert>
      )}

      {query.isSuccess && query.data.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum cliente cadastrado ainda. Clique em "Novo cliente" para começar.
        </div>
      )}

      {query.isSuccess && query.data.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead className="text-center">Dispositivos</TableHead>
                <TableHead>Verificado</TableHead>
                <TableHead>Cadastrado</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((c) => (
                <TableRow key={c.id} className="group">
                  <TableCell className="font-medium">
                    <Link
                      to={`/admin/clientes/${c.id}`}
                      className="hover:underline"
                    >
                      {c.nome ?? '—'}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.email}
                  </TableCell>
                  <TableCell className="text-center">
                    {c.total_dispositivos > 0 ? (
                      <Badge variant="secondary">{c.total_dispositivos}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.email_verified ? (
                      <Badge variant="default">Verificado</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Pendente
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(c.criado_em)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      to={`/admin/clientes/${c.id}`}
                      className="inline-flex items-center opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={`Ver ${c.nome ?? c.email}`}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <NovoClienteDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(resp) => setSenhaDialog(resp)}
      />

      <SenhaTemporariaDialog
        open={senhaDialog !== null}
        onOpenChange={(open) => {
          if (!open) setSenhaDialog(null)
        }}
        response={senhaDialog}
      />
    </div>
  )
}
