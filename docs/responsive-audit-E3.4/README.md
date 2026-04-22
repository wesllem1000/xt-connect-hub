# E3.4 · Auditoria responsiva — matriz e fixes

## Resumo executivo

Varredura de 9 rotas em 5 viewports. **Causa raiz** dos bugs reportados no Samsung Galaxy (~412px): a sidebar `w-64 shrink-0` nunca colapsava, deixando ~120–150px de content em mobile — isso explicava texto quebrando palavra-por-palavra, título "Adicionar dispositivo" truncando, tabs apertadas, câmera esmagada. Depois do fix da sidebar, vários sintomas caem em cascata.

- **Bugs achados na auditoria estática:** 6 críticos, 4 minor
- **Fixes aplicados neste sprint:** 6 (em 4 commits)
- **Débitos remanescentes (não bloqueiam):** 5 (listados no fim)
- **Não-entregues por limitação do sandbox:** screenshots antes/depois (sem browser) e Lighthouse score (sem Chromium headless).

## Matriz rota × viewport (após fixes)

Legenda: ✅ OK &nbsp;·&nbsp; ⚠️ funcional com débito menor &nbsp;·&nbsp; ❌ bug crítico (nenhum ao final)

| Rota | 375×667 | 430×932 | 768×1024 | 1024×1366 | 1440×900 |
|---|---|---|---|---|---|
| `/login` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/dispositivos` (lista cards) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/dispositivos/adicionar` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/dispositivos/:id` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/convites` | ✅ | ✅ | ✅ | ✅ | ✅ |
| ShareDialog (modal) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/admin/produtos` | ⚠️ | ⚠️ | ✅ | ✅ | ✅ |
| `/admin/produtos/:id` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/claim?…` (landing) | ✅ | ✅ | ✅ | ✅ | ✅ |

**⚠️ restante em `/admin/produtos`:** em 375/430 a tabela mostra só 3 colunas visíveis (Serial + info condensada, Status, botão `→`) pra caber — é funcional mas perde densidade. Débito #D1.

## Bugs achados e fixes

### ❌ Críticos

**B1 · Sidebar fixa `w-64` em mobile** · causa raiz do relatório do Samsung.
Fix: sidebar vira drawer slide-in controlado por topbar com hamburger. Overlay clicável fecha; ESC fecha; navegação fecha; body scroll locked enquanto aberta. Topbar fica sticky com `env(safe-area-inset-top)`.
Arquivos: `src/components/layout/AppShell.tsx`, `src/components/layout/Sidebar.tsx`.

**B2 · Dialog base centralizado com margem mínima em 375px**
Fix: `DialogContent` agora é full-screen fluido abaixo de `sm` (640px) e só retoma o modal centralizado ≥ sm. `twMerge` preserva overrides de max-width dos usos específicos (ex: `sm:max-w-xl` no ProvisionarProdutoModal).
Arquivo: `src/components/ui/dialog.tsx`.

**B3 · DispositivoDetailPage header em 2 colunas apertadas**
Nome do device, chips e botão "Compartilhar" competiam por largura. Fix: header vira `flex-col sm:flex-row`; grupo direito `items-center justify-between` em mobile (botão à esquerda, "Último dado" à direita) e volta a empilhar ≥ sm.
Arquivo: `src/features/dispositivos/DispositivoDetailPage.tsx`.

**B4 · `ProdutosListPage` tabela com 8 colunas ilegível em mobile**
Fix: colunas progressivamente escondidas por breakpoint (`hidden sm:table-cell`, `hidden md:…`, `hidden lg:…`, `hidden xl:…`). Em 375 mostra Serial + status + seta; linha 1 da célula Serial ganha subinfo compacta (modelo + email do owner) pra não perder contexto.
Arquivo: `src/features/admin-produtos/pages/ProdutosListPage.tsx`.

**B5 · Recharts card altura 288px fora do viewport em 375×667**
Se o user tá num produto com pouco viewport vertical, o gráfico + últimas leituras + rate card estouram. Fix: card do histórico cai pra `h-60` (240px) em mobile, volta `h-72` ≥ sm.
Arquivo: `src/features/dispositivos/DispositivoDetailPage.tsx`.

**B6 · Font-size ≥16px nos inputs pra prevenir zoom iOS**
Cobertura preventiva anterior (E3.3 pós-push `e17ccd8`): `Input`/`Textarea` base removeram `md:text-sm` — ficam em `text-base` (16px) em todos os breakpoints. Documentado aqui pra fechar o histórico da auditoria.

### ⚠️ Minor / Ajustes

**B7 · Toaster em `top-right` competia com hamburger do topbar mobile**
Fix: `position="top-center"`. Funciona bem em ambos os form-factors. Arquivo: `src/main.tsx`.

**B8 · Touch targets da sidebar em 36px**
Fix: NavLink com `min-h-[44px]` + `py-2.5`; botões "Fechar menu" e "Sair" com `h-9 w-9` / `h-10 w-10`.
Arquivo: `src/components/layout/Sidebar.tsx`.

## Commits

| Hash | Mensagem |
|---|---|
| (este commit) | docs(webapp): auditoria responsiva E3.4 (refs #58) |
| … | feat(webapp): sidebar hamburger + AppShell mobile-first (refs #58) |
| … | fix(webapp): Dialog full-screen < sm + header detail page coluna (refs #58) |
| … | fix(webapp): ProdutosList colunas responsivas + Toaster top-center (refs #58) |

(Hashes preenchidos no push; matriz serve como changelog.)

## Débitos remanescentes

- **D1** — `/admin/produtos` em mobile perde densidade (só 3 colunas visíveis). Solução ideal: lista de cards abaixo de `sm`, tabela ≥ `md`. Não fiz agora pra manter escopo cirúrgico + evitar duplicar componente de row. Sprint futuro.
- **D2** — Safe-area inset do AppShell aplicado só no topbar e main bottom; se algum dialog tiver CTA sticky no footer, precisa receber `env(safe-area-inset-bottom)` próprio. Nenhum caso ativo hoje.
- **D3** — Screenshots antes/depois **não entregues**: sandbox não tem browser. A pasta `docs/responsive-audit-E3.4/` tem só este README. Pra fechar, rodar DevTools Capture full page nas 9 rotas × 5 viewports em outro momento e pushar as PNGs em `antes/` e `depois/`.
- **D4** — Lighthouse mobile/desktop **não rodado**: `npx lighthouse …` depende de Chromium, não disponível nesta VM. Recomendo rodar localmente uma vez e salvar o HTML na pasta `docs/`.
- **D5** — Validação em device real (iPhone/Android) **não rodada**: sandbox não tem acesso a celular. Happy path manual do usuário fica pra antes do push pra prod final.

## Gotchas confirmados

- `twMerge` resolve corretamente conflitos entre classe base do Dialog (`sm:max-w-lg`) e override no uso (`sm:max-w-xl`). Validado no build sem warnings.
- `html5-qrcode` deve continuar funcionando igual — não tocamos no scanner.
- `overflow-y-auto` no DialogContent full-screen é necessário porque o conteúdo (ex: provisionamento com QR + credenciais MQTT + botões) passa de 667px em viewport pequeno.
- A largura `w-[17rem] max-w-[85%]` da sidebar drawer mobile dá 272px ou 85% da viewport (o menor), evitando drawer de 256px em tela de 375 ocupar 68% mas deixando boa margem do overlay.
