import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Eye, Loader2, Sliders, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import {
  createShare,
  listShares,
  revokeShare,
  updateSharePermissao,
  type Compartilhamento,
  type CreateShareResponse,
} from '@/api/compartilhamentos'
import type { SharePermissao } from '@/api/dispositivos'
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { extractApiError } from '@/lib/api'

const schema = z.object({
  email: z.string().trim().min(1, 'Informe o e-mail').email('E-mail inválido'),
  permissao: z.enum(['leitura', 'controle']),
})

type FormValues = z.infer<typeof schema>

const permLabel: Record<SharePermissao, string> = {
  leitura: 'Visualizar',
  controle: 'Comandar',
}

const statusLabel: Record<Compartilhamento['status'], string> = {
  ativo: 'Ativo',
  pendente: 'Pendente',
  revogado: 'Revogado',
}

type Props = {
  dispositivoId: string
  dispositivoNome: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShareDialog({
  dispositivoId,
  dispositivoNome,
  open,
  onOpenChange,
}: Props) {
  const qc = useQueryClient()
  const [toRevoke, setToRevoke] = useState<Compartilhamento | null>(null)
  const [editing, setEditing] = useState<{
    shareId: string
    permissao: SharePermissao
  } | null>(null)

  const sharesQuery = useQuery({
    queryKey: ['shares', dispositivoId],
    queryFn: () => listShares(dispositivoId),
    enabled: open,
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', permissao: 'leitura' },
  })

  useEffect(() => {
    if (open) {
      form.reset({ email: '', permissao: 'leitura' })
    } else {
      setEditing(null)
    }
  }, [open, form])

  const createMutation = useMutation<CreateShareResponse, unknown, FormValues>({
    mutationFn: (v) =>
      createShare(dispositivoId, { email: v.email.trim().toLowerCase(), permissao: v.permissao }),
    onSuccess: (data, vars) => {
      if (!data.email_sent) {
        toast.warning(
          `Convite criado, mas falha ao enviar e-mail. Peça pra ${vars.email} acessar /convites.`,
        )
      } else if (data.compartilhamento.status === 'pendente') {
        toast.success(`Convite enviado pra ${vars.email}.`)
      } else {
        toast.success(`Acesso concedido a ${vars.email}.`)
      }
      form.reset({ email: '', permissao: 'leitura' })
      qc.invalidateQueries({ queryKey: ['shares', dispositivoId] })
    },
    onError: async (err) => {
      const raw = await extractApiError(err, 'Erro ao compartilhar')
      const msg =
        raw === 'ja compartilhado com esse email'
          ? 'Já compartilhado com esse e-mail.'
          : raw === 'nao pode compartilhar consigo mesmo'
            ? 'Você não pode compartilhar consigo mesmo.'
            : raw === 'email invalido'
              ? 'E-mail inválido.'
              : raw === 'apenas o dono pode compartilhar'
                ? 'Apenas o dono pode compartilhar este dispositivo.'
                : raw
      toast.error(msg)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (vars: { shareId: string; permissao: SharePermissao }) =>
      updateSharePermissao(dispositivoId, vars.shareId, vars.permissao),
    onSuccess: () => {
      toast.success('Permissão atualizada.')
      qc.invalidateQueries({ queryKey: ['shares', dispositivoId] })
      qc.invalidateQueries({ queryKey: ['dispositivos'] })
      setEditing(null)
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Erro ao atualizar permissão')
      toast.error(msg)
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (shareId: string) => revokeShare(dispositivoId, shareId),
    onSuccess: () => {
      toast.success('Compartilhamento revogado.')
      qc.invalidateQueries({ queryKey: ['shares', dispositivoId] })
      qc.invalidateQueries({ queryKey: ['dispositivos'] })
      setToRevoke(null)
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Erro ao revogar')
      toast.error(msg)
      setToRevoke(null)
    },
  })

  function onSubmit(v: FormValues) {
    createMutation.mutate(v)
  }

  const shares = sharesQuery.data ?? []
  const ativos = shares.filter((s) => s.status !== 'revogado')

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Compartilhar {dispositivoNome}</DialogTitle>
            <DialogDescription>
              Convide alguém por e-mail. Se a pessoa já tiver conta, o acesso é imediato;
              senão, ela recebe um link pra criar a conta e ativar o convite.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail do convidado</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="off"
                        placeholder="fulano@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="permissao"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Permissão</FormLabel>
                    <FormControl>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <PermCard
                          selected={field.value === 'leitura'}
                          onSelect={() => field.onChange('leitura')}
                          icon={<Eye className="h-4 w-4" />}
                          title="Só visualizar"
                          desc="Ver dashboard, status e gráficos"
                        />
                        <PermCard
                          selected={field.value === 'controle'}
                          onSelect={() => field.onChange('controle')}
                          icon={<Sliders className="h-4 w-4" />}
                          title="Visualizar e comandar"
                          desc="Acima + ajustar taxa e disparar burst"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4 mr-2" />
                  )}
                  Enviar convite
                </Button>
              </div>
            </form>
          </Form>

          <Separator />

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Pessoas com acesso</h3>
            {sharesQuery.isPending && (
              <div className="space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            )}
            {sharesQuery.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>Falha ao carregar compartilhamentos.</AlertDescription>
              </Alert>
            )}
            {sharesQuery.isSuccess && ativos.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Ninguém mais tem acesso ainda.
              </p>
            )}
            {sharesQuery.isSuccess &&
              ativos.map((s) => {
                const editable = s.status === 'ativo'
                const isEditing = editing?.shareId === s.id
                return (
                  <div key={s.id} className="space-y-2">
                    <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {s.email_convidado}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {editable ? (
                            <button
                              type="button"
                              onClick={() =>
                                setEditing(
                                  isEditing
                                    ? null
                                    : { shareId: s.id, permissao: s.permissao },
                                )
                              }
                              aria-label={`Editar permissão de ${s.email_convidado}`}
                              aria-expanded={isEditing}
                              className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Badge
                                variant="outline"
                                className="text-xs h-5 gap-1 px-1.5 cursor-pointer hover:bg-muted"
                              >
                                {s.permissao === 'controle' ? (
                                  <Sliders className="h-3 w-3" />
                                ) : (
                                  <Eye className="h-3 w-3" />
                                )}
                                {permLabel[s.permissao]}
                              </Badge>
                            </button>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-xs h-5 gap-1 px-1.5"
                            >
                              {s.permissao === 'controle' ? (
                                <Sliders className="h-3 w-3" />
                              ) : (
                                <Eye className="h-3 w-3" />
                              )}
                              {permLabel[s.permissao]}
                            </Badge>
                          )}
                          <Badge
                            variant={s.status === 'ativo' ? 'default' : 'secondary'}
                            className={`text-xs h-5 px-1.5 ${s.status === 'ativo' ? 'bg-emerald-600 hover:bg-emerald-600' : ''}`}
                          >
                            {statusLabel[s.status]}
                          </Badge>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setToRevoke(s)}
                        aria-label={`Revogar acesso de ${s.email_convidado}`}
                        disabled={revokeMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {isEditing && (
                      <div className="ml-3 rounded-md border bg-muted/30 p-3 space-y-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          Alterar permissão
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <PermCard
                            selected={editing.permissao === 'leitura'}
                            onSelect={() =>
                              setEditing({ ...editing, permissao: 'leitura' })
                            }
                            icon={<Eye className="h-4 w-4" />}
                            title="Só visualizar"
                            desc="Ver dashboard, status e gráficos"
                          />
                          <PermCard
                            selected={editing.permissao === 'controle'}
                            onSelect={() =>
                              setEditing({ ...editing, permissao: 'controle' })
                            }
                            icon={<Sliders className="h-4 w-4" />}
                            title="Visualizar e comandar"
                            desc="Acima + ajustar taxa e disparar burst"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(null)}
                            disabled={updateMutation.isPending}
                          >
                            Cancelar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              if (editing.permissao === s.permissao) {
                                setEditing(null)
                                return
                              }
                              updateMutation.mutate({
                                shareId: s.id,
                                permissao: editing.permissao,
                              })
                            }}
                            disabled={updateMutation.isPending}
                          >
                            {updateMutation.isPending && (
                              <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                            )}
                            Salvar
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={toRevoke !== null}
        onOpenChange={(o) => {
          if (!o && !revokeMutation.isPending) setToRevoke(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar compartilhamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {toRevoke ? (
                <>
                  <strong>{toRevoke.email_convidado}</strong> perderá o acesso imediatamente.
                </>
              ) : (
                'Esta ação é imediata.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={revokeMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (toRevoke) revokeMutation.mutate(toRevoke.id)
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revogar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function PermCard({
  selected,
  onSelect,
  icon,
  title,
  desc,
}: {
  selected: boolean
  onSelect: () => void
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected
          ? 'border-primary bg-primary/5'
          : 'border-input hover:border-muted-foreground/40'
      }`}
      aria-pressed={selected}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className={selected ? 'text-primary' : 'text-muted-foreground'}>{icon}</div>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-snug">{desc}</p>
    </button>
  )
}
