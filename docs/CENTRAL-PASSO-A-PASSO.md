# Ligar a porta da Central TB: passo a passo

Para a Rafa. São quatro coisas, uma vez só. A chave é uma senha: ela vai para
a Vercel e para o ambiente da rotina, e para nenhum outro lugar. Não cole a
chave no chat com o Claude, em e-mail, no Notion ou em mensagem.

## 1. Rodar a migração no Supabase do BorrelliChat

1. Entre em supabase.com e abra o projeto do **BorrelliChat** (não o do
   Nexus).
2. Menu da esquerda: **SQL Editor** → **New query**.
3. Cole o conteúdo do arquivo `supabase/migrations/00026_central_agent.sql`
   deste repositório e clique em **Run**.
4. Confira: em **Storage** tem que aparecer um bucket chamado `iscas`,
   marcado como público.

Isso cria o lugar onde os PDFs ficam e uma marca nos flows para saber quais
vieram da Central. Não mexe em nenhum flow existente.

## 2. Gerar a chave

No Mac, abra o app **Terminal** e rode:

```bash
openssl rand -hex 32
```

Aparece uma linha com 64 letras e números. Essa é a chave. Deixe a janela
aberta até terminar os passos 3 e 4 e depois feche. Não salve em arquivo.

Se preferir guardar, guarde no seu gerenciador de senhas, com o nome
"BorrelliChat, chave da Central".

## 3. Colocar a chave na Vercel

1. Entre em vercel.com e abra o projeto do BorrelliChat.
2. **Settings** → **Environment Variables**.
3. **Add New**:
   - Key: `CENTRAL_AGENT_KEY`
   - Value: a chave do passo 2
   - Environments: marque **Production** (Preview só se você for testar
     num deploy de preview)
   - Se aparecer a opção **Sensitive**, ligue.
4. **Save**.
5. A variável só vale depois de um deploy novo. Vá em **Deployments**, no
   mais recente clique nos três pontinhos → **Redeploy**. (Ou espere o
   próximo deploy, que acontece quando este PR entrar na `main`.)

Se um dia houver mais de um workspace no BorrelliChat, adicione também
`CENTRAL_AGENT_WORKSPACE_ID` com o id do workspace do Thiago. Hoje não precisa.

## 4. Colocar a chave no ambiente da rotina na nuvem

As rotinas da Central rodam no Claude Code na nuvem (claude.ai/code). A chave
fica guardada como **Network secret**: o sistema da Anthropic põe a chave em
cada chamada para o BorrelliChat, e a rotina nunca vê a chave. Não use
"Environment variables" para a chave: o que fica lá pode ser lido por quem usa
o ambiente.

1. Entre em **claude.ai/code/routines** e clique na rotina da Central.
2. No menu ao lado do nome, clique em **Edit**.
3. Em **Advanced settings** → **General** → **Cloud environment**, clique no
   ícone de nuvem com o nome do ambiente.
4. Passe o mouse no ambiente e clique na engrenagem à direita (**Edit cloud
   environment**).
5. **Network secrets** → **Add secret**:
   - Name: `BorrelliChat Central`
   - Allowed websites: `bot.thiagoborrelli.com`
   - Custom headers: deixe **Authorization** com prefixo **Bearer**
   - Valor: a chave do passo 2
6. Em **Environment variables**, só o endereço (não é segredo):

   ```
   BORRELLICHAT_URL=https://bot.thiagoborrelli.com
   ```

7. **Save changes** e feche a janela da rotina.

Network access: não precisa mexer, um site com Network secret passa mesmo com
acesso restrito. Só se a rotina subir PDF acima de 4 MB ela precisa alcançar o
Supabase (`<projeto>.supabase.co`); se der erro nesse caso, libere esse
endereço.

Para conferir: numa sessão nova em claude.ai/code, no mesmo ambiente, peça
para rodar `curl -s -w "\nHTTP %{http_code}\n" "$BORRELLICHAT_URL/api/v1/central/keywords"`.
`HTTP 200` com a lista de palavras = tudo certo. `HTTP 401` = a chave não
chegou (confira o site e a chave no Network secret).

Para a rotina, a instrução é: "o endereço está em `$BORRELLICHAT_URL`, a chave
é posta pelo ambiente, não mande cabeçalho de autorização; as rotas estão em
`docs/CENTRAL-API.md` do repositório `rafakinzel/zernflow`".

## Como fica o dia a dia

1. A rotina cria a isca, sobe o PDF e prepara o flow da palavra-chave.
2. No BorrelliChat, em **Flows**, aparece um flow `Central TB · <palavra>`
   com a descrição "Criado pela equipe da Central TB, esperando a Rafa", como
   rascunho.
3. Você abre, confere a palavra, a mensagem e o link do PDF, ajusta o que
   quiser e clica em **Publicar**. O gatilho vem com duas formas: a palavra
   sozinha (`SS`, só se o comentário for exatamente isso) e com hashtag
   (`#SS`, em qualquer lugar do comentário). "assim", "isso" ou "quero SS"
   não disparam. Só depois de publicar ele passa a responder comentários.

Se não quiser um flow, é só não publicar (ou apagar no construtor). A rotina
não consegue ativar nada sozinha.

## Trocar ou cancelar a chave

Se a chave vazar, ou para desligar a porta: gere outra (passo 2) e troque nos
passos 3 e 4 (no Network secret, apague e crie de novo: o valor não pode ser
editado), com redeploy na Vercel. Para desligar de vez, apague
`CENTRAL_AGENT_KEY` da Vercel e faça redeploy: sem a variável, a porta recusa
todo mundo.
