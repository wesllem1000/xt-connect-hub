import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate } from 'react-router-dom'
import ky, { HTTPError } from 'ky'
import { Loader2, MailCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'

const signupSchema = z
  .object({
    full_name: z.string().min(2, 'Informe seu nome completo'),
    email: z.string().min(1, 'Informe o email').email('Email inválido'),
    password: z.string().min(8, 'Senha deve ter ao menos 8 caracteres'),
    confirm: z.string().min(1, 'Confirme sua senha'),
    accept: z.literal(true, {
      errorMap: () => ({ message: 'Você precisa aceitar os termos.' }),
    }),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'As senhas não conferem.',
    path: ['confirm'],
  })

type SignupForm = z.infer<typeof signupSchema>

const SIGNUP_ERROR_PT: Record<string, string> = {
  'email ja cadastrado': 'Este e-mail já está cadastrado. Tente fazer login.',
  'email invalido': 'E-mail inválido.',
  'nome obrigatorio': 'Informe seu nome completo.',
  'senha deve ter ao menos 8 caracteres': 'Senha deve ter ao menos 8 caracteres.',
  'db not ready': 'Serviço temporariamente indisponível. Tente novamente em instantes.',
}

export function SignupPage() {
  const navigate = useNavigate()
  const [apiError, setApiError] = useState<string | null>(null)
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)

  const form = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      full_name: '',
      email: '',
      password: '',
      confirm: '',
      accept: false as unknown as true,
    },
  })

  async function onSubmit(values: SignupForm) {
    setApiError(null)
    try {
      await ky
        .post('/api/auth/signup', {
          json: {
            email: values.email,
            password: values.password,
            full_name: values.full_name,
          },
          timeout: 20000,
          retry: 0,
        })
        .json<{ message: string }>()
      setSubmittedEmail(values.email)
    } catch (err) {
      if (err instanceof HTTPError) {
        let raw = ''
        try {
          const body = (await err.response.clone().json()) as {
            error?: string
            message?: string
          }
          raw = (body.error || body.message || '').toLowerCase().trim()
        } catch {
          raw = ''
        }
        setApiError(SIGNUP_ERROR_PT[raw] ?? 'Falha ao criar conta. Tente novamente.')
      } else {
        setApiError('Falha de conexão com o servidor.')
      }
    }
  }

  const submitting = form.formState.isSubmitting

  if (submittedEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center mb-2">
              <MailCheck className="h-6 w-6 text-emerald-700" />
            </div>
            <CardTitle className="text-2xl">Verifique seu e-mail</CardTitle>
            <CardDescription>
              Enviamos um link de confirmação para <strong>{submittedEmail}</strong>.
              Clique no link para ativar sua conta.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              Não chegou? Cheque a caixa de spam. O link expira em 24 horas.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate('/login')}
            >
              Ir para o login
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl">Criar conta no XT Conect Hub</CardTitle>
          <CardDescription>
            Cadastre-se para gerenciar seus dispositivos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="full_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome completo</FormLabel>
                    <FormControl>
                      <Input autoFocus placeholder="João da Silva" {...field} />
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
                      <Input
                        type="email"
                        autoComplete="email"
                        placeholder="voce@empresa.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder="mínimo 8 caracteres"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirmar senha</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder="repita a senha"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accept"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start gap-2 space-y-0">
                    <FormControl>
                      <input
                        type="checkbox"
                        checked={field.value || false}
                        onChange={(e) => field.onChange(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="text-sm font-normal">
                        Aceito os termos de uso e a política de privacidade.
                      </FormLabel>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />

              {apiError && (
                <Alert variant="destructive">
                  <AlertDescription>{apiError}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar conta
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                Já tem conta?{' '}
                <Link to="/login" className="text-primary hover:underline">
                  Entrar
                </Link>
              </p>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
