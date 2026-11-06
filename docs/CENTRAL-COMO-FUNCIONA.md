# Como o BorrelliChat funciona (para a equipe da Central TB)

Este é o manual da Duda e de qualquer rotina que prepara flows pela porta
(`docs/CENTRAL-API.md`). Leia antes de criar qualquer coisa. A regra da Rafa:
quem mexe aqui precisa entender a ferramenta e ver o que já existe, para não
estragar o que roda todo dia.

## O que é

O BorrelliChat (bot.thiagoborrelli.com) é o "ManyChat" do Thiago: recebe
comentários e mensagens do Instagram e responde com flows de automação.

## As peças

**Flow:** uma sequência de passos desenhada no construtor. Tem `status`:
`draft` (rascunho), `published` (publicado) ou `archived`.

**Gatilho:** o que faz um flow começar. Os que importam para a Central:

| tipo | dispara quando |
|---|---|
| `comment_keyword` | alguém comenta num post uma palavra-chave |
| `keyword` | alguém manda a palavra no direct |
| `welcome` | é a primeira mensagem da pessoa no direct |
| `default` | chega mensagem no direct e nenhum outro gatilho serviu |
| `postback`, `quick_reply` | a pessoa toca num botão |

Um flow só responde quando **o gatilho está ativo e o flow está publicado**.
Quem publica é a Rafa, no construtor. A porta nunca faz isso.

**Como a palavra é comparada** (o comentário é passado para minúsculas antes):

| comparação | dispara quando o comentário… |
|---|---|
| `exact` | é exatamente a palavra |
| `contains` | tem a palavra em qualquer lugar, **inclusive dentro de outra palavra** |
| `startsWith` | começa com a palavra |

Por isso `contains` numa palavra curta sem `#` é perigoso: `fa` dispara em
"família", "favor", "fazer". Os flows da porta usam a regra da Rafa: a
palavra sozinha é `exact` e a forma com `#` é `contains`.

**Passos (nós) que aparecem no mapa:** mandar mensagem (com botões, respostas
rápidas, imagem), esperar resposta, esperar um tempo, condição, pôr ou tirar
tag, gravar campo, mandar para o ActiveCampaign, chamar sistema externo, ir
para outro flow, passar para atendimento humano, responder com IA, teste A/B,
entrar numa sequência.

## Regras do Instagram que mudam tudo

- **Comentário vira uma resposta privada só, e só texto.** Quando um flow
  começa por comentário, o primeiro "mandar mensagem" sai como resposta
  privada ao comentário: uma bolha, sem botão. O resto do flow não chega,
  porque ainda não existe conversa no direct. Por isso o flow da Central é um
  gatilho mais uma mensagem, com o link dentro do texto.
- **Janela de 24 horas.** Depois da última ação da pessoa, só dá para mandar
  mensagem livre por 24 horas. Esperas maiores que isso não funcionam.
- **Conversa pausada.** Se alguém da equipe assumiu a conversa (atendimento
  humano), a automação fica pausada para aquela pessoa; a palavra-chave
  sozinha reinicia.

## Responder no direct (Marina)

As rotas 5 e 6 de `docs/CENTRAL-API.md` deixam a Central ler o direct e
mandar uma resposta que a Rafa ou o Thiago aprovaram. Três regras valem antes
de qualquer texto:

- **Janela de 24 horas.** Uma resposta livre só sai até 24 horas depois da
  última mensagem da pessoa. A porta conta a partir da última mensagem dela
  (não de um comentário, que não abre a janela do direct) e já recusa nos
  últimos 10 minutos, porque a fila e o relógio do Instagram não são os
  nossos. Passou da janela, a resposta espera a pessoa escrever de novo; não
  insista nem tente outro caminho. O inbox pode responder até 7 dias como
  "atendimento humano", mas essa etiqueta é para uma pessoa digitando, e a
  Central não usa.
- **Conversa assumida por alguém da equipe.** Quando um flow passa a conversa
  para atendimento humano, a automação fica pausada (`pausada: true` na rota
  5). Essa conversa é da pessoa que assumiu: a Central não responde, nem
  rascunha resposta para ela. Quem tira a pausa é a equipe, no inbox (ou a
  própria pessoa, mandando uma palavra-chave).
- **Alguém já respondeu.** Se depois da última mensagem da pessoa já existe
  uma resposta de `pessoa` (Thiago ou Rafa, pelo inbox ou pelo app) ou da
  própria Central, a porta recusa. Uma resposta só de `automacao` (o flow
  mandou o PDF, por exemplo) não impede.

Quando o Thiago responde à mão no app do Instagram, a automação não pausa;
é a regra "alguém já respondeu" que evita a Central falar por cima dele. Use sempre a `chave` (o id da aprovação) para que uma chamada
repetida não mande a mesma resposta duas vezes.

## Antes de criar qualquer flow

1. **Leia o mapa:** `GET /api/v1/central/mapa`. Ele lista todos os flows, se
   estão no ar, os gatilhos e as palavras, cada passo em português, os links
   que mandam e as ligações entre flows.
2. **Já existe um flow para isso?** Se o assunto é o mesmo (ex.: Financial
   Advice → flow do #FA), use o que existe. Não crie um paralelo.
3. **Cheque a palavra:** `POST /api/v1/central/flows/checar` com
   `{keyword, levaPara?}`. Ela testa, com a regra de comparação de verdade,
   se a palavra nova dispararia junto com uma existente ou o contrário. Com
   conflito, escolha outra palavra e conte à Rafa por quê.
4. **Precisa levar a pessoa para um flow existente?** Como o comentário só
   permite um texto, o caminho é convidar a pessoa a mandar a palavra do outro
   flow no direct ("Se quiser falar do seu caso, me manda #FA aqui"). Mande
   `levaPara: "FA"` no `POST /flows`: a porta confere que essa palavra é de
   direct, que o flow está no ar e que a mensagem convida a pessoa a mandá-la.
   O flow existente não é tocado.
5. **Crie desligado** (`POST /api/v1/central/flows`) e avise a Rafa. Ela
   revisa e publica no construtor.

## O que nunca fazer

- Mexer, pausar, publicar, editar ou apagar um flow que já existe (a porta
  nem deixa).
- Criar palavra que já existe, mesmo com outra grafia ou com `#`.
- Usar palavra curta e comum sem `#` (dispara em conversa normal).
- Mandar o PDF por um botão ou numa segunda mensagem depois do comentário (não
  chega).
- Agendar o post antes de a Rafa publicar o flow da palavra dele.

## Quando algo parecer errado num flow existente

Por exemplo: uma palavra antiga com `contains` que dispara em palavras comuns
(o mapa e a lista de palavras trazem `warning`). Avise a Rafa com o nome do
flow, a palavra e um exemplo de comentário que dispararia sem querer. Não
tente corrigir.
