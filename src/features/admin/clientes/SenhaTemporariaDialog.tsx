import { AlertTriangle, Copy } from 'lucide-react'
import { toast } from 'sonner'

import type { CreateClienteResponse } from '@/api/admin'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  response: CreateClienteResponse | null
}

function CopyRow({ label, value }: { label: string; value: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Copiado!', { duration: 2000 })
    } catch {
      toast.error('Não foi possível copiar')
    }
  }
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm break-all select-all font-mono">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={copy}
          aria-label={`Copiar ${label.toLowerCase()}`}
          className="shrink-0"
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export function SenhaTemporariaDialog({ open, onOpenChange, response }: Props) {
  if (!response) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cliente criado — senha temporária</DialogTitle>
        </DialogHeader>

        <Alert className="border-yellow-500/50 bg-yellow-500/10 text-yellow-900 dark:text-yellow-200 [&>svg]:text-yellow-600">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Anote agora</AlertTitle>
          <AlertDescription>
            {response.senha_gerada
              ? 'Senha gerada automaticamente. Ela só será mostrada agora.'
              : 'Confirmação da senha definida — anote para o cliente.'}
          </AlertDescription>
        </Alert>

        <div className="space-y-3 pt-2">
          <CopyRow label="E-mail" value={response.user.email} />
          <CopyRow label="Senha temporária" value={response.senha_temporaria} />
        </div>

        <DialogFooter>
          <Button
            type="button"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Entendi, fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
