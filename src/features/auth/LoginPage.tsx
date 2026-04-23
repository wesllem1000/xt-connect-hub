import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import ky from 'ky'
import { Loader2 } from 'lucide-react'

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

import { useAuthStore, EmailNotVerifiedError } from '@/stores/auth'

const loginSchema = z.object({
  email: z.string().min(1, 'Informe o email').email('Email inválido'),
  password: z.string().min(1, 'Informe a senha'),
})

type LoginForm = z.infer<typeof loginSchema>

function safeNext(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}

const VERIFIED_BANNERS: Record<string, { variant: 'default' | 'destructive'; text: string }> = {
  true: { variant: 'default', text: 'E-mail confirmado! Faça login para continuar.' },
  expired: { variant: 'destructive', text: 'Este link expirou. Solicite um novo abaixo.' },
  used: { variant: 'destructive', text: 'Este link já foi usado. Faça login normalmente.' },
  notfound: { variant: 'destructive', text: 'Link inválido. Solicite um novo abaixo.' },
  invalid: { variant: 'destructive', text: 'Link inválido. Solicite um novo abaixo.' },
  error: { variant: 'destructive', text: 'Não conseguimos confirmar agora. Tente novamente em instantes.' },
}

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const login = useAuthStore((s) => s.login)

  const [apiError, setApiError] = useState<string | null>(null)
  const [needsVerify, setNeedsVerify] = useState<string | null>(null)
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const verifiedParam = params.get('verified')
  const banner = verifiedParam ? VERIFIED_BANNERS[verifiedParam] : null
  const nextPath = safeNext(params.get('next'))

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(values: LoginForm) {
    setApiError(null)
    setNeedsVerify(null)
    setResendStatus('idle')
    try {
      await login(values.email, values.password)
      navigate(nextPath ?? '/dispositivos', { replace: true })
    } catch (err) {
      if (err instanceof EmailNotVerifiedError) {
        setNeedsVerify(values.email)
      } else {
        setApiError(err instanceof Error ? err.message : 'Erro ao entrar. Tente novamente.')
      }
    }
  }

  async function handleResend() {
    const email = needsVerify || form.getValues('email')
    if (!email) return
    setResendStatus('sending')
    try {
      await ky
        .post('/api/auth/resend', {
          json: { email },
          timeout: 15000,
          retry: 0,
        })
        .json()
      setResendStatus('sent')
    } catch {
      setResendStatus('error')
    }
  }

  const submitting = form.formState.isSubmitting

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl">XT Conect Hub - Entrar</CardTitle>
          <CardDescription>
            Use seu email e senha para acessar o painel
          </CardDescription>
        </CardHeader>
        <CardContent>
          {banner && (
            <Alert
              variant={banner.variant}
              className={
                banner.variant === 'default'
                  ? 'mb-4 border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'mb-4'
              }
            >
              <AlertDescription>{banner.text}</AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        autoFocus
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
                        autoComplete="current-password"
                        placeholder="••••••••"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {apiError && (
                <Alert variant="destructive">
                  <AlertDescription>{apiError}</AlertDescription>
                </Alert>
              )}

              {needsVerify && (
                <Alert variant="destructive">
                  <AlertDescription className="space-y-2">
                    <p>
                      Confirme seu e-mail antes de entrar. Enviamos um link de
                      ativação para <strong>{needsVerify}</strong>.
                    </p>
                    {resendStatus === 'sent' ? (
                      <p className="text-sm">
                        ✓ Novo link enviado. Verifique sua caixa de entrada (e o spam).
                      </p>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleResend}
                        disabled={resendStatus === 'sending'}
                      >
                        {resendStatus === 'sending' && (
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        )}
                        Reenviar link de confirmação
                      </Button>
                    )}
                    {resendStatus === 'error' && (
                      <p className="text-sm">
                        Falha ao reenviar. Tente novamente em instantes.
                      </p>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Entrar
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                Ainda não tem conta?{' '}
                <Link to="/signup" className="text-primary hover:underline">
                  Cadastre-se
                </Link>
              </p>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
