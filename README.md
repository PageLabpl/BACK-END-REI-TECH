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

## 2. Configurando o Mercado Pago

1. Crie uma conta em [mercadopago.com.br/developers](https://www.mercadopago.com.br/developers).
2. No painel, vá em **Suas integrações → Credenciais de produção**.
3. Copie o **Access Token de produção** e cole em `MP_ACCESS_TOKEN` no `.env`.
4. Enquanto estiver testando, use as **credenciais de teste** em vez das de produção.

O backend já expõe:
- `POST /api/payments/create-preference` — o frontend chama isso depois de criar o pedido, recebe um link de pagamento (`init_point`) e redireciona o cliente para lá.
- `POST /api/payments/webhook` — o Mercado Pago chama essa URL automaticamente quando o pagamento é aprovado. O backend confirma o pedido sozinho.

---

## 3. Hospedando de verdade (deploy)

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

## 4. Conectando o site (frontend) a esse backend

No arquivo `index.html` da loja, defina a constante `API_BASE_URL` com a URL
do backend hospedado (ex: `https://reitech-backend.onrender.com`), e me avise
quando isso estiver no ar — eu adapto o restante do JavaScript da loja para
chamar essa API em vez do armazenamento local.

---

## 5. Estrutura das rotas da API

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
| POST | `/api/orders` | público | Cliente cria um pedido |
| GET | `/api/admin/orders` | admin | Lista pedidos |
| PUT | `/api/admin/orders/:id/status` | admin | Atualiza status do pedido |
| GET | `/api/admin/customers` | admin | Lista clientes (derivado dos pedidos) |
| POST | `/api/payments/create-preference` | público | Gera link de pagamento Mercado Pago |
| POST | `/api/payments/webhook` | Mercado Pago | Confirma pagamento automaticamente |

Rotas marcadas como **admin** exigem o cabeçalho:
`Authorization: Bearer SEU_TOKEN` (obtido no login).

---

## 6. Segurança — o que já está implementado

- Senha do admin nunca fica em texto puro: é guardada com hash `scrypt` (nativo do Node).
- Login gera um token assinado (HMAC-SHA256) que expira em 12 horas.
- Limite de tentativas de login por IP (proteção contra força bruta).
- O preço de cada item do pedido é **sempre recalculado no servidor** a partir do
  catálogo — o navegador do cliente nunca é a fonte da verdade do preço, evitando fraude.
- CORS restrito à URL do seu frontend (configurável em `FRONTEND_URL`).
