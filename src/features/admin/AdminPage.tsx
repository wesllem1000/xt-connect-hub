import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ClientesList } from './clientes/ClientesList'
import { ModelosList } from './modelos/ModelosList'

export function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Admin</h2>
        <p className="text-muted-foreground text-sm">
          Gestão de modelos de dispositivo, clientes e catálogo de widgets.
        </p>
      </div>
      <Tabs defaultValue="clientes">
        <TabsList>
          <TabsTrigger value="clientes">Clientes</TabsTrigger>
          <TabsTrigger value="modelos">Modelos</TabsTrigger>
          <TabsTrigger value="widgets">Widgets</TabsTrigger>
        </TabsList>
        <TabsContent value="clientes" className="mt-4">
          <ClientesList />
        </TabsContent>
        <TabsContent value="modelos" className="mt-4">
          <ModelosList />
        </TabsContent>
        <TabsContent value="widgets" className="mt-4">
          <p className="text-sm text-muted-foreground">Gestão do catálogo de widgets — em breve.</p>
        </TabsContent>
      </Tabs>
    </div>
  )
}
