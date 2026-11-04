# BorrelliChat, estado do projeto

Última atualização: 4 de novembro de 2026.

Documento de passagem de bastão. Quem lê isto deveria conseguir continuar o
desenvolvimento sem reconstruir o contexto do zero.

---

## O que é

Substituto próprio do ManyChat, rodando em `bot.thiagoborrelli.com`. Captura
comentário e DM no Instagram, dispara fluxos de automação, e serve de caixa de
entrada para atendimento humano.

Stack: Next.js 16 (App Router), React 19, Tailwind 4, Vitest, Supabase
(Postgres, Auth, Storage), deploy na Vercel, canvas de fluxo com
`@xyflow/react`.

Repositório: `github.com/rafakinzel/zernflow`, branch `main`. Push na `main`
dispara deploy automático na Vercel.

---

## Como as peças se encaixam

```
Instagram
   ↓  (permissão concedida pelo app Meta de desenvolvedor)
Zernio                      ← guarda o token de 60 dias e renova
   ↓  webhook
/api/webhooks/late          ← recebe, grava, decide o que fazer
   ↓
motor de fluxo (lib/flow-engine)
   ↓
Supabase
```

Pontos que não são óbvios e já custaram caro:

**O BorrelliChat não guarda nenhuma credencial da Meta.** Nem app id, nem
secret, nem access token. A tabela `channels` só tem o id da conta no Zernio.
A cadeia de permissão é Instagram → app Meta → Zernio → BorrelliChat, e o
token de 60 dias vive dentro do Zernio. Se ele parar de renovar, a ferramenta
sai do ar e nada aqui avisa. É exatamente o problema que a primeira tarefa
abaixo resolve.

**O motor lê a linha viva de `flows`, não um snapshot publicado.** Editar o
grafo tem efeito na próxima mensagem, sem precisar publicar. Publicar só
incrementa `version` e guarda snapshot para rollback.

**A caixa de entrada lê as conversas ao vivo da API do Zernio**, não da tabela
`messages`. A tabela local existe para contar e classificar, não para exibir.

**Calendário:** a Data Use Checkup da Meta é anual e está amarrada a manter o
acesso à API. O token do Instagram dura 60 dias e só pode ser renovado
enquanto estiver válido.

---

## O que foi corrigido em 3 e 4 de novembro

Esta leva saiu de uma pergunta simples que o banco não conseguia responder:
quais leads estão esperando resposta.

- **Palavra-chave não reiniciava conversa pausada.** Uma lead foi instruída a
  mandar `#FA`, mandou, e recebeu silêncio, porque o portão de "automação
  pausada" ficava antes do casamento de gatilho. Agora a mensagem que é só a
  palavra-chave reinicia com ou sem `#`; dentro de uma frase, só com `#`.
  Ver `lib/flow-engine/restart-keyword.ts`.

- **Mensagem de entrada nunca era gravada.** O webhook recebia o texto, usava
  para casar gatilho, e descartava. O banco tinha 87 saídas e zero entradas,
  o que tornava impossível distinguir uma lead esperando de uma que desistiu.
  Agora grava.

- **Direção das mensagens lida errada do Zernio.** O código comparava com
  `outbound`; a API manda `incoming` e `outgoing`. Resultado: toda mensagem de
  toda conversa era marcada como entrada, e a caixa de entrada mostrava as
  respostas do Thiago como se fossem da lead. O teste existente passava porque
  o fixture também usava `outbound`, então só confirmava que o código
  concordava consigo mesmo.

- **Paginação do Zernio ignorada.** Só a primeira página de cada conversa era
  lida, 100 mensagens. Agora percorre todas.

- **Índice parcial não servia de alvo de upsert.** `where platform_message_id
  is not null` faz o Postgres recusar o `on conflict`, e a gravação falhava
  calada no log. Trocado por índice único normal; nulos já são distintos por
  padrão, então o predicado não protegia nada.

- **Histórico recuperado.** 221 conversas trazidas do Zernio: 2357 mensagens
  de entrada e 3427 de saída, desde 2020. Rota em
  `app/api/v1/admin/backfill-messages/route.ts`, retomável, corrige linha
  existente em vez de duplicar.

Antes disso, na mesma frente: tratamento de resposta digitada em ponto de
decisão, reabertura de sessão por toque em botão fora de ordem, janela de 24h
lida de `contacts.last_interaction_at`, e a devolução de conversa do humano
para o bot.

---

## Regra de pendente contra abandono

A classificação que motivou o trabalho acima. O sinal que separa tudo é quem
falou por último.

- **Pendente**: a pessoa falou e nada saiu depois. Três casos: mandou a
  palavra-chave e nada disparou; o fluxo parou no meio sem job agendado nem
  espera; ou fez uma pergunta real, a automação pausou para humano, e ninguém
  respondeu.
- **Em andamento**: sessão esperando resposta com job agendado pendente.
- **Abandono**: o fluxo funcionou, a última mensagem saiu do nosso lado, os
  follow-ups já foram, a pessoa não voltou.
- **Concluído**: chegou ao fim do fluxo.

Nos 30 dias até 4 de novembro: 21 pendentes, 7 concluídas, 1 em andamento, 20
conversas sem fluxo nenhum.

**Refinamento que falta:** "falou por último" conta como pendente coisas que
não são. Despedidas como "🙏", "muito obrigada" e "amém" aparecem na lista.
Uns 6 ou 7 dos 21 são isso. O critério para separar despedida de pergunta real
ainda não foi decidido.

---

## Pendências conhecidas

Em ordem de risco. As da primeira seção vieram de uma varredura geral e foram
verificadas no código; nenhuma foi corrigida.

### Pode derrubar ou causar dano

- **`global_keywords` com incompatibilidade string contra objeto.** Adicionar
  qualquer palavra-chave global mata silenciosamente todas as DMs.
- **RLS de `scheduled_jobs` aberta** a qualquer usuário autenticado.
- **`workspace_invites_update` sem `WITH CHECK`.**
- **Cadastro fechado vive só no painel do Supabase**, não no código. Se
  alguém reabrir sem saber, qualquer pessoa cria conta.

### Perde trabalho ou quebra fluxo

- **Payload chamado `reply`, `timeout` ou `next` sequestra a saída do nó.**
- **Aba Carousel apaga uma bolha** do nó.
- **Apagar caminho de split A/B repontando os irmãos.**
- **Renomear o payload de um botão órfã a aresta.**
- **Builder não tem autosave.**

### Dívida de dados

- **Até 87 linhas de saída duplicadas.** Os envios que o motor gravou desde
  20/10 não têm `platform_message_id`, e o Zernio devolveu as mesmas
  mensagens com chave. Não afeta quem falou por último; afeta contagem de
  mensagens enviadas. Resolver exige apagar linhas, o que não foi feito sem
  autorização explícita.
- **O motor não guarda o id da mensagem ao enviar.** Se guardasse, a
  duplicação acima não existiria. Esta é a correção de raiz.
- **Migrations `00022` e `00023` (link-bio leads) podem não ter sido
  aplicadas em produção.** Não verificado.

### Não construído

- **Horário de silêncio para follow-ups.** Desenhado, não implementado. A
  ideia é adiantar o envio em vez de adiar, para que o follow-up não seja
  empurrado para fora da janela de 24h. Fica uma pergunta em aberto: o que
  fazer quando a madrugada é a última chance antes da janela fechar.
- **Filtro de estado na caixa de entrada**, usando a regra de pendente contra
  abandono acima.

---

## Primeira tarefa: painel de saúde e alerta de queda

O problema real: em 30 de outubro o canal ficou mudo e a descoberta veio de
uma lead que não foi respondida. Não existe garantia da Meta contra isso, mas
existe alarme.

### O que construir

Uma verificação periódica que responde "está tudo conectado?" e avisa quando
deixa de estar.

**Sinais a verificar:**

1. **Saúde da conta no Zernio.** O SDK `@zernio/node` expõe
   `accounts.getAccountHealth` e `accounts.getAllAccountsHealth`. É o caminho
   direto para saber se a conexão com o Instagram ainda vale. O SDK também tem
   `tokenExpiresAt` em alguns tipos, que vale investigar.
2. **Silêncio de webhook.** Nenhum webhook recebido em X horas em dia útil é
   sinal de problema mesmo quando tudo parece verde. Dá para medir por
   `max(created_at)` em `messages` com `direction = 'inbound'`, que agora é
   confiável.
3. **Cron da Vercel rodando.** Os follow-ups dependem dele. Medir por
   `scheduled_jobs` com `status = 'completed'` recente.
4. **Banco respondendo** e chave de API do workspace configurada.

**Onde mostrar:** uma página no dashboard, verde ou vermelho por sinal, com a
hora da última verificação. Simples de bater o olho.

**Como avisar:** a Rafa precisa saber sem abrir o painel. Decidir entre
e-mail, notificação no próprio painel, ou mensagem no WhatsApp.

### Restrições

- Nada de expor a chave da API do Zernio em log, resposta ou interface.
- A rota de verificação precisa de autenticação, como a de backfill.
- Plano Hobby da Vercel limita cron a uma vez por dia; Pro permite por minuto.
  Confirmar em qual plano está antes de definir a frequência.

### Como rodar uma rota administrativa

A rota de backfill é o modelo. Ela autentica na sessão do usuário, checa
`workspace_members`, e só então usa o cliente de serviço para escrever.
Trabalha com orçamento de tempo e devolve cursor, porque o Zernio limita taxa
e uma varredura completa não cabe em uma requisição serverless.

---

## Acesso e ambientes

- **Supabase:** projeto `ymrrzqzxgbvpicdrfnne`, organização `[TB] Instagram`.
  O conector MCP do Claude só enxerga uma organização por vez.
- **Vercel:** deploy automático no push para `main`.
- **Zernio:** chave de API guardada em `workspaces.late_api_key_encrypted`.
  Nunca deve ser lida para fora do app.
- **Meta:** o app de desenvolvedor não expira, mas a Data Use Checkup é anual
  e o token é de 60 dias, renovado pelo Zernio.

---

## Testes

`npx vitest run` na raiz. 313 testes passando em 4 de novembro.

Costume que vale manter: antes de confiar em um teste novo de regressão,
rodar ele contra o código antigo e confirmar que falha. Foi assim que o bug de
direção do Zernio apareceu, e foi a falta disso que o deixou passar por meses.
