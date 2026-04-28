import { AlertTriangle, HelpCircle, Loader2 } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

import type { ComandoVars } from '../hooks/useComando'
import type { ComandoSyncResponse } from '../api'

/** Action que pode vir no result_payload do ack — schema flexível pra
 *  o firmware crescer sem quebrar o frontend. */
export type DecisionAction = {
  label: string
  /** Patches/overrides nos params do reenvio. Merged com vars.params original. */
  params?: Record<string, unknown>
  variant?: 'default' | 'destructive' | 'secondary'
}

export type DecisionState = {
  kind: 'requires_decision' | 'requires_confirmation'
  response: ComandoSyncResponse
  vars: ComandoVars
}

/** Extrai actions do result_payload se existir, senão devolve fallback
 *  baseado no kind (force pra confirmação, confirmed pra decision). */
function extractActions(state: DecisionState): DecisionAction[] {
  const rp = state.response.result_payload as
    | { actions?: DecisionAction[] }
    | null
    | undefined
  if (rp && Array.isArray(rp.actions) && rp.actions.length > 0) {
    return rp.actions
  }
  if (state.kind === 'requires_confirmation') {
    return [
      {
        label: 'Confirmar e prosseguir',
        params: { force: true },
        variant: 'destructive',
      },
    ]
  }
  // requires_decision sem schema explícito — oferece "forçar" como única
  // opção segura sem inventar estratégias que o firmware pode não conhecer.
  return [
    {
      label: 'Forçar execução',
      params: { force: true },
      variant: 'destructive',
    },
  ]
}

type Props = {
  state: DecisionState | null
  pending: boolean
  onClose: () => void
  /** Chamado quando user clica em uma ação. params é o merge final
   *  (vars.params original + action.params). */
  onConfirm: (vars: ComandoVars) => void
}

export function ComandoDecisionDialog({
  state,
  pending,
  onClose,
  onConfirm,
}: Props) {
  const actions = state ? extractActions(state) : []
  const isDecision = state?.kind === 'requires_decision'

  const title = state?.response.ack_message
    ? state.response.ack_status === 'requires_decision'
      ? 'Decisão necessária'
      : 'Confirmação necessária'
    : 'Ação necessária'

  return (
    <AlertDialog
      open={state !== null}
      onOpenChange={(o) => {
        if (!o && !pending) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {isDecision ? (
              <HelpCircle className="h-5 w-5 text-amber-500" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            )}
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {state?.response.ack_message ??
                  'O dispositivo pediu sua confirmação antes de prosseguir.'}
              </p>
              <p className="text-xs text-muted-foreground">
                Comando: <code>{state?.vars.cmd}</code>
                {state?.response.ack_code && (
                  <>
                    {' '}· código: <code>{state.response.ack_code}</code>
                  </>
                )}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <AlertDialogCancel disabled={pending} onClick={onClose}>
            Cancelar
          </AlertDialogCancel>
          {actions.map((a, idx) => (
            <AlertDialogAction
              key={idx}
              disabled={pending}
              onClick={(e) => {
                e.preventDefault()
                if (!state) return
                const merged: ComandoVars = {
                  cmd: state.vars.cmd,
                  params: { ...(state.vars.params ?? {}), ...(a.params ?? {}) },
                }
                onConfirm(merged)
              }}
              className={cn(
                a.variant === 'destructive' &&
                  'bg-destructive text-destructive-foreground hover:bg-destructive/90',
                a.variant === 'secondary' &&
                  'bg-secondary text-secondary-foreground hover:bg-secondary/80',
              )}
            >
              {pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {a.label}
            </AlertDialogAction>
          ))}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
