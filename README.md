# Backend REI TECH

API da loja REI TECH: produtos, pedidos, clientes, login seguro do admin e
integração de pagamento com Mercado Pago. Escrito em Node.js puro, **sem
dependências externas** (não precisa de `npm install`).

---

## 1. Rodando localmente (para testar)

Pré-requisito: [Node.js](https://nodejs.org) 18 ou mais recente instalado.

```bash
cd backend
cp .env.example .env
```

Gere sua senha de administrador:

```bash
node scripts/hash-password.js "SuaSenhaForte123"
```

Copie a linha `ADMIN_PASSWORD_HASH=...` que aparecer e cole no arquivo `.env`.

Gere uma chave secreta única para os tokens de login:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Cole o resultado em `JWT_SECRET` no `.env`.

Inicie o servidor:

```bash
npm start
```

Ele vai subir em `http://localhost:3001`. Teste com:

```bash
curl http://localhost:3001/api/health
```

---

## 2. Configurando o upload de imagens (Cloudinary)

O Render apaga qualquer arquivo salvo localmente a cada novo deploy — por isso
as imagens de produto são enviadas para o [Cloudinary](https://cloudinary.com),
que tem um plano gratuito generoso e guarda as fotos permanentemente.

1. Crie uma conta gratuita em [cloudinary.com](https://cloudinary.com).
2. No **Dashboard**, copie três valores: **Cloud Name**, **API Key** e **API Secret**.
3. Cole cada um no `.env`:
   ```
   CLOUDINARY_CLOUD_NAME=...
   CLOUDINARY_API_KEY=...
   CLOUDINARY_API_SECRET=...
   ```

Sem essas três variáveis, o botão de upload de imagem no admin retorna um erro
claro em vez de falhar silenciosamente.

---

## 3. Configurando o banco de dados permanente (Supabase)

**Esse passo é essencial.** Sem ele, tudo que você cadastra (produtos, fotos,
pedidos, contas de cliente) é apagado toda vez que o Render reinicia o
servidor ou você faz um novo deploy — o disco dele é temporário.

1. Crie uma conta gratuita em [supabase.com](https://supabase.com) e um projeto novo.
2. Dentro do projeto, vá em **SQL Editor** (menu lateral) → **New query** → cole e rode isto:
   ```sql
   create table if not exists kv_store (
     key text primary key,
     value jsonb not null,
     updated_at timestamptz not null default now()
   );
   ```
3. Vá em **Project Settings → API**. Copie dois valores:
   - **Project URL** → cole em `SUPABASE_URL`
   - **service_role key** (não é a "anon"/"public" key!) → cole em `SUPABASE_SERVICE_KEY`
4. Adiciona os dois no `.env` (local) e nas variáveis de ambiente do Render.

> ⚠️ A `service_role key` dá acesso total ao banco, sem restrições. Ela deve
> ficar **só no backend** (variável de ambiente do servidor) — nunca no
> `index.html`, nunca no navegador, nunca em repositório público.

Depois de configurado, o log do servidor mostra `Armazenamento: Supabase
(permanente)` na inicialização — é assim que você confirma que pegou. Também
dá pra conferir abrindo `/api/health`, que retorna `"storage":"supabase"`.

Sem essas duas variáveis, o backend continua funcionando normalmente (não
quebra nada), mas volta a usar arquivo local — útil só para testar na sua
máquina, nunca para produção no Render.

---

## 4. Configurando o Mercado Pago

1. Crie uma conta em [mercadopago.com.br/developers](https://www.mercadopago.com.br/developers).
2. No painel, vá em **Suas integrações → Credenciais de produção**.
3. Copie o **Access Token de produção** e cole em `MP_ACCESS_TOKEN` no `.env`.
4. Enquanto estiver testando, use as **credenciais de teste** em vez das de produção.

O backend já expõe:
- `POST /api/payments/create-preference` — o frontend chama isso depois de criar o pedido, recebe um link de pagamento (`init_point`) e redireciona o cliente para lá.
- `POST /api/payments/webhook` — o Mercado Pago chama essa URL automaticamente quando o pagamento é aprovado. O backend confirma o pedido sozinho.

---

## 5. Configurando o e-mail de confirmação de venda (Resend)

Quando um pedido vira "confirmado" — pelo webhook do Mercado Pago ou porque
você mudou o status manualmente no painel admin — o backend manda um e-mail
pro cliente com os itens, o total e o endereço de entrega. Isso usa o
[Resend](https://resend.com).

1. Crie uma conta gratuita em [resend.com](https://resend.com) (o plano
   grátis cobre bem uma loja pequena/média — 3.000 e-mails/mês).
2. Em **API Keys**, crie uma chave e cole em `RESEND_API_KEY` no `.env`.
3. Em **Domains**, adicione e verifique o seu domínio (ex: `reitech.com`) —
   isso exige adicionar alguns registros DNS onde seu domínio está
   registrado. **Sem isso, o Resend só deixa enviar e-mail pra você mesmo**
   (modo sandbox), não pros seus clientes.
4. Depois do domínio verificado, defina `RESEND_FROM_EMAIL` com um endereço
   desse domínio, ex: `pedidos@reitech.com`.
5. Ajuste `STORE_NAME` se quiser mudar o nome que aparece no e-mail (padrão:
   `REI TECH`).

> Se você ainda não tem um domínio próprio, dá pra registrar um barato em
> serviços como Registro.br, Namecheap ou Cloudflare — e ele também serve
> pra hospedar o site (`FRONTEND_URL`) mais pra frente.

Sem `RESEND_API_KEY`/`RESEND_FROM_EMAIL` configurados, o backend simplesmente
não envia o e-mail (e avisa isso no log) — o resto da loja continua
funcionando normalmente.

---

## 6. Configurando o frete real por transportadora (Melhor Envio)

Além das regras de frete manuais (que você cadastra direto no painel admin,
na aba **Frete**), o backend pode cotar o frete de verdade — por peso,
dimensão e distância — usando o [Melhor Envio](https://melhorenvio.com.br),
que agrega Correios e transportadoras privadas (Jadlog, Azul Cargo etc) numa
única API.

**Como funciona a prioridade:** o checkout tenta o Melhor Envio primeiro. Se
ele não estiver configurado, falhar, ou nenhuma transportadora atender aquele
CEP, o sistema cai automaticamente nas regras manuais — o pedido nunca trava
por causa disso.

1. Crie uma conta em [melhorenvio.com.br](https://melhorenvio.com.br).
2. No painel, vá em **Configurações → Tokens de Acesso → Adicionar** e gere
   um token (esse método é mais simples que o fluxo completo de OAuth, e
   não expira a cada poucas horas).
3. Cole o token em `MELHOR_ENVIO_TOKEN` no `.env`.
4. Defina `MELHOR_ENVIO_FROM_CEP` com o CEP de onde os produtos saem (o seu
   ou o do seu fornecedor/estoque) — é a partir dele que a distância é
   calculada.
5. Enquanto estiver testando, deixe `MELHOR_ENVIO_SANDBOX=true` — isso usa o
   ambiente de testes do Melhor Envio (cotações fictícias, sem gerar nada
   real). Mude para `false` quando for para produção.

   > ⚠️ **Atenção:** produção e sandbox do Melhor Envio são **contas
   > separadas**, sem relação entre si. Um token gerado no painel normal
   > (`melhorenvio.com.br`) só funciona com `MELHOR_ENVIO_SANDBOX=false`. Pra
   > testar em sandbox de verdade, é preciso criar uma conta separada em
   > `sandbox.melhorenvio.com.br` e gerar um token lá.

6. Por padrão, o seguro declarado no frete é limitado a `MELHOR_ENVIO_MAX_INSURANCE`
   (R$100 por item, ajustável no `.env`) em vez do preço cheio do produto —
   isso evita que itens caros fiquem com frete alto só por causa do seguro
   embutido. Produtos mais baratos que o teto continuam sendo segurados pelo
   valor real deles.

**Peso e dimensões dos produtos:** no cadastro de cada produto (painel admin
→ Produtos), preencha peso (kg) e dimensões da embalagem (cm) — é isso que
a transportadora usa pra calcular o preço real. Produtos sem esses dados
usam um pacote pequeno padrão (16×11×2cm, 0.3kg), o que deixa a cotação
menos precisa para itens maiores ou mais pesados. A tabela de produtos no
admin mostra um aviso "Pacote padrão" nos que ainda faltam preencher.

Sem `MELHOR_ENVIO_TOKEN`/`MELHOR_ENVIO_FROM_CEP` configurados, o site usa só
as regras manuais — funciona normalmente, só não tem a cotação automática
por transportadora.

---

## 7. Hospedando de verdade (deploy)

Recomendo o **Render** (tem plano gratuito, é simples):

1. Crie uma conta em [render.com](https://render.com) e conecte seu GitHub.
2. Suba a pasta `backend/` para um repositório no GitHub (sem o arquivo `.env`).
3. No Render: **New → Web Service** → selecione o repositório.
4. Configurações:
   - **Build command:** deixe em branco (não há dependências para instalar)
   - **Start command:** `node server.js`
5. Em **Environment**, adicione as mesmas variáveis do seu `.env`:
   `PORT`, `PUBLIC_BASE_URL`, `FRONTEND_URL`, `JWT_SECRET`, `ADMIN_PASSWORD_HASH`, `MP_ACCESS_TOKEN`,
   `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `GOOGLE_CLIENT_ID`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `STORE_NAME`,
   `MELHOR_ENVIO_TOKEN`, `MELHOR_ENVIO_FROM_CEP`, `MELHOR_ENVIO_SANDBOX`, `MELHOR_ENVIO_MAX_INSURANCE`.
   - `PUBLIC_BASE_URL` deve ser a URL que o Render te dá (ex: `https://reitech-backend.onrender.com`)
   - `FRONTEND_URL` deve ser a URL onde seu site (o HTML) vai ficar hospedado.
6. Clique em **Deploy**.

Alternativas equivalentes: [Railway](https://railway.app) ou [Fly.io](https://fly.io).

> ⚠️ **Nota:** o plano gratuito do Render "dorme" depois de um tempo sem uso e o disco
> local (pasta `uploads/`, se ainda usada) é apagado a cada novo deploy — mas produtos,
> pedidos e clientes já ficam salvos no Supabase, então essa parte não se perde mais.

---

## 8. Conectando o site (frontend) a esse backend

No arquivo `index.html` da loja, defina a constante `API_BASE_URL` com a URL
do backend hospedado (ex: `https://reitech-backend.onrender.com`), e me avise
quando isso estiver no ar — eu adapto o restante do JavaScript da loja para
chamar essa API em vez do armazenamento local.

---

## 8.5. Configurando o login "Continuar com Google" (opcional)

Sem isso configurado, o botão do Google simplesmente não aparece na tela de
login — o cadastro/login normal por e-mail e senha continua funcionando
exatamente igual.

1. Acesse [console.cloud.google.com](https://console.cloud.google.com/) e crie
   um projeto (ou use um existente).
2. Vá em **APIs e serviços → Tela de consentimento OAuth** e configure o
   básico (nome do app, e-mail de suporte, logo se quiser). Pode deixar em
   modo "Externo" e "Em produção" quando estiver pronto.
3. Vá em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente
   OAuth** e escolha o tipo **Aplicativo da Web**.
4. Em **Origens JavaScript autorizadas**, adicione a URL do seu site (ex:
   `https://reitech.netlify.app`) e, se for testar localmente, também
   `http://localhost:5500` (ou a porta que você usa).
5. Copie o **ID do cliente** gerado (uma string longa terminada em
   `.apps.googleusercontent.com` — não é segredo, pode ficar exposta no
   site) e cole em **dois lugares**:
   - No `.env` do backend, na variável `GOOGLE_CLIENT_ID`.
   - No `index.html`, na constante `GOOGLE_CLIENT_ID` (perto do topo do
     `<script>`, junto com `API_BASE_URL`).

Quando um cliente entra com o Google pela primeira vez, uma conta é criada
automaticamente com o nome e e-mail da conta Google dele (sem senha própria).
Se esse e-mail já tinha uma conta cadastrada por senha, o login com Google
passa a funcionar nela também — não cria uma conta duplicada.

---

## 9. Estrutura das rotas da API

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| GET | `/api/health` | público | Verifica se o servidor está no ar |
| POST | `/api/auth/login` | público | Login do admin, retorna token |
| GET | `/api/products` | público | Lista produtos ativos |
| GET | `/api/admin/products` | admin | Lista todos os produtos |
| POST | `/api/admin/products` | admin | Cria produto |
| PUT | `/api/admin/products/:id` | admin | Edita produto |
| DELETE | `/api/admin/products/:id` | admin | Remove produto |
| POST | `/api/admin/upload` | admin | Envia imagem (base64) |
| POST | `/api/orders` | público (opcionalmente autenticado) | Cliente cria um pedido. Se enviado com o token de cliente, o pedido fica vinculado à conta e reaproveita nome/telefone/e-mail/endereço salvos quando não reenviados |
| GET | `/api/admin/orders` | admin | Lista pedidos |
| PUT | `/api/admin/orders/:id/status` | admin | Atualiza status do pedido |
| GET | `/api/admin/customers` | admin | Lista clientes (derivado dos pedidos) |
| POST | `/api/customers/signup` | público | Cliente cria uma conta (nome, e-mail, senha, telefone opcional) |
| POST | `/api/customers/login` | público | Login do cliente, retorna token válido por 30 dias |
| POST | `/api/customers/google` | público | Login/cadastro do cliente com a conta Google (cria a conta automaticamente na primeira vez) |
| GET | `/api/customers/me` | cliente | Retorna os dados da conta logada |
| PUT | `/api/customers/me` | cliente | Atualiza nome/telefone/endereço da conta |
| GET | `/api/customers/orders` | cliente | Histórico de pedidos da conta logada |
| POST | `/api/payments/create-preference` | público | Gera link de pagamento Mercado Pago |
| POST | `/api/payments/webhook` | Mercado Pago | Confirma pagamento automaticamente |
| POST | `/api/shipping/quote` | público | Cota o frete (Melhor Envio, com fallback pras regras manuais) pra um CEP + itens do carrinho |
| GET | `/api/admin/shipping-rules` | admin | Lista as regras de frete manuais |
| POST | `/api/admin/shipping-rules` | admin | Cria regra de frete (faixa de CEP, estado ou padrão) |
| PUT | `/api/admin/shipping-rules/:id` | admin | Edita regra de frete |
| DELETE | `/api/admin/shipping-rules/:id` | admin | Remove regra de frete |

Rotas marcadas como **admin** exigem o cabeçalho `Authorization: Bearer TOKEN_ADMIN`
(obtido em `/api/auth/login`). Rotas marcadas como **cliente** exigem
`Authorization: Bearer TOKEN_CLIENTE` (obtido em `/api/customers/login`,
`/api/customers/signup` ou `/api/customers/google`) — são tokens diferentes,
um não funciona no lugar do outro.

---

## 10. Contas de cliente — o que já está implementado

- Cadastro com nome, e-mail e senha (mínimo 8 caracteres). Telefone é opcional no cadastro.
- Login/cadastro em um clique com **"Continuar com Google"** (veja a seção 6.5
  para configurar) — cria a conta automaticamente na primeira vez, sem senha.
- E-mail duplicado é bloqueado (`409 Conflict`).
- Senha guardada com o mesmo hash seguro (`scrypt`) usado na senha do admin — nunca em texto puro.
- Token de sessão do cliente dura **30 dias** (o do admin dura 12h) — o cliente
  não precisa logar toda vez que visita o site, mas o token expira sozinho se
  ele nunca mais voltar.
- Limite de tentativas de login **separado** do limite do admin — um ataque de
  força bruta em um não trava o outro.
- Ao finalizar uma compra logado, o pedido fica automaticamente vinculado à
  conta e reaproveita nome/telefone/e-mail/endereço já salvos, sem pedir de novo.
- Quando o pagamento é aprovado, o cliente recebe um e-mail de confirmação
  automático com os itens, o total e o endereço de entrega (veja a seção 5).

---

## 11. Segurança — o que já está implementado

- Senha do admin nunca fica em texto puro: é guardada com hash `scrypt` (nativo do Node).
- Login gera um token assinado (HMAC-SHA256) que expira em 12 horas.
- Limite de tentativas de login por IP (proteção contra força bruta).
- O preço de cada item do pedido é **sempre recalculado no servidor** a partir do
  catálogo — o navegador do cliente nunca é a fonte da verdade do preço, evitando fraude.
- CORS restrito à URL do seu frontend (configurável em `FRONTEND_URL`).
