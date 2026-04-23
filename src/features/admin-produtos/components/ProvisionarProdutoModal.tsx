import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Printer } from 'lucide-react'
import { toast } from 'sonner'

import { listModelos } from '@/api/modelos'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

import { useProvisionarProduto } from '../hooks'
import type { ProvisionarResponse } from '../types'
import { CredenciaisProduto } from './CredenciaisProduto'
import { openEtiquetaProduto } from './EtiquetaProduto'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProvisionarProdutoModal({ open, onOpenChange }: Props) {
  const [modeloId, setModeloId] = useState<string>('')
  const [resultado, setResultado] = useState<ProvisionarResponse | null>(null)
  const provisionar = useProvisionarProduto()

  const modelosQuery = useQuery({
    queryKey: ['modelos'],
    queryFn: listModelos,
    enabled: open,
  })

  const modelosProvisionaveis = (modelosQuery.data ?? []).filter(
    (m) => m.prefixo && m.major_version && m.ativo !== false,
  )

  const modeloSelecionado = modelosProvisionaveis.find((m) => m.id === modeloId)

  function handleClose() {
    if (provisionar.isPending) return
    onOpenChange(false)
    setTimeout(() => {
      setModeloId('')
      setResultado(null)
      provisionar.reset()
    }, 200)
  }

  function handleGerar() {
    if (!modeloId) return
    provisionar.mutate(
      { modelo_id: modeloId },
      {
        onSuccess: (data) => {
          setResultado(data)
        },
      },
    )
  }

  function handleCopyJson() {
    if (!resultado) return
    navigator.clipboard
      .writeText(JSON.stringify(resultado, null, 2))
      .then(() => toast.success('JSON copiado.'))
      .catch(() => toast.error('Não foi possível copiar.'))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleClose())}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        {!resultado ? (
          <>
            <DialogHeader>
              <DialogTitle>Provisionar novo produto</DialogTitle>
              <DialogDescription>
                O sistema gera automaticamente o próximo serial sequencial para
                o modelo selecionado.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Modelo</label>
                {modelosQuery.isPending ? (
                  <Skeleton className="h-10 w-full" />
                ) : modelosProvisionaveis.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum modelo provisionável. Configure prefixo e
                    major_version num modelo antes de continuar.
                  </p>
                ) : (
                  <Select value={modeloId} onValueChange={setModeloId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um modelo" />
                    </SelectTrigger>
                    <SelectContent>
                      {modelosProvisionaveis.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <span className="flex items-baseline gap-2">
                            <span className="font-medium">{m.nome}</span>
                            <span className="text-xs text-muted-foreground font-mono">
                              {m.prefixo}-{m.major_version}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {modeloSelecionado && (
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                    Próximo serial
                  </p>
                  <p className="font-mono">
                    {modeloSelecionado.prefixo}-{modeloSelecionado.major_version}-
                    <span className="text-muted-foreground">
                      {String((modeloSelecionado.total_dispositivos ?? 0) + 1).padStart(5, '0')}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Estimativa; o valor final é calculado no backend via MAX(sequencial)+1.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={handleClose}>
                Cancelar
              </Button>
              <Button
                onClick={handleGerar}
                disabled={!modeloId || provisionar.isPending}
              >
                {provisionar.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Gerar
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Produto provisionado</DialogTitle>
              <DialogDescription>
                Serial <span className="font-mono font-semibold">{resultado.serial}</span>
                {' '}pronto pra flashar no firmware e etiquetar.
              </DialogDescription>
            </DialogHeader>

            <CredenciaisProduto
              serial={resultado.serial}
              modeloNome={resultado.modelo_nome}
              pairingCode={resultado.pairing_code}
              claimUrl={resultado.claim_url}
              mqtt={resultado.mqtt}
              showMqttPassword
            />

            <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button variant="outline" onClick={handleCopyJson}>
                Copiar tudo como JSON
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  openEtiquetaProduto({
                    serial: resultado.serial,
                    pairingCode: resultado.pairing_code,
                    claimUrl: resultado.claim_url,
                  })
                }
              >
                <Printer className="h-4 w-4 mr-2" />
                Imprimir etiqueta
              </Button>
              <Button onClick={handleClose}>Entendi, fechar</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
