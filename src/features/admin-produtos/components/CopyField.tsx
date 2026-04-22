import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Props = {
  label?: string
  value: string
  /** Texto exibido; se omitido, usa `value`. */
  display?: string
  /** Classe extra pra fonte do valor exibido. */
  valueClassName?: string
  /** Nada de label acima; só o campo inline. */
  inline?: boolean
}

export function CopyField({ label, value, display, valueClassName, inline }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Não foi possível copiar.')
    }
  }

  const field = (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
      <span
        className={cn(
          'flex-1 min-w-0 truncate text-sm',
          valueClassName,
        )}
      >
        {display ?? value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={handleCopy}
        aria-label={`Copiar ${label ?? 'valor'}`}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  )

  if (inline || !label) return field
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {field}
    </div>
  )
}
