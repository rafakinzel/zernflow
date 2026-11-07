# Porta da Central TB

Rotas só para as rotinas do Claude na nuvem que operam a Central de conteúdo
do Instagram do Thiago. Elas preparam o flow de comentário→direct de cada post
com palavra-chave. **Nada que passa por aqui fica ativo**: o flow nasce como
rascunho, com o gatilho desligado, e só entra no ar quando a Rafa publica no
construtor.

O que a porta não faz, e não tem como fazer: ativar gatilho, publicar, editar
ou apagar flow existente, mexer em contatos. Isso está travado no código (não
existe rota nem parâmetro para isso) e num teste que lê o próprio código:
`lib/central-agent/central-agent.test.ts`.

A única exceção é o direct (rotas 5 e 6, para a Marina): ler as conversas
recentes do Instagram e mandar uma resposta que a Rafa ou o Thiago aprovaram.
Essas rotas têm regras próprias, também travadas num teste que lê o código
(`lib/central-agent/dm.test.ts`): só gravam o registro do envio da Central e,
como o inbox faz, a hora e a prévia da última mensagem da conversa. Nunca
mexem em flow, gatilho, contato, tag ou na pausa da automação.

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

## 5. Conversas do direct (só leitura)

```bash
curl -s "$BASE/api/v1/central/conversas?dias=2&limite=50"
```

- `dias`: conversas com mensagem nos últimos N dias. Padrão 2, máximo 60.
- `limite`: quantas conversas. Padrão 50, máximo 200. Acima do máximo vale o
  máximo; zero, negativo ou não número dá `400`.

Só Instagram, a conversa com mensagem mais recente primeiro. Resposta:

```json
{
  "geradoEm": "2026-11-06T12:00:00.000Z",
  "dias": 2,
  "limite": 50,
  "avisos": [],
  "conversas": [
    {
      "id": "3f0c…",
      "ultima_mensagem_em": "2026-11-06T11:00:00.000Z",
      "ultima_do_contato_em": "2026-11-06T11:00:00.000Z",
      "janela_aberta": true,
      "janela_fecha_em": "2026-11-07T11:00:00.000Z",
      "pausada": false,
      "aguardando_resposta": true,
      "tags": ["lead-ss"],
      "fonte": "zernio",
      "mensagens_omitidas": 0,
      "mensagens": [
        { "direcao": "contato", "texto": "SS", "em": "…" },
        { "direcao": "automacao", "texto": "Aqui está o guia: https://…", "em": "…" },
        { "direcao": "pessoa", "texto": "Oi! Sou eu, o Thiago", "em": "…" },
        { "direcao": "pessoa", "texto": "…", "em": "…", "central": true },
        { "direcao": "contato", "texto": null, "em": "…", "anexo": "image" }
      ]
    }
  ]
}
```

- `id`: o id da conversa no BorrelliChat. É o que vai em `conversa` na rota 6.
- `ultima_do_contato_em`: a última mensagem que a pessoa mandou.
- `janela_aberta`: dá para responder agora (janela de 24 horas do Instagram,
  ver `docs/CENTRAL-COMO-FUNCIONA.md`). `false` também nos últimos 10
  minutos da janela e quando não há registro de mensagem da pessoa.
  `janela_fecha_em`: quando fecha (ou fechou).
- `pausada`: alguém da equipe assumiu a conversa (atendimento humano) e a
  automação está parada. A Central não responde conversa pausada.
- `aguardando_resposta`: a última mensagem da conversa é da pessoa.
- `mensagens`: as 30 mais recentes, da mais antiga para a mais nova;
  `mensagens_omitidas` diz quantas mais antigas ficaram de fora. `texto` é
  `null` quando a pessoa só mandou foto, áudio etc.; `anexo` diz o tipo (o
  link do arquivo nunca vem).
- `direcao`:
  - `contato`: a pessoa escreveu.
  - `automacao`: mandado por um flow, uma sequência ou um nó de IA.
  - `pessoa`: mandado por alguém de verdade (Thiago ou Rafa, pelo inbox do
    BorrelliChat ou pelo app do Instagram). Com `central: true`, foi uma
    resposta da Central aprovada e mandada pela rota 6.
- `fonte`: `zernio` (a conversa inteira, lida no Zernio, como o inbox lê) ou
  `local` (o Zernio não respondeu ou limitou as chamadas, e a conversa veio
  do registro do BorrelliChat: as mensagens da pessoa e dos flows estão
  todas, mas uma resposta dada à mão pode faltar). Com `local`, `avisos`
  explica.

**Como `automacao` e `pessoa` são separados.** O Zernio não diz quem mandou
uma mensagem, só que saiu da conta. Todo envio automático (flow, sequência,
IA) grava no BorrelliChat uma linha na hora em que sai; o inbox e o app do
Instagram não gravam nada. Então: mensagem de saída que bate com um envio
automático gravado (pelo id da mensagem ou, sem id, pelo mesmo texto com até
10 minutos de diferença) é `automacao`; que bate com um envio da Central é
`pessoa` com `central: true`; qualquer outra mensagem de saída é `pessoa`.
É confiável para o que vem dos flows (eles sempre gravam). Os erros possíveis
vão para o lado seguro, fazendo a Central achar que alguém já respondeu: um
envio automático cuja gravação falhou e as mensagens de **transmissão**
(broadcast), que não são gravadas como mensagem, aparecem como `pessoa`.
Inbox e app do Instagram não se distinguem entre si: os dois são `pessoa`.

**Privacidade.** A resposta nunca traz @, nome, foto, telefone, e-mail, nem
id do Instagram, do Zernio ou do contato. O único id é o da conversa. O texto
das mensagens vem como a pessoa escreveu (pode ter o nome dela, se ela
escreveu).

Cada conversa é uma chamada ao Zernio, quatro de cada vez. Passando de 40
segundos, as que faltam vêm do registro local (`fonte: "local"`). Para ler
tudo do Zernio, peça menos conversas.

## 6. Responder no direct

```bash
curl -s -X POST "$BASE/api/v1/central/responder" \
  -H "Content-Type: application/json" \
  -d '{"conversa": "3f0c…", "texto": "Oi! Te explico sim…", "chave": "aprovacao-123"}'
```

| campo | obrigatório | o que é |
|---|---|---|
| `conversa` | sim | o `id` da rota 5 |
| `texto` | sim | a resposta aprovada, até 1000 caracteres (emoji conta 1) |
| `chave` | não, mas use | um id único do envio (o id da aprovação na Central, por exemplo). A mesma chave nas 24 horas seguintes é recusada, então repetir a chamada depois de um erro de rede não manda duas vezes |

Qualquer outro campo é ignorado. Manda pelo mesmo caminho do inbox
(o Zernio, na mesma conversa), como texto simples, sem a etiqueta de
"atendimento humano" (a Central só responde dentro das 24 horas, onde ela não
é necessária). Depois de mandar, faz o que o inbox faz: atualiza a hora e a
prévia da última mensagem da conversa. E grava o envio em
`central_dm_sends`, que é como a rota 5 reconhece o que a Central mandou.

Resposta `201`:

```json
{ "enviado": true, "conversa": "3f0c…", "envio": "9a1b…", "chave": "aprovacao-123", "em": "2026-11-06T12:00:03.000Z" }
```

Recusas (nada é mandado), sempre com `erro` em português e um `motivo` fixo:

| status | `motivo` | quando |
|---|---|---|
| 400 | `json_invalido`, `conversa_invalida`, `texto_vazio`, `texto_longo`, `chave_invalida` | pedido malformado |
| 400 | `nao_e_instagram` | a conversa não é do direct do Instagram |
| 404 | `conversa_nao_encontrada` | a conversa não existe neste workspace |
| 409 | `conversa_pausada` | alguém da equipe assumiu a conversa |
| 409 | `fora_da_janela` | passaram 24 horas da última mensagem da pessoa (ou faltam menos de 10 minutos), ou não há mensagem dela |
| 409 | `ja_respondida` | alguém já respondeu à mão depois da última mensagem da pessoa |
| 409 | `ja_respondida_pela_central` | a Central já respondeu depois da última mensagem da pessoa |
| 409 | `chave_repetida` | essa `chave` já foi usada nas últimas 24 horas |
| 409 | `sem_conversa_no_zernio`, `sem_chave_zernio` | a conversa não está ligada ao Zernio |
| 502 | `zernio_indisponivel` | não deu para ler a conversa no Zernio para conferir; tente de novo |
| 502 | `envio_falhou` | o Zernio recusou o envio; a mesma `chave` pode ser usada de novo |
| 503 | `migracao_pendente` | falta rodar a migração `00027_central_dm_sends.sql` |

Sem a chave de acesso: `401` com `{ "error": "Unauthorized" }`, como nas
outras rotas.

## 7. Fluxos que pararam para esperar uma pessoa (só leitura)

```bash
curl -s "$BASE/api/v1/central/fluxos-parados?dias=7"
```

Quando a pessoa digita algo que os botões não cobrem, o motor entende que é
uma pergunta para um humano: pausa a automação da conversa e encerra o fluxo
(`handOverToHuman` em `lib/flow-engine/engine.ts`). Ninguém era avisado, e
foi assim que uma lead que respondeu "Tá joia, pode perguntar!" ao primeiro
passo do #fa ficou sem resposta (07/11/2026). Esta rota lista essas paradas
para a Central avisar a Rafa.

- `dias`: paradas dos últimos N dias. Padrão 2, máximo 60.

Resposta:

```json
{
  "geradoEm": "2026-11-07T12:00:00.000Z",
  "dias": 7,
  "parados": [
    {
      "sessao": "…",
      "conversa": "0512…",
      "fluxo": { "id": "…", "nome": "Financial Adviser (#fa)" },
      "passo": { "id": "…", "mensagem": "Olá …! Vi que você quer saber mais…", "botoes": [{ "payload": "…", "titulo": "Claro, vamos lá 🔥" }] },
      "digitou": "Olá Thiago! Obrigada pelo retorno. Tá joia, pode perguntar!",
      "parou_em": "2026-11-07T10:02:37.000Z",
      "pausada": true,
      "alguem_respondeu": false,
      "retomado": false,
      "janela_aberta": true,
      "janela_fecha_em": "2026-11-08T10:02:36.694Z",
      "retomavel": true,
      "motivo_nao_retomavel": null
    }
  ]
}
```

- `retomavel: true` quer dizer que a pessoa ainda está esperando: a conversa
  continua pausada, ninguém respondeu à mão e a janela de 24 horas está
  aberta. Os outros casos vêm com `motivo_nao_retomavel`: `ja_retomado` (um
  fluxo novo já começou para ela), `alguem_respondeu`, `nao_esta_pausada`,
  `passo_sem_botao` ou `fora_da_janela`.
- `alguem_respondeu` olha o que o servidor registrou. Resposta digitada direto
  no app do Instagram só chega aqui pelo backfill, então confira também a rota
  5 (`direcao: "pessoa"` depois de `parou_em`).
- A porta **só lê**: ela não retoma o fluxo nem tira a pausa. Quem devolve a
  conversa ao robô é uma pessoa, no inbox, no botão "Bot paused · resume".
  Para uma dúvida de verdade, a Central prepara a resposta para a Rafa
  aprovar e mandar.

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
- Migração `supabase/migrations/00027_central_dm_sends.sql`: tabela
  `central_dm_sends` (registro e trava contra envio repetido das respostas da
  Central). Sem ela, a rota 6 responde `503` e a rota 5 funciona, mas sem
  `central: true`.

Passo a passo para configurar: `docs/CENTRAL-PASSO-A-PASSO.md`.
