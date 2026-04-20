import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function App() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-8">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>XT Conect Hub</CardTitle>
          <CardDescription>
            Scaffold v2 funcionando. React + TypeScript + Tailwind + shadcn/ui + Vite.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button>Botão primário</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="outline">Outline</Button>
          <p className="text-sm text-muted-foreground pt-4">
            Branch: xtconect-v2 — próximo passo: auth + roteamento
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default App
