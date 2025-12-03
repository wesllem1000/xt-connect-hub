import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Settings, Clock, Save } from "lucide-react";

interface ConfigForm {
  status_timeout_minutes: number;
}

export default function AdminConfiguracoesGlobais() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<ConfigForm>({
    defaultValues: {
      status_timeout_minutes: 10,
    },
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("system_config")
      .select("chave, valor");

    if (error) {
      console.error("Erro ao carregar configurações:", error);
      toast.error("Erro ao carregar configurações");
    } else if (data) {
      data.forEach((item) => {
        if (item.chave === "status_timeout_minutes") {
          setValue("status_timeout_minutes", parseInt(item.valor, 10) || 10);
        }
      });
    }
    setLoading(false);
  };

  const onSubmit = async (formData: ConfigForm) => {
    setSaving(true);

    const { error } = await supabase
      .from("system_config")
      .update({ valor: formData.status_timeout_minutes.toString() })
      .eq("chave", "status_timeout_minutes");

    if (error) {
      console.error("Erro ao salvar configuração:", error);
      toast.error("Erro ao salvar configuração");
    } else {
      toast.success("Configurações salvas com sucesso!");
    }

    setSaving(false);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-primary flex items-center justify-center">
            <Settings className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Configurações Globais</h1>
            <p className="text-muted-foreground">
              Configurações que valem para todos os dispositivos do sistema
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Status de Dispositivos
                </CardTitle>
                <CardDescription>
                  Configure o tempo de verificação para determinar se um dispositivo está online ou offline
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="status_timeout_minutes">
                    Tempo de verificação de status (minutos)
                  </Label>
                  <div className="flex items-center gap-2 max-w-xs">
                    <Input
                      id="status_timeout_minutes"
                      type="number"
                      min={1}
                      max={1440}
                      {...register("status_timeout_minutes", {
                        required: "Este campo é obrigatório",
                        min: { value: 1, message: "Mínimo de 1 minuto" },
                        max: { value: 1440, message: "Máximo de 1440 minutos (24 horas)" },
                        valueAsNumber: true,
                      })}
                    />
                    <span className="text-sm text-muted-foreground">minutos</span>
                  </div>
                  {errors.status_timeout_minutes && (
                    <p className="text-sm text-destructive">{errors.status_timeout_minutes.message}</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    Se um dispositivo não enviar dados dentro deste período, será considerado offline.
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Salvar Configurações
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </AdminLayout>
  );
}
