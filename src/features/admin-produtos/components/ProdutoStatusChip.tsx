import { Badge } from '@/components/ui/badge'
import type { ProdutoStatus } from '../types'

const LABEL: Record<ProdutoStatus, string> = {
  ocioso: 'Ocioso',
  associado: 'Associado',
  defeito: 'Defeito',
  retornado: 'Retornado',
}

const CLASSES: Record<ProdutoStatus, string> = {
  ocioso: 'bg-slate-500 hover:bg-slate-500 text-white',
  associado: 'bg-emerald-600 hover:bg-emerald-600 text-white',
  defeito: 'bg-red-600 hover:bg-red-600 text-white',
  retornado: 'bg-amber-500 hover:bg-amber-500 text-white',
}

export function ProdutoStatusChip({ status }: { status: ProdutoStatus }) {
  return <Badge className={CLASSES[status]}>{LABEL[status]}</Badge>
}
