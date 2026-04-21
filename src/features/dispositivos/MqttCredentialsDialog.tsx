import { AlertTriangle, Copy } from 'lucide-react'
import { toast } from 'sonner'

import type { MqttCredentials } from '@/api/dispositivos'
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
  credentials: MqttCredentials | null
  contexto?: 'criado' | 'regenerado'
}

function CopyRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
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
        <code
          className={`flex-1 rounded-md bg-muted px-3 py-2 text-sm break-all select-all ${
            mono ? 'font-mono' : ''
          }`}
          onClick={(e) => {
            const range = document.createRange()
            range.selectNodeContents(e.currentTarget)
            const sel = window.getSelection()
            if (sel) {
              sel.removeAllRanges()
              sel.addRange(range)
            }
          }}
        >
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

export function MqttCredentialsDialog({
  open,
  onOpenChange,
  credentials,
  contexto = 'criado',
}: Props) {
  if (!credentials) return null

  const titulo =
    contexto === 'regenerado'
      ? `Nova senha MQTT — ${credentials.username}`
      : `Credenciais MQTT — ${credentials.username}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>

        <Alert
          variant="default"
          className="border-yellow-500/50 bg-yellow-500/10 text-yellow-900 dark:text-yellow-200 [&>svg]:text-yellow-600"
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Guarde esta senha agora</AlertTitle>
          <AlertDescription>
            Esta senha só será mostrada agora. Guarde em local seguro — ela não
            pode ser recuperada depois. Você pode regenerar uma nova a qualquer
            momento.
          </AlertDescription>
        </Alert>

        <div className="space-y-3 pt-2">
          <CopyRow label="Broker" value={credentials.broker} mono />
          <CopyRow label="Usuário" value={credentials.username} mono />
          <CopyRow label="Senha" value={credentials.password} mono />
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
