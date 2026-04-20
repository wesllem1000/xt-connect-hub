import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ModelosList } from './modelos/ModelosList'

export function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Admin</h2>
        <p className="text-muted-foreground text-sm">
          Gestão de modelos de dispositivo, usuários e catálogo de widgets.
        </p>
      </div>
      <Tabs defaultValue="modelos">
        <TabsList>
          <TabsTrigger value="modelos">Modelos</TabsTrigger>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="widgets">Widgets</TabsTrigger>
        </TabsList>
        <TabsContent value="modelos" className="mt-4">
          <ModelosList />
        </TabsContent>
        <TabsContent value="usuarios" className="mt-4">
          <p className="text-sm text-muted-foreground">Gestão de usuários — em breve.</p>
        </TabsContent>
        <TabsContent value="widgets" className="mt-4">
          <p className="text-sm text-muted-foreground">Gestão do catálogo de widgets — em breve.</p>
        </TabsContent>
      </Tabs>
    </div>
  )
}
