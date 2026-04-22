import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, ChevronLeft, ChevronRight, Package, Plus, Radio } from 'lucide-react'

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

import { FiltrosProdutos } from '../components/FiltrosProdutos'
import { ProdutoStatusChip } from '../components/ProdutoStatusChip'
import { ProvisionarProdutoModal } from '../components/ProvisionarProdutoModal'
import { useProdutos } from '../hooks'
import type { Filtros, Produto, ProdutoStatus } from '../types'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function formatRel(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'agora'
  if (diff < 3600) return `${Math.floor(diff / 60)} min atrás`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h atrás`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d atrás`
  return dateFormatter.format(d)
}

function parseFiltros(sp: URLSearchParams): Filtros {
  const status = sp.get('status') as ProdutoStatus | null
  const modeloId = sp.get('modelo_id')
  const search = sp.get('search')
  const pageRaw = sp.get('page')
  const page = pageRaw ? parseInt(pageRaw, 10) : 1
  return {
    status: status ?? undefined,
    modelo_id: modeloId ?? undefined,
    search: search ?? undefined,
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  }
}

function stringifyFiltros(f: Filtros): URLSearchParams {
  const sp = new URLSearchParams()
  if (f.status) sp.set('status', f.status)
  if (f.modelo_id) sp.set('modelo_id', f.modelo_id)
  if (f.search) sp.set('search', f.search)
  if (f.page && f.page > 1) sp.set('page', String(f.page))
  return sp
}

export function ProdutosListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filtros = useMemo(() => parseFiltros(searchParams), [searchParams])
  const [provisionarOpen, setProvisionarOpen] = useState(false)

  function updateFiltros(f: Filtros) {
    setSearchParams(stringifyFiltros(f), { replace: true })
  }

  const query = useProdutos(filtros)
  const navigate = useNavigate()

  const produtos = useMemo(() => {
    const list = query.data?.produtos ?? []
    const needle = filtros.search?.trim().toLowerCase()
    if (!needle) return list
    return list.filter((p) => p.serial.toLowerCase().includes(needle))
  }, [query.data, filtros.search])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Produtos</h2>
          <p className="text-muted-foreground text-sm">
            Frota de dispositivos fabricados. Provisione novos e acompanhe claims.
          </p>
        </div>
        <Button onClick={() => setProvisionarOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Provisionar novo
        </Button>
      </div>

      <FiltrosProdutos filtros={filtros} onChange={updateFiltros} />

      {query.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Falha ao carregar</AlertTitle>
          <AlertDescription>
            <ErrorText error={query.error} />
          </AlertDescription>
        </Alert>
      )}

      {query.isPending && <LoadingTable />}

      {query.isSuccess && produtos.length === 0 && (
        <EmptyState onAdd={() => setProvisionarOpen(true)} />
      )}

      {query.isSuccess && produtos.length > 0 && (
        <>
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Serial</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Online</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Provisionado</TableHead>
                  <TableHead>Último dado</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {produtos.map((p) => (
                  <ProdutoRow key={p.id} produto={p} onOpen={() => navigate(`/admin/produtos/${p.id}`)} />
                ))}
              </TableBody>
            </Table>
          </div>

          {query.data && query.data.paginacao.pages > 1 && (
            <Paginacao
              page={query.data.paginacao.page}
              pages={query.data.paginacao.pages}
              total={query.data.paginacao.total}
              onPageChange={(p) => updateFiltros({ ...filtros, page: p })}
            />
          )}
        </>
      )}

      <ProvisionarProdutoModal open={provisionarOpen} onOpenChange={setProvisionarOpen} />
    </div>
  )
}

function ProdutoRow({
  produto,
  onOpen,
}: {
  produto: Produto
  onOpen: () => void
}) {
  return (
    <TableRow
      className="cursor-pointer"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <TableCell className="font-mono text-xs">{produto.serial}</TableCell>
      <TableCell className="text-sm">
        {produto.modelo_nome ?? '—'}
        {produto.prefixo && produto.major_version && (
          <span className="ml-1 text-xs text-muted-foreground font-mono">
            ({produto.prefixo}-{produto.major_version})
          </span>
        )}
      </TableCell>
      <TableCell>
        <ProdutoStatusChip status={produto.status} />
      </TableCell>
      <TableCell>
        {produto.status === 'associado' ? (
          <Badge
            variant={produto.is_online ? 'default' : 'outline'}
            className={
              produto.is_online
                ? 'bg-green-600 hover:bg-green-600'
                : 'text-muted-foreground'
            }
          >
            <Radio className="h-3 w-3 mr-1" />
            {produto.is_online ? 'Online' : 'Offline'}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm truncate max-w-[200px]">
        {produto.owner_email ?? (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatRel(produto.provisionado_em)}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {produto.status === 'associado' ? formatRel(produto.last_seen) : '—'}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
          <Link to={`/admin/produtos/${produto.id}`} aria-label={`Abrir ficha ${produto.serial}`}>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  )
}

function LoadingTable() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-md border border-dashed px-6 py-12 text-center space-y-3">
      <div className="mx-auto rounded-full bg-primary/10 p-3 w-fit">
        <Package className="h-6 w-6 text-primary" />
      </div>
      <h3 className="text-base font-medium">Nenhum produto aqui</h3>
      <p className="text-sm text-muted-foreground">
        Provisione o primeiro produto da frota.
      </p>
      <Button onClick={onAdd}>
        <Plus className="h-4 w-4 mr-2" />
        Provisionar novo
      </Button>
    </div>
  )
}

function Paginacao({
  page,
  pages,
  total,
  onPageChange,
}: {
  page: number
  pages: number
  total: number
  onPageChange: (p: number) => void
}) {
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        Página {page} de {pages} · {total} produto{total === 1 ? '' : 's'}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          Próxima
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function ErrorText({ error }: { error: unknown }) {
  const [msg, setMsg] = useState('Falha ao carregar produtos.')
  useEffect(() => {
    let cancelled = false
    extractApiError(error, 'Falha ao carregar produtos.').then((m) => {
      if (!cancelled) setMsg(m)
    })
    return () => {
      cancelled = true
    }
  }, [error])
  return <>{msg}</>
}
