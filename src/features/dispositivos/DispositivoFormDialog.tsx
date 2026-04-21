import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  createDispositivo,
  type CreateDispositivoInput,
  type Dispositivo,
  type MqttCredentials,
} from '@/api/dispositivos'
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { extractApiError } from '@/lib/api'

const NONE = '__none__'

const schema = z.object({
  nome: z.string().trim().min(3, 'Nome precisa ter ao menos 3 caracteres'),
  serial: z.string().trim().min(3, 'Serial precisa ter ao menos 3 caracteres'),
  modelo_id: z.string(),
  localizacao: z.string(),
})

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (credentials: MqttCredentials) => void
}

export function DispositivoFormDialog({
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const qc = useQueryClient()

  const modelos = useQuery({
    queryKey: ['modelos'],
    queryFn: listModelos,
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nome: '',
      serial: '',
      modelo_id: NONE,
      localizacao: '',
    },
  })

  useEffect(() => {
    if (open) form.reset({ nome: '', serial: '', modelo_id: NONE, localizacao: '' })
  }, [open, form])

  const mutation = useMutation<Dispositivo, unknown, CreateDispositivoInput>({
    mutationFn: createDispositivo,
    onSuccess: (data) => {
      toast.success('Dispositivo criado.')
      qc.invalidateQueries({ queryKey: ['dispositivos'] })
      onOpenChange(false)
      if (data.mqtt_credentials && onCreated) {
        onCreated(data.mqtt_credentials)
      }
    },
    onError: async (err) => {
      const msg = await extractApiError(err, 'Erro ao criar dispositivo')
      const translated =
        msg === 'serial ja cadastrado'
          ? 'Serial já cadastrado'
          : msg === 'modelo invalido'
            ? 'Modelo inválido'
            : msg
      form.setError('root', { message: translated })
      toast.error(translated)
    },
  })

  function onSubmit(values: FormValues) {
    mutation.mutate({
      nome: values.nome.trim(),
      serial: values.serial.trim(),
      modelo_id: values.modelo_id === NONE ? null : values.modelo_id,
      localizacao: values.localizacao.trim() || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar dispositivo</DialogTitle>
          <DialogDescription>
            Informe o nome e o serial do dispositivo. O modelo é opcional.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="nome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Estufa 01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="serial"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Serial</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex: esp32-estufa-001"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="modelo_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Modelo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um modelo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>Sem modelo</SelectItem>
                      {modelos.data?.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="localizacao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Localização (opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Casa de máquinas" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.formState.errors.root?.message && (
              <p className="text-sm font-medium text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
