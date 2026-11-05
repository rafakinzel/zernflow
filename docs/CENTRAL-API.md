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

Toda chamada precisa chegar com o cabeçalho
`Authorization: Bearer <chave>`. Sem a chave, com a chave errada, ou se
`CENTRAL_AGENT_KEY` não estiver configurada no servidor: `401`. A comparação
é em tempo constante e a chave nunca vai para o log.

**Nas rotinas da Central, a rotina não manda a chave.** Ela está guardada
como *Network secret* do ambiente na nuvem, para o site
`bot.thiagoborrelli.com`, e o proxy da Anthropic põe o cabeçalho em cada
chamada para esse site, fora da máquina da rotina. A chave não existe como
variável, nem em arquivo, e a rotina não tem como lê-la. Por isso os
exemplos abaixo não têm `-H "Authorization: …"`: não acrescente, um cabeçalho
mandado pela rotina (vazio, por exemplo) pode atrapalhar o que o proxy põe.

Fora desse ambiente (um teste no próprio computador, com a chave em mãos),
acrescente `-H "Authorization: Bearer $CENTRAL_AGENT_KEY"` em cada chamada.

Nos exemplos, `BASE` é a variável de ambiente `$BORRELLICHAT_URL`
(`https://bot.thiagoborrelli.com`).

## 0. O mapa (leia antes de tudo)

```bash
curl -s "$BASE/api/v1/central/mapa"
```

Só leitura. Todos os flows do workspace, os que estão no ar primeiro:

```json
{
  "geradoEm": "…",
  "flows": [
    {
      "id": "…", "nome": "Financial Advice", "status": "published", "noAr": true,
      "criadoPelaCentral": false,
      "gatilhos": [{ "tipo": "comment_keyword", "ativo": true, "palavras": [{ "value": "FA", "matchType": "contains" }] }],
      "passos": [
        { "tipo": "trigger", "resumo": "Começa com comentário: FA (contains)" },
        { "tipo": "sendMessage", "resumo": "Manda a mensagem: \"Oi! …\" botões: Agendar → https://…" },
        { "tipo": "addTag", "resumo": "Põe a tag \"lead-fa\"" }
      ],
      "levaPara": [], "convidaPara": [], "links": ["https://…"]
    }
  ],
  "ligacoes": [{ "de": "…", "para": "…", "como": "vai_para_flow" }],
  "palavras": [ "…a mesma lista da rota 1…" ]
}
```

- `passos`: cada nó em português, na ordem em que a pessoa passa por eles.
- `levaPara`: flows para onde este leva com o passo "ir para outro flow".
- `convidaPara`: flows cuja palavra de direct a mensagem deste convida a mandar (`#FA` no texto).
- `ligacoes`: as duas coisas acima, como lista de arestas entre flows.

Como a ferramenta funciona e as regras de ouro: `docs/CENTRAL-COMO-FUNCIONA.md`.

## 0b. Checar uma palavra antes de criar

```bash
curl -s -X POST "$BASE/api/v1/central/flows/checar" \
  -H "Content-Type: application/json" \
  -d '{"keyword": "FAMILIA", "levaPara": "FA"}'
```

Não grava nada. Resposta:

```json
{
  "palavra": "FAMILIA",
  "podeCriar": false,
  "conflitos": [{ "palavra": "FA", "flowNome": "Financial Advice", "noAr": true,
                  "motivo": "o comentário \"familia\" também dispararia o flow \"Financial Advice\"", "exemplo": "familia" }],
  "avisos": [],
  "levaPara": { "palavra": "#FA", "flowId": "…", "flowNome": "FA no direct" }
}
```

O teste usa a regra de comparação do próprio motor, nos dois sentidos: a
palavra nova não pode ser pega por uma existente e não pode pegar comentários
de uma existente. Palavra igual a uma de direct vira só `aviso`.
`levaPara` com `erro` quando a palavra não é de direct ou o flow não está no ar.

## 1. Quais palavras-chave já existem

```bash
curl -s "$BASE/api/v1/central/keywords"

# só uma palavra (ignora maiúscula e #)
curl -s "$BASE/api/v1/central/keywords?keyword=SS"
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
      "source": "trigger",
      "matches": [{ "value": "FA", "matchType": "contains" }],
      "warning": "\"FA\" com contains dispara em qualquer comentário que tenha essas letras dentro de outra palavra."
    }
  ]
}
```

- `type`: `comment_keyword` (comentário) ou `keyword` (DM).
- `live`: responde hoje (gatilho ativo **e** flow publicado).
- `source: "flow_node"`: a palavra está só no nó de um rascunho que nunca foi
  publicado (ainda sem linha em `triggers`). Conta como existente.
- `matches`: cada forma de comentário que dispara, como está gravada.
  `exact` = o comentário inteiro é só isso; `contains` = em qualquer lugar.
  "SS" e "#SS" do mesmo flow aparecem juntos aqui, numa entrada só.
- `warning`: aparece quando uma palavra curta, sem `#`, está como `contains`
  ou `startsWith`. Isso dispara em comentários que só têm as letras dentro de
  outra palavra ("ss" em "assim"). Vale avisar a Rafa; a porta não corrige
  flow existente.

Lista vazia para uma palavra = pode criar.

## 2. Criar o flow de comentário→direct (desligado)

```bash
curl -s -X POST "$BASE/api/v1/central/flows" \
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
| `commentReplies` | não | respostas públicas embaixo do comentário, uma sorteada por vez |
| `levaPara` | não | palavra de direct de um flow no ar para onde a mensagem convida a pessoa (ex.: `FA`); a mensagem precisa conter `#FA` |

Qualquer outro campo é ignorado (mandar `status`, `is_active` ou `matchType`
não muda nada).

Quando o comentário dispara, sempre do mesmo jeito (regra da Rafa):

| comentário | dispara? | por quê |
|---|---|---|
| `SS`, `ss`, ` Ss ` | sim | a palavra sozinha (`exact`) |
| `#SS`, `quero o #SS!` | sim | com `#`, em qualquer lugar (`contains`) |
| `quero SS`, `SS por favor` | não | palavra sem `#` no meio de uma frase |
| `assim`, `isso`, `passei` | não | só têm as letras dentro de outra palavra |

Resposta `201`:

```json
{
  "flowId": "…",
  "triggerId": "…",
  "name": "Central TB · SS",
  "keyword": "SS",
  "keywords": [
    { "value": "SS", "matchType": "exact" },
    { "value": "#SS", "matchType": "contains" }
  ],
  "dmText": "Oi! Aqui está o guia que você pediu: https://…",
  "status": "draft",
  "triggerActive": false
}
```

Erros: `400` (campo faltando, link não https, mensagem acima de 1000
caracteres com o link, `levaPara` inválido ou mensagem sem o convite), `409`
se a palavra já tem gatilho ou conflita com uma existente (`conflitos` diz
qual flow e um exemplo de comentário).

O que é criado: um flow `draft` com a descrição "Criado pela equipe da Central
TB, esperando a Rafa", e o mesmo desenho que o construtor faz à mão — um nó
gatilho `comment_keyword` ligado a um nó Send Message com uma bolha só. No
comentário, o motor manda essa bolha como resposta privada do Instagram, que
aceita uma mensagem de texto; por isso o link vai dentro do texto, e não num
botão.

O comentário é comparado em minúsculas, e `contains` numa palavra curta sem
`#` dispararia em "assim" ou "isso", mandando o PDF para quem não pediu. Por
isso a palavra sozinha é `exact` e só a forma com `#` é `contains`. Com
`exact`, "SS 🙏" não dispara; a Rafa ajusta no construtor se quiser.

## 3. Subir o PDF

PDF até ~4 MB, direto:

```bash
curl -s -X POST "$BASE/api/v1/central/iscas" \
  -F "file=@guia-ss.pdf;type=application/pdf"
```

PDF maior (a Vercel não deixa passar corpo acima de ~4,5 MB): peça um endereço
de envio e mande o arquivo direto para o Storage.

```bash
curl -s -X POST "$BASE/api/v1/central/iscas" \
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
curl -s "$BASE/api/v1/central/flows/<flowId>"
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
  "keywords": [
    { "value": "SS", "matchType": "exact" },
    { "value": "#SS", "matchType": "contains" }
  ]
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

- `CENTRAL_AGENT_KEY` na Vercel: a chave (mínimo 32 caracteres; com menos,
  a porta recusa tudo). A mesma chave fica como Network secret no ambiente da
  rotina, para `bot.thiagoborrelli.com`, e `BORRELLICHAT_URL` como variável
  comum.
- `CENTRAL_AGENT_WORKSPACE_ID` (opcional): o workspace onde os flows são
  criados. Sem ele, usa o único workspace que existir; se houver mais de um,
  a porta recusa até a variável ser definida.
- Migração `supabase/migrations/00026_central_agent.sql`: coluna
  `flows.created_via` e bucket `iscas`.

Passo a passo para configurar: `docs/CENTRAL-PASSO-A-PASSO.md`.
