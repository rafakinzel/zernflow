# Porta da Central TB

Rotas só para as rotinas do Claude na nuvem que operam a Central de conteúdo
do Instagram do Thiago. Elas preparam o flow de comentário→direct de cada post
com palavra-chave. **Nada que passa por aqui fica ativo**: o flow nasce como
rascunho, com o gatilho desligado, e só entra no ar quando a Rafa publica no
construtor.

O que a porta não faz, e não tem como fazer: ativar gatilho, publicar, editar
ou apagar flow existente, mexer em contatos, conversas ou envios. Isso está
travado no código (não existe rota nem parâmetro para isso) e num teste que lê
o próprio código: `lib/central-agent/central-agent.test.ts`.

Código: `app/api/v1/central/*` e `lib/central-agent/*`.

## Autenticação

Toda chamada leva a chave no cabeçalho:

```
Authorization: Bearer $CENTRAL_AGENT_KEY
```

(`x-central-agent-key: $CENTRAL_AGENT_KEY` também serve.) Sem a chave, com a
chave errada, ou se a variável não estiver configurada no servidor: `401`.
A comparação é em tempo constante e a chave nunca vai para o log.

Nos exemplos, `BASE=https://bot.thiagoborrelli.com`.

## 1. Quais palavras-chave já existem

```bash
curl -s "$BASE/api/v1/central/keywords" \
  -H "Authorization: Bearer $CENTRAL_AGENT_KEY"

# só uma palavra (ignora maiúscula e #)
curl -s "$BASE/api/v1/central/keywords?keyword=SS" \
  -H "Authorization: Bearer $CENTRAL_AGENT_KEY"
```

Resposta:

```json
{
  "keywords": [
    {
      "keyword": "FA",
      "type": "comment_keyword",
      "flowId": "…",
      "flowName": "Funil FA",
      "flowStatus": "published",
      "triggerActive": true,
      "live": true,
      "createdByCentral": false,
      "source": "trigger"
    }
  ]
}
```

- `type`: `comment_keyword` (comentário) ou `keyword` (DM).
- `live`: responde hoje (gatilho ativo **e** flow publicado).
- `source: "flow_node"`: a palavra está só no nó de um rascunho que nunca foi
  publicado (ainda sem linha em `triggers`). Conta como existente.

Lista vazia para uma palavra = pode criar.

## 2. Criar o flow de comentário→direct (desligado)

```bash
curl -s -X POST "$BASE/api/v1/central/flows" \
  -H "Authorization: Bearer $CENTRAL_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "keyword": "SS",
    "message": "Oi! Aqui está o guia que você pediu: {{link}}",
    "pdfUrl": "https://<projeto>.supabase.co/storage/v1/object/public/iscas/2026-11/1730000000000-guia-ss.pdf",
    "commentReplies": ["Te mandei no direct!", "Corre no direct que chegou lá"]
  }'
```

Campos:

| campo | obrigatório | o que é |
|---|---|---|
| `keyword` | sim | a palavra do comentário, com ou sem `#` |
| `message` | sim | texto do direct; `{{link}}` marca onde entra o link do PDF (sem isso, o link vai no fim) |
| `pdfUrl` | sim | link `https` do PDF (normalmente o `publicUrl` da rota 3) |
| `name` | não | nome do flow; padrão `Central TB · <palavra>` |
| `matchType` | não | `exact` (padrão), `contains` ou `startsWith` |
| `commentReplies` | não | respostas públicas embaixo do comentário, uma sorteada por vez |

Qualquer outro campo é ignorado (mandar `status` ou `is_active` não muda nada).

Resposta `201`:

```json
{
  "flowId": "…",
  "triggerId": "…",
  "name": "Central TB · SS",
  "keyword": "SS",
  "matchType": "exact",
  "dmText": "Oi! Aqui está o guia que você pediu: https://…",
  "status": "draft",
  "triggerActive": false
}
```

Erros: `400` (campo faltando, link não https, mensagem acima de 1000
caracteres com o link), `409` se a palavra já tem gatilho em qualquer flow,
com `existing` dizendo qual.

O que é criado: um flow `draft` com a descrição "Criado pela equipe da Central
TB, esperando a Rafa", e o mesmo desenho que o construtor faz à mão — um nó
gatilho `comment_keyword` ligado a um nó Send Message com uma bolha só. No
comentário, o motor manda essa bolha como resposta privada do Instagram, que
aceita uma mensagem de texto; por isso o link vai dentro do texto, e não num
botão.

Sobre `matchType`: o padrão é `exact` porque o comentário é comparado em
minúsculas, e `contains` com uma palavra curta como `SS` dispararia em "assim"
ou "isso". Com `exact`, "SS 🙏" não casa; a Rafa ajusta no construtor se quiser.

## 3. Subir o PDF

PDF até ~4 MB, direto:

```bash
curl -s -X POST "$BASE/api/v1/central/iscas" \
  -H "Authorization: Bearer $CENTRAL_AGENT_KEY" \
  -F "file=@guia-ss.pdf;type=application/pdf"
```

PDF maior (a Vercel não deixa passar corpo acima de ~4,5 MB): peça um endereço
de envio e mande o arquivo direto para o Storage.

```bash
curl -s -X POST "$BASE/api/v1/central/iscas" \
  -H "Authorization: Bearer $CENTRAL_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"fileName": "guia-ss.pdf"}'
# → { "path": "...", "uploadUrl": "https://…", "publicUrl": "https://…" }

curl -s -X PUT "<uploadUrl>" \
  -H "Content-Type: application/pdf" \
  --data-binary @guia-ss.pdf
```

Resposta `201` nos dois casos: `{ "path", "publicUrl" }` (mais `uploadUrl` no
segundo). O `publicUrl` é o que vai em `pdfUrl` na rota 2. Bucket `iscas`,
público, só PDF, até 50 MB. Cada envio ganha nome próprio; nada é
sobrescrito.

## 4. Estado de um flow criado pela porta

```bash
curl -s "$BASE/api/v1/central/flows/<flowId>" \
  -H "Authorization: Bearer $CENTRAL_AGENT_KEY"
```

```json
{
  "flowId": "…",
  "name": "Central TB · SS",
  "status": "draft",
  "state": "esperando_rafa",
  "live": false,
  "version": 1,
  "publishedAt": null,
  "updatedAt": "…",
  "keywords": ["SS"]
}
```

`state`:

- `esperando_rafa`: rascunho, ainda desligado.
- `ativo`: a Rafa publicou e o gatilho está ligado.
- `publicado_sem_gatilho_ativo`: publicado, mas o gatilho foi pausado.
- `arquivado`.

Só enxerga flows criados por esta porta (`flows.created_via =
'central_agent'`); qualquer outro id dá `404`.

## Como o flow entra no ar

Só pela Rafa: ela abre o flow no construtor, revisa e clica em Publicar. A
publicação reconstrói os gatilhos do flow a partir dos nós, já ativos, e muda
o status para `published`. O motor só dispara um comentário quando as duas
coisas valem (gatilho ativo e flow publicado, ver `lib/comment-processor.ts`),
então um rascunho com gatilho desligado está desligado duas vezes.

## Configuração no servidor

- `CENTRAL_AGENT_KEY`: a chave (mínimo 32 caracteres; com menos, a porta
  recusa tudo).
- `CENTRAL_AGENT_WORKSPACE_ID` (opcional): o workspace onde os flows são
  criados. Sem ele, usa o único workspace que existir; se houver mais de um,
  a porta recusa até a variável ser definida.
- Migração `supabase/migrations/00026_central_agent.sql`: coluna
  `flows.created_via` e bucket `iscas`.

Passo a passo para configurar: `docs/CENTRAL-PASSO-A-PASSO.md`.
