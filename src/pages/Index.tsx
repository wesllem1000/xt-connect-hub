import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Zap, Wifi, Shield, Gauge, ChevronRight, CheckCircle2 } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

const Index = () => {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate("/dashboard");
      }
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      {/* Theme Toggle - Top Right */}
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>
      
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="container mx-auto px-4 py-20 lg:py-32">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="animate-slide-up">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
                <Zap className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Automação Inteligente</span>
              </div>
              
              <h1 className="text-5xl lg:text-6xl font-bold mb-6 leading-tight">
                Controle Total da Sua{" "}
                <span className="bg-gradient-primary bg-clip-text text-transparent">
                  Casa Inteligente
                </span>
              </h1>
              
              <p className="text-xl text-muted-foreground mb-8 leading-relaxed">
                Plataforma completa para gerenciar, monitorar e configurar seus dispositivos 
                inteligentes e automações personalizadas.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  size="lg"
                  className="gradient-primary shadow-glow text-lg px-8"
                  onClick={() => navigate("/auth")}
                >
                  Começar Agora
                  <ChevronRight className="ml-2 h-5 w-5" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="text-lg px-8"
                  onClick={() => navigate("/auth")}
                >
                  Fazer Login
                </Button>
              </div>

              <div className="mt-12 flex items-center gap-8">
                <div>
                  <div className="text-3xl font-bold text-primary">100+</div>
                  <div className="text-sm text-muted-foreground">Dispositivos Compatíveis</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-secondary">24/7</div>
                  <div className="text-sm text-muted-foreground">Monitoramento</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-success">99.9%</div>
                  <div className="text-sm text-muted-foreground">Uptime</div>
                </div>
              </div>
            </div>

            <div className="relative lg:block hidden">
              <div className="relative animate-float">
                <div className="absolute inset-0 bg-gradient-primary opacity-20 blur-3xl rounded-full"></div>
                <div className="relative bg-card border border-border/50 rounded-2xl p-8 shadow-2xl">
                  <div className="space-y-6">
                    <div className="flex items-center gap-4 p-4 bg-success/10 rounded-lg border border-success/20">
                      <Wifi className="h-8 w-8 text-success" />
                      <div>
                        <div className="font-semibold">Todos Dispositivos Online</div>
                        <div className="text-sm text-muted-foreground">8 dispositivos conectados</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 p-4 bg-primary/10 rounded-lg border border-primary/20">
                      <Shield className="h-8 w-8 text-primary" />
                      <div>
                        <div className="font-semibold">Segurança Ativa</div>
                        <div className="text-sm text-muted-foreground">Sistema protegido</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 p-4 bg-secondary/10 rounded-lg border border-secondary/20">
                      <Gauge className="h-8 w-8 text-secondary" />
                      <div>
                        <div className="font-semibold">5 Automações Ativas</div>
                        <div className="text-sm text-muted-foreground">Funcionando perfeitamente</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-card/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">
              Por que escolher o{" "}
              <span className="bg-gradient-primary bg-clip-text text-transparent">
                XT CONECT
              </span>
              ?
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Tecnologia de ponta para transformar sua casa em um ambiente inteligente e eficiente
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: Zap,
                title: "Controle Centralizado",
                description: "Gerencie todos os seus dispositivos em uma única plataforma intuitiva"
              },
              {
                icon: Wifi,
                title: "Monitoramento em Tempo Real",
                description: "Acompanhe o status de todos os dispositivos instantaneamente"
              },
              {
                icon: Shield,
                title: "Segurança Avançada",
                description: "Criptografia de ponta a ponta para proteger seus dados"
              },
              {
                icon: Gauge,
                title: "Automações Personalizadas",
                description: "Crie regras e cenários personalizados para seu dia a dia"
              },
              {
                icon: CheckCircle2,
                title: "Fácil Instalação",
                description: "Configuração rápida e suporte completo para instaladores"
              },
              {
                icon: Zap,
                title: "Atualizações Constantes",
                description: "Novos recursos e melhorias continuamente adicionados"
              }
            ].map((feature, index) => (
              <div
                key={index}
                className="p-6 bg-card border border-border/50 rounded-xl hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
              >
                <div className="w-12 h-12 rounded-lg bg-gradient-primary flex items-center justify-center mb-4 shadow-glow">
                  <feature.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="bg-gradient-primary rounded-2xl p-12 text-center shadow-2xl">
            <h2 className="text-4xl font-bold text-white mb-4">
              Pronto para começar?
            </h2>
            <p className="text-xl text-white/90 mb-8 max-w-2xl mx-auto">
              Crie sua conta gratuitamente e descubra como é fácil automatizar sua casa
            </p>
            <Button
              size="lg"
              variant="secondary"
              className="text-lg px-8 bg-white hover:bg-white/90 text-primary"
              onClick={() => navigate("/auth")}
            >
              Criar Conta Grátis
              <ChevronRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border/50">
        <div className="container mx-auto px-4 text-center text-muted-foreground">
          <p>© 2025 XT AUTOMATIZE - Todos os direitos reservados</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;