import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Copy, RefreshCw, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface LogsTabProps {
  logs: string[];
  deviceId: string;
  isCommandPending: boolean;
  canClearLogs: boolean;
  onGetLogs: (limit?: number) => Promise<unknown>;
  onClearLogs: () => Promise<unknown>;
}

export default function LogsTab({ logs, deviceId, isCommandPending, canClearLogs, onGetLogs, onClearLogs }: LogsTabProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await onGetLogs(100); } catch { toast.error("Erro ao carregar logs"); } finally { setRefreshing(false); }
  };

  const handleCopy = () => {
    const header = `Logs - ${deviceId} - ${new Date().toLocaleString("pt-BR")}`;
    const text = `${header}\n${"=".repeat(50)}\n${logs.join("\n")}`;
    navigator.clipboard.writeText(text);
    toast.success("Logs copiados!");
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await onClearLogs();
      toast.success("Logs limpos");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Logs do Dispositivo
        </h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isCommandPending || refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopy} disabled={logs.length === 0}>
            <Copy className="h-4 w-4 mr-1" /> Copiar
          </Button>
          {canClearLogs && (
            <Button variant="destructive" size="sm" onClick={handleClear} disabled={isCommandPending || clearing}>
              {clearing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Limpar
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[400px]">
            {logs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Nenhum log disponível.</p>
                <p className="text-sm mt-1">Clique em "Atualizar" para solicitar os logs do dispositivo.</p>
              </div>
            ) : (
              <pre className="p-4 text-xs font-mono whitespace-pre-wrap text-foreground">
                {logs.join("\n")}
              </pre>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Device ID: {deviceId} • {logs.length} {logs.length === 1 ? "linha" : "linhas"}
      </p>
    </div>
  );
}
