import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { createCliente, type CreateClienteResponse } from '@/api/admin'
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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { extractApiError } from '@/lib/api'

const schema = z
  .object({
    full_name: z.string().trim().min(2, 'Informe o nome do cliente'),
    email: z
      .string()
      .trim()
      .min(1, 'Informe o e-mail')
      .email('E-mail inválido'),
    senha_temporaria: z
      .string()
      .optional()
      .refine((v) => !v || v.length >= 8, 'Senha deve ter ao menos 8 caracteres'),
  })

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (response: CreateClienteResponse) => void
}

export function NovoClienteDialog({ open, onOpenChange, onCreated }: Props) {
  const qc = useQueryClient()
  const [apiError, setApiError] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: '', email: '', senha_temporaria: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      createCliente({
        email: values.email,
        full_name: values.full_name,
        senha_temporaria: values.senha_temporaria || undefined,
      }),
    onSuccess: (data) => {
      toast.success('Cliente criado.')
      qc.invalidateQueries({ queryKey: ['clientes'] })
      form.reset()
      onOpenChange(false)
      onCreated(data)
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Falha ao criar cliente.')
      setApiError(msg)
    },
  })

  function handleOpenChange(value: boolean) {
    if (!value && mutation.isPending) return
    if (!value) {
      form.reset()
      setApiError(null)
    }
    onOpenChange(value)
  }

  async function onSubmit(values: FormValues) {
    setApiError(null)
    await mutation.mutateAsync(values).catch(() => {
      /* error displayed via apiError */
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo cliente</DialogTitle>
          <DialogDescription>
            Cria uma conta de cliente já verificada. Se a senha for omitida, uma
            aleatória será gerada — ela só será mostrada uma vez.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input autoFocus placeholder="Nome completo" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="cliente@empresa.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="senha_temporaria"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Senha temporária (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder="Deixe em branco para gerar uma automática"
                      autoComplete="off"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Mínimo 8 caracteres. O cliente deverá trocar depois.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {apiError && (
              <p className="text-sm text-destructive">{apiError}</p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Criar cliente
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
