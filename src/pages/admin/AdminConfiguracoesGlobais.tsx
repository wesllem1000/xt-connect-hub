import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Settings, Clock, Save, Palette, RotateCcw } from "lucide-react";
import { applyColorPreview, hexToHsl, hslToHex, deriveThemeColors } from "@/hooks/useThemeColors";

interface ConfigForm {
  status_timeout_minutes: number;
}

const DEFAULT_PRIMARY_HEX = "#1a9e6e"; // hsl(156 72% 40%)

export default function AdminConfiguracoesGlobais() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingColor, setSavingColor] = useState(false);
  const [selectedColor, setSelectedColor] = useState(DEFAULT_PRIMARY_HEX);
  const [savedColor, setSavedColor] = useState(DEFAULT_PRIMARY_HEX);
  const colorInputRef = useRef<HTMLInputElement>(null);

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
        if (item.chave === "theme_primary_color") {
          setSelectedColor(item.valor);
          setSavedColor(item.valor);
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

  const handleColorChange = (hex: string) => {
    setSelectedColor(hex);
    applyColorPreview(hex);
  };

  const handleSaveColor = async () => {
    setSavingColor(true);

    // Upsert the color into system_config
    const { data: existing } = await supabase
      .from("system_config")
      .select("id")
      .eq("chave", "theme_primary_color")
      .maybeSingle();

    let error;
    if (existing) {
      ({ error } = await supabase
        .from("system_config")
        .update({ valor: selectedColor })
        .eq("chave", "theme_primary_color"));
    } else {
      ({ error } = await supabase
        .from("system_config")
        .insert({
          chave: "theme_primary_color",
          valor: selectedColor,
          descricao: "Cor primária do tema da plataforma",
        }));
    }

    if (error) {
      console.error("Erro ao salvar cor:", error);
      toast.error("Erro ao salvar cor do tema");
    } else {
      setSavedColor(selectedColor);
      toast.success("Cor do tema salva com sucesso!");
    }

    setSavingColor(false);
  };

  const handleResetColor = () => {
    setSelectedColor(DEFAULT_PRIMARY_HEX);
    applyColorPreview(DEFAULT_PRIMARY_HEX);
  };

  const { h, s, l } = hexToHsl(selectedColor);
  const derived = deriveThemeColors(h, s, l);
  const hasColorChanged = selectedColor !== savedColor;

  // Generate preview swatches from derived colors
  const swatches = [
    { label: "Primary", value: derived["--primary"] },
    { label: "Glow", value: derived["--primary-glow"] },
    { label: "Dark", value: derived["--primary-dark"] },
    { label: "Chart 2", value: derived["--chart-2"] },
    { label: "Chart 3", value: derived["--chart-3"] },
    { label: "Chart 4", value: derived["--chart-4"] },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-primary flex items-center justify-center">
            <Settings className="w-5 h-5 text-primary-foreground" />
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
          <div className="space-y-6">
            {/* Theme Color Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="w-5 h-5" />
                  Cor do Tema
                </CardTitle>
                <CardDescription>
                  Escolha a cor primária da plataforma. Todas as cores derivadas serão ajustadas automaticamente.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-wrap items-start gap-6">
                  {/* Color Picker */}
                  <div className="flex flex-col items-center gap-3">
                    <button
                      type="button"
                      onClick={() => colorInputRef.current?.click()}
                      className="w-24 h-24 rounded-full border-4 border-border shadow-lg cursor-pointer transition-transform hover:scale-105 active:scale-95"
                      style={{ backgroundColor: selectedColor }}
                      title="Clique para escolher a cor"
                    />
                    <input
                      ref={colorInputRef}
                      type="color"
                      value={selectedColor}
                      onChange={(e) => handleColorChange(e.target.value)}
                      className="sr-only"
                    />
                    <span className="text-xs font-mono text-muted-foreground uppercase">
                      {selectedColor}
                    </span>
                  </div>

                  {/* Derived Colors Preview */}
                  <div className="flex-1 min-w-[200px]">
                    <Label className="text-sm font-medium mb-3 block">Cores derivadas</Label>
                    <div className="flex flex-wrap gap-3">
                      {swatches.map((swatch) => (
                        <div key={swatch.label} className="flex flex-col items-center gap-1">
                          <div
                            className="w-12 h-12 rounded-lg border border-border shadow-sm"
                            style={{ backgroundColor: `hsl(${swatch.value})` }}
                          />
                          <span className="text-[10px] text-muted-foreground">{swatch.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* HSL info */}
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>H: {h}°</span>
                  <span>S: {s}%</span>
                  <span>L: {l}%</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleSaveColor}
                    disabled={savingColor || !hasColorChanged}
                  >
                    {savingColor ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Salvar Cor
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleResetColor}
                    type="button"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Restaurar Padrão
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Status Timeout Card */}
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
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
