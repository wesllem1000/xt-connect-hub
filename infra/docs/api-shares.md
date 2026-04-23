# API — Compartilhamento de dispositivos (E2.4 · #43)

Contrato dos endpoints introduzidos em E2.4 — backend Node-RED, base URL
`https://hub.xtconect.online/api`. Todos exigem `Authorization: Bearer <jwt>`
(emitido por `POST /api/auth/login`).

Naming: paths em português pra match com `/dispositivos`, `/modelos-dispositivo`,
`/admin/clientes`. Permissões usam o enum `permissao_compartilhamento`:

| API value  | Significado                                   |
|------------|-----------------------------------------------|
| `leitura`  | viewer — vê dashboard/gráficos                |
| `controle` | operator — leitura + comandos (set_rate etc) |

Sinônimos `viewer`/`operator` são aceitos no body do POST de criação.

---

## 1) `GET /api/dispositivos` (atualizado)

Agora retorna **dispositivos próprios + compartilhamentos ativos**. Cada item
ganha 3 campos novos: `access_type`, `permissao`, `share_id`.

```json
[
  {
    "id": "3307b688-…", "nome": "Dispositivo Teste E024",
    "serial": "e024-test-001", "modelo": null,
    "ultimo_valor": null, "criado_em": "2026-04-22T01:51:08.814Z",
    "online": false, "last_seen_at": null,
    "telemetry_interval_s": 30, "burst_rate_s": 2,
    "access_type": "owner",  "permissao": "controle", "share_id": null
  },
  {
    "id": "…", "nome": "Caixa do vizinho",
    "serial": "vizinho-001", "…": "…",
    "access_type": "shared", "permissao": "leitura",
    "share_id": "7a5773e4-…"
  }
]
```

Comportamento:
- Owner: `access_type=owner`, `permissao=controle` (sempre), `share_id=null`.
- Compartilhado: `access_type=shared`, `permissao` = a do share, `share_id` preenchido.
- Admin: vê todos os devices como `owner`.

Frontend deve usar `permissao` pra renderizar/esconder controles de comando.

---

## 2) `POST /api/dispositivos/:id/compartilhamentos`

Cria um compartilhamento. **Owner-only** (admin também passa).

**Body:**
```json
{ "email": "fulano@example.com", "permissao": "leitura" }
```
Aliases aceitos: `permission` em vez de `permissao`; `viewer`/`operator` em vez
de `leitura`/`controle`.

**201:**
```json
{
  "compartilhamento": {
    "id": "uuid", "dispositivo_id": "uuid",
    "com_usuario_id": "uuid|null", "permissao": "leitura",
    "email_convidado": "fulano@example.com",
    "status": "ativo|pendente",
    "token_convite": null,
    "criado_em": "...", "aceito_em": "...|null"
  }
}
```

Lógica de status:
- Email já tem conta → `status=ativo`, `com_usuario_id` preenchido,
  `token_convite=null`, `aceito_em=NOW()`.
- Email não existe → `status=pendente`, `com_usuario_id=null`,
  `token_convite=<base64url 32B>` (frontend usa em `/convites/aceitar?token=...`).

**Erros:**
| status | quando                                                            |
|--------|-------------------------------------------------------------------|
| 400    | id inválido / email inválido / permissão inválida / share consigo mesmo |
| 403    | usuário logado não é dono do device                               |
| 404    | dispositivo não encontrado                                        |
| 409    | já existe share não-revogado pra esse `(device, email)`           |

> Re-convite após revogação **funciona** (índice é parcial em `status<>'revogado'`).

---

## 3) `GET /api/dispositivos/:id/compartilhamentos`

Lista todos os compartilhamentos do device (incluindo `revogado`, pra histórico).
**Owner-only** (admin também).

**200:**
```json
{
  "compartilhamentos": [
    {
      "id": "uuid", "email_convidado": "fulano@example.com",
      "permissao": "leitura", "status": "ativo|pendente|revogado",
      "criado_em": "...", "aceito_em": "...|null", "revogado_em": "...|null",
      "user_id": "uuid|null", "user_nome": "Fulano de Tal|null"
    }
  ]
}
```

`user_id`/`user_nome` ficam `null` enquanto o convite estiver pendente.

---

## 4) `DELETE /api/dispositivos/:id/compartilhamentos/:shareId`

Revoga um compartilhamento. **Owner-only** (admin também). Não deleta —
faz UPDATE pra `status='revogado'`, `revogado_em=NOW()`, `token_convite=NULL`
(invalida link de email se ainda pendente).

**200:** `{ "ok": true, "id": "uuid-do-share" }`

| status | quando |
|--------|--------|
| 400    | id inválido |
| 403    | não é dono |
| 404    | device ou share não encontrado / já revogado |

---

## 5) `GET /api/compartilhamentos/inbox`

Inbox do usuário logado. Lista convites pendentes pra seu email + shares ativos.

**200:**
```json
{
  "pendentes": [
    {
      "id": "uuid", "token": "<base64url>",
      "permissao": "leitura", "email_convidado": "...",
      "criado_em": "...",
      "dispositivo_id": "uuid", "dispositivo_nome": "...", "serial": "...",
      "dono_email": "...", "dono_nome": "..."
    }
  ],
  "ativos": [
    {
      "id": "uuid", "permissao": "controle",
      "aceito_em": "...", "criado_em": "...",
      "dispositivo_id": "uuid", "dispositivo_nome": "...", "serial": "...",
      "dono_email": "...", "dono_nome": "..."
    }
  ]
}
```

Pendentes batem por `email_convidado = msg.user.email`. Ativos batem por
`com_usuario_id = msg.user.id`.

> O `token` aparece nos pendentes — usado pra rota de aceite. Para shares ativos
> ele já foi limpo, então não está no payload.

---

## 6) `POST /api/compartilhamentos/aceitar`

Aceita um convite pendente via token (link de email).

**Body:** `{ "token": "<base64url>" }`

**200:**
```json
{
  "compartilhamento": {
    "id": "uuid", "dispositivo_id": "uuid", "com_usuario_id": "uuid",
    "permissao": "leitura", "email_convidado": "...",
    "status": "ativo", "criado_em": "...", "aceito_em": "..."
  },
  "dispositivo": { "id": "uuid", "nome": "...", "serial": "..." }
}
```

| status | quando |
|--------|--------|
| 400    | body sem token |
| 403    | token existe, mas `email_convidado` ≠ email do usuário logado |
| 404    | token inexistente, expirado (re-convite limpa o anterior), ou já usado |

---

## 7) `POST /api/dispositivos/:id/rate` (gate atualizado)

Permanece com o contrato existente (ver `_e23_inject_flows.js`). Mudou apenas
o gate de autorização:

| User                                    | Resultado |
|-----------------------------------------|-----------|
| owner                                   | 200       |
| admin                                   | 200 (bypass) |
| share ativo `permissao=controle`        | 200       |
| share ativo `permissao=leitura`         | **403** `{"error":"sem permissao para comandar (acesso somente leitura)"}` |
| sem nenhuma relação                     | 404       |

---

## 8) `POST /api/auth/signup` (efeito colateral novo)

Mesmo contrato. Adicionalmente: depois do `INSERT INTO app_users`, roda
```sql
UPDATE dispositivo_compartilhado
   SET status='ativo', com_usuario_id=$novo_user_id,
       aceito_em=NOW(), token_convite=NULL
 WHERE email_convidado=$email AND status='pendente'
```
…ativando todos os convites pendentes pra esse email. O log do Node-RED
imprime quantos foram ativados (`signup: N compartilhamento(s) ativado(s) pra ...`).

---

## Validação executada (22 cenários)

Roda em prod, todos passaram. Reproduzível com `bash /tmp/e024_test.sh`
(script fica fora do repo). Resumo:

| #  | Cenário | Esperado | Got |
|----|---------|----------|-----|
| 1  | GET /dispositivos como owner | array com `access_type=owner`, `permissao=controle` | ✅ |
| 2  | POST share `leitura` para invitee existente | 201 `status=ativo`, sem token | ✅ |
| 3  | GET shares list (owner) | 200 com 1 share | ✅ |
| 4  | GET /dispositivos como invitee viewer | array com `access_type=shared, permissao=leitura` | ✅ |
| 5  | POST /rate como viewer | **403** sem permissão | ✅ |
| 6  | POST share duplicado | **409** | ✅ |
| 7  | POST share consigo mesmo | **400** | ✅ |
| 9  | DELETE share (revoke) | 200 `{ok,id}` | ✅ |
| 10 | GET /dispositivos invitee depois revoke | `[]` | ✅ |
| 11 | POST share `controle` (re-invite após revoke) | 201 `status=ativo` | ✅ |
| 12 | POST /rate como operator | 200 (`set_rate` publicado no MQTT) | ✅ |
| 13 | GET inbox (invitee operator) | 1 ativo, 0 pendente | ✅ |
| 14 | POST share email **sem conta** | 201 `status=pendente` + `token_convite` | ✅ |
| 15 | DB tem `token_convite` | string base64url 43 chars | ✅ |
| 16 | POST /auth/signup do email pendente | 201 (signup ok) | ✅ |
| 17 | DB: share virou `ativo`, linked, token=null | ✅ | ✅ |
| 18 | GET shares como invitee não-dono | **403** | ✅ |
| 19 | POST /aceitar token inválido | **404** | ✅ |
| 20 | POST /aceitar token p/ outro email | **403** | ✅ |
| 21 | POST /aceitar happy path (token correto) | 200, share ativo | ✅ |
| 22 | inbox depois aceite | share aparece em `ativos` | ✅ |

---

## Dados de teste deixados no DB

Pra próxima sessão (frontend) usar diretamente, sem precisar recriar:

```
device:  e024-test-001  (uuid 3307b688-c0c7-440b-87be-e1a79a3154ee)
         owner: e024-owner@xtconect.test (cliente, senha=TestE024!)

users:   e024-owner@xtconect.test       (dono do device)
         e024-invitee@xtconect.test     (operator share ativo)
         e024-pendente@xtconect.test    (linked via signup)
         e024-someone-else@xtconect.test (aceitou via /aceitar)

senha de todos os e024-*: TestE024!  (já com email_verified=true)
```

### Cleanup

Quando quiser limpar tudo:
```sql
-- Shares CASCADE pelo FK; basta dropar o device + users
DELETE FROM devices WHERE device_id = 'e024-test-001';
DELETE FROM app_users WHERE email LIKE 'e024-%@xtconect.test';
```
