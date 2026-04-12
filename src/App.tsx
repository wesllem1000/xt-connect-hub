import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { useThemeColors } from "@/hooks/useThemeColors";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminUsuarios from "./pages/admin/AdminUsuarios";
import AdminModelos from "./pages/admin/AdminModelos";
import AdminComunicacao from "./pages/admin/AdminComunicacao";
import AdminMqtt from "./pages/admin/AdminMqtt";
import AdminDashComponents from "./pages/admin/AdminDashComponents";
import AdminModeloDashboards from "./pages/admin/AdminModeloDashboards";
import AdminDocumentacao from "./pages/admin/AdminDocumentacao";
import AdminConfiguracoesGlobais from "./pages/admin/AdminConfiguracoesGlobais";
import DeviceNew from "./pages/devices/DeviceNew";
import DeviceDetail from "./pages/devices/DeviceDetail";
import DeviceSettings from "./pages/devices/DeviceSettings";

const queryClient = new QueryClient();

function ThemeLoader() {
  useThemeColors();
  return null;
}

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeLoader />
        <Toaster />
        <Sonner />
        <PWAInstallPrompt />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/usuarios" element={<AdminUsuarios />} />
            <Route path="/admin/modelos" element={<AdminModelos />} />
            <Route path="/admin/modelos/:modelId/dashboards" element={<AdminModeloDashboards />} />
            <Route path="/admin/dash-components" element={<AdminDashComponents />} />
            <Route path="/admin/comunicacao" element={<AdminComunicacao />} />
            <Route path="/admin/mqtt" element={<AdminMqtt />} />
            <Route path="/admin/documentacao" element={<AdminDocumentacao />} />
            <Route path="/admin/configuracoes" element={<AdminConfiguracoesGlobais />} />
            <Route path="/devices/new" element={<DeviceNew />} />
            <Route path="/devices/:deviceId" element={<DeviceDetail />} />
            <Route path="/devices/:deviceId/settings" element={<DeviceSettings />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
