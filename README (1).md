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

## 5. Hospedando de verdade (deploy)

Recomendo o **Render** (tem plano gratuito, é simples):

1. Crie uma conta em [render.com](https://render.com) e conecte seu GitHub.
2. Suba a pasta `backend/` para um repositório no GitHub (sem o arquivo `.env`).
3. No Render: **New → Web Service** → selecione o repositório.
4. Configurações:
   - **Build command:** deixe em branco (não há dependências para instalar)
   - **Start command:** `node server.js`
5. Em **Environment**, adicione as mesmas variáveis do seu `.env`:
   `PORT`, `PUBLIC_BASE_URL`, `FRONTEND_URL`, `JWT_SECRET`, `ADMIN_PASSWORD_HASH`, `MP_ACCESS_TOKEN`.
   - `PUBLIC_BASE_URL` deve ser a URL que o Render te dá (ex: `https://reitech-backend.onrender.com`)
   - `FRONTEND_URL` deve ser a URL onde seu site (o HTML) vai ficar hospedado.
6. Clique em **Deploy**.

Alternativas equivalentes: [Railway](https://railway.app) ou [Fly.io](https://fly.io).

> ⚠️ **Importante:** o plano gratuito do Render "dorme" depois de um tempo sem uso e o
> armazenamento em arquivo (`data/`, `uploads/`) pode ser apagado a cada novo deploy.
> Para uma loja em produção de verdade, quando o volume de vendas crescer, o próximo
> passo é migrar esse armazenamento para um banco de dados gerenciado (ex: Postgres no
> próprio Render) — posso te ajudar a fazer essa migração quando chegar a hora.

---

## 6. Conectando o site (frontend) a esse backend

No arquivo `index.html` da loja, defina a constante `API_BASE_URL` com a URL
do backend hospedado (ex: `https://reitech-backend.onrender.com`), e me avise
quando isso estiver no ar — eu adapto o restante do JavaScript da loja para
chamar essa API em vez do armazenamento local.

---

## 6.5. Configurando o login "Continuar com Google" (opcional)

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

## 7. Estrutura das rotas da API

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

Rotas marcadas como **admin** exigem o cabeçalho `Authorization: Bearer TOKEN_ADMIN`
(obtido em `/api/auth/login`). Rotas marcadas como **cliente** exigem
`Authorization: Bearer TOKEN_CLIENTE` (obtido em `/api/customers/login`,
`/api/customers/signup` ou `/api/customers/google`) — são tokens diferentes,
um não funciona no lugar do outro.

---

## 8. Contas de cliente — o que já está implementado

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

---

## 9. Segurança — o que já está implementado

- Senha do admin nunca fica em texto puro: é guardada com hash `scrypt` (nativo do Node).
- Login gera um token assinado (HMAC-SHA256) que expira em 12 horas.
- Limite de tentativas de login por IP (proteção contra força bruta).
- O preço de cada item do pedido é **sempre recalculado no servidor** a partir do
  catálogo — o navegador do cliente nunca é a fonte da verdade do preço, evitando fraude.
- CORS restrito à URL do seu frontend (configurável em `FRONTEND_URL`).
