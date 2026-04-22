import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { listModelos } from '@/api/modelos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Filtros, ProdutoStatus } from '../types'

const STATUS_OPTS: { value: ProdutoStatus | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Todos os status' },
  { value: 'ocioso', label: 'Ocioso' },
  { value: 'associado', label: 'Associado' },
  { value: 'defeito', label: 'Defeito' },
  { value: 'retornado', label: 'Retornado' },
]

type Props = {
  filtros: Filtros
  onChange: (f: Filtros) => void
}

export function FiltrosProdutos({ filtros, onChange }: Props) {
  const modelosQuery = useQuery({ queryKey: ['modelos'], queryFn: listModelos })
  const modelos = (modelosQuery.data ?? []).filter(
    (m) => m.prefixo && m.major_version,
  )

  const [search, setSearch] = useState(filtros.search ?? '')

  // Debounce 300ms
  useEffect(() => {
    if (search === (filtros.search ?? '')) return
    const t = setTimeout(() => {
      onChange({ ...filtros, search: search || undefined, page: 1 })
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  return (
    <div className="flex flex-wrap gap-2 items-end">
      <div className="min-w-[180px]">
        <Select
          value={filtros.status ?? 'todos'}
          onValueChange={(v) =>
            onChange({
              ...filtros,
              status: (v === 'todos' ? undefined : (v as ProdutoStatus)),
              page: 1,
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-[200px]">
        <Select
          value={filtros.modelo_id ?? '__todos'}
          onValueChange={(v) =>
            onChange({
              ...filtros,
              modelo_id: v === '__todos' ? undefined : v,
              page: 1,
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Modelo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__todos">Todos os modelos</SelectItem>
            {modelos.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="flex items-baseline gap-2">
                  <span>{m.nome}</span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {m.prefixo}-{m.major_version}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="relative flex-1 min-w-[200px]">
        <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Serial (ex: IRR-V1-000)"
          className="pl-8 pr-8"
        />
        {search && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 absolute right-1 top-1"
            onClick={() => setSearch('')}
            aria-label="Limpar busca"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}
