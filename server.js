require("./lib/env")(); // carrega variáveis do .env, sem dependência externa
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const { Router } = require("./lib/router");
const store = require("./lib/store");
const auth = require("./lib/auth");
const mercadopago = require("./lib/mercadopago");
const cloudinary = require("./lib/cloudinary");

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const FRONTEND_URL = process.env.FRONTEND_URL || "*";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const CUSTOMER_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 dias — cliente espera continuar logado ao voltar

if (!JWT_SECRET || !ADMIN_PASSWORD_HASH) {
  console.error(
    "\n[ERRO] Configure o arquivo .env antes de iniciar o servidor.\n" +
    "Veja .env.example e rode: npm run hash-password -- \"suaSenha\"\n"
  );
  process.exit(1);
}

const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const DEFAULT_PRODUCTS = [
  { id: "p1", name: "Fone Bluetooth 5.3 Pro", description: "Cancelamento de ruído ativo, até 30h de bateria e conexão dual.", specs: ["Bluetooth 5.3", "Até 30h de bateria", "Cancelamento de ruído ativo"], image: "", price: 299, promoPrice: null, category: "proprio", badge: "Mais vendido", active: true },
  { id: "p2", name: "Carregador Turbo 30W", description: "Carga rápida USB-C com proteção contra sobrecarga e superaquecimento.", specs: ["Potência de 30W", "Entrada USB-C"], image: "", price: 79, promoPrice: null, category: "proprio", badge: "", active: true }
];

// ---- Rate limiting simples para login (evita força bruta) ----
const loginAttempts = new Map(); // ip -> { count, resetAt }
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  entry.count++;
  return entry.count <= 8; // máx. 8 tentativas a cada 10 minutos por IP
}

// Rate limit isolado para clientes — um ataque de força bruta no login de
// clientes não deve consumir/afetar o limite do login do admin, e vice-versa.
const customerLoginAttempts = new Map();
function checkCustomerRateLimit(ip) {
  const now = Date.now();
  const entry = customerLoginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    customerLoginAttempts.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  entry.count++;
  return entry.count <= 8;
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": FRONTEND_URL,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
  });
  res.end(JSON.stringify(data));
}

function requireAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = auth.verify(token, JWT_SECRET);
  if (!payload || payload.role !== "admin") {
    json(res, 401, { error: "Não autorizado. Faça login novamente." });
    return;
  }
  next();
}

function requireCustomerAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = auth.verify(token, JWT_SECRET);
  if (!payload || payload.role !== "customer") {
    json(res, 401, { error: "Sessão expirada. Faça login novamente." });
    return;
  }
  req.customerId = payload.customerId;
  next();
}

// Usado em rotas públicas (como criar pedido) que se comportam diferente
// quando existe um cliente logado, mas não devem travar se não existir.
function getOptionalCustomerId(req) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = auth.verify(token, JWT_SECRET);
  return payload && payload.role === "customer" ? payload.customerId : null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicCustomer(c) {
  // Nunca devolve passwordHash para o navegador.
  const { passwordHash, ...rest } = c;
  return rest;
}

const router = new Router();

// ---- Health check ----
router.get("/api/health", (req, res) => json(res, 200, { ok: true, storage: store.USE_SUPABASE ? "supabase" : "arquivo-local" }));

// ---- Auth ----
router.post("/api/auth/login", (req, res) => {
  const ip = req.socket.remoteAddress || "unknown";
  if (!checkRateLimit(ip)) {
    return json(res, 429, { error: "Muitas tentativas. Aguarde alguns minutos." });
  }
  const { password } = req.body || {};
  if (!password || !auth.verifyPassword(password, ADMIN_PASSWORD_HASH)) {
    return json(res, 401, { error: "Senha incorreta." });
  }
  const token = auth.sign({ role: "admin" }, JWT_SECRET);
  json(res, 200, { token });
});

// ---- Produtos (público) ----
router.get("/api/products", async (req, res) => {
  const products = await store.readJSON("products.json", DEFAULT_PRODUCTS);
  json(res, 200, products.filter((p) => p.active !== false));
});

// ---- Produtos (admin) ----
router.get("/api/admin/products", requireAuth, async (req, res) => {
  const products = await store.readJSON("products.json", DEFAULT_PRODUCTS);
  json(res, 200, products);
});

router.post("/api/admin/products", requireAuth, async (req, res) => {
  const products = await store.readJSON("products.json", DEFAULT_PRODUCTS);
  const p = req.body || {};
  if (!p.name || p.price === undefined) {
    return json(res, 400, { error: "Nome e preço são obrigatórios." });
  }
  const product = {
    id: "p_" + crypto.randomBytes(6).toString("hex"),
    name: String(p.name).trim(),
    description: String(p.description || "").trim(),
    specs: Array.isArray(p.specs) ? p.specs : [],
    image: String(p.image || ""),
    price: Number(p.price),
    promoPrice: p.promoPrice ? Number(p.promoPrice) : null,
    category: p.category === "dropship" ? "dropship" : "proprio",
    categoryId: p.categoryId ? String(p.categoryId) : null,
    badge: String(p.badge || ""),
    active: p.active !== false
  };
  products.push(product);
  await store.writeJSON("products.json", products);
  json(res, 201, product);
});

router.put("/api/admin/products/:id", requireAuth, async (req, res) => {
  const products = await store.readJSON("products.json", DEFAULT_PRODUCTS);
  const idx = products.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return json(res, 404, { error: "Produto não encontrado." });
  const p = req.body || {};
  products[idx] = {
    ...products[idx],
    name: p.name !== undefined ? String(p.name).trim() : products[idx].name,
    description: p.description !== undefined ? String(p.description).trim() : products[idx].description,
    specs: Array.isArray(p.specs) ? p.specs : products[idx].specs,
    image: p.image !== undefined ? String(p.image) : products[idx].image,
    price: p.price !== undefined ? Number(p.price) : products[idx].price,
    promoPrice: p.promoPrice !== undefined ? (p.promoPrice ? Number(p.promoPrice) : null) : products[idx].promoPrice,
    category: p.category !== undefined ? (p.category === "dropship" ? "dropship" : "proprio") : products[idx].category,
    categoryId: p.categoryId !== undefined ? (p.categoryId ? String(p.categoryId) : null) : products[idx].categoryId,
    badge: p.badge !== undefined ? String(p.badge) : products[idx].badge,
    active: p.active !== undefined ? Boolean(p.active) : products[idx].active
  };
  await store.writeJSON("products.json", products);
  json(res, 200, products[idx]);
});

router.delete("/api/admin/products/:id", requireAuth, async (req, res) => {
  let products = await store.readJSON("products.json", DEFAULT_PRODUCTS);
  const exists = products.some((x) => x.id === req.params.id);
  if (!exists) return json(res, 404, { error: "Produto não encontrado." });
  products = products.filter((x) => x.id !== req.params.id);
  await store.writeJSON("products.json", products);
  json(res, 200, { deleted: true });
});

// ---- Categorias (setores/seções de produtos, criadas livremente pelo admin) ----
router.get("/api/categories", async (req, res) => {
  const categories = await store.readJSON("categories.json", []);
  json(res, 200, categories);
});

router.get("/api/admin/categories", requireAuth, async (req, res) => {
  const categories = await store.readJSON("categories.json", []);
  json(res, 200, categories);
});

router.post("/api/admin/categories", requireAuth, async (req, res) => {
  const categories = await store.readJSON("categories.json", []);
  const name = String((req.body || {}).name || "").trim();
  if (!name) return json(res, 400, { error: "Nome da categoria é obrigatório." });
  if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return json(res, 400, { error: "Já existe uma categoria com esse nome." });
  }
  const category = { id: "cat_" + crypto.randomBytes(6).toString("hex"), name };
  categories.push(category);
  await store.writeJSON("categories.json", categories);
  json(res, 201, category);
});

router.put("/api/admin/categories/:id", requireAuth, async (req, res) => {
  const categories = await store.readJSON("categories.json", []);
  const idx = categories.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return json(res, 404, { error: "Categoria não encontrada." });
  const name = String((req.body || {}).name || "").trim();
  if (!name) return json(res, 400, { error: "Nome da categoria é obrigatório." });
  if (categories.some((c) => c.id !== req.params.id && c.name.toLowerCase() === name.toLowerCase())) {
    return json(res, 400, { error: "Já existe uma categoria com esse nome." });
  }
  categories[idx].name = name;
  await store.writeJSON("categories.json", categories);
  json(res, 200, categories[idx]);
});

router.delete("/api/admin/categories/:id", requireAuth, async (req, res) => {
  let categories = await store.readJSON("categories.json", []);
  const exists = categories.some((c) => c.id === req.params.id);
  if (!exists) return json(res, 404, { error: "Categoria não encontrada." });
  categories = categories.filter((c) => c.id !== req.params.id);
  await store.writeJSON("categories.json", categories);
  // Produtos que usavam essa categoria ficam "sem categoria" — nunca sobra uma
  // referência pra uma categoria que não existe mais.
  const products = await store.readJSON("products.json", DEFAULT_PRODUCTS);
  let changed = false;
  products.forEach((p) => {
    if (p.categoryId === req.params.id) { p.categoryId = null; changed = true; }
  });
  if (changed) await store.writeJSON("products.json", products);
  json(res, 200, { deleted: true });
});

// ---- Banners (carrossel de destaques/promoções na loja) ----
router.get("/api/banners", async (req, res) => {
  const banners = await store.readJSON("banners.json", []);
  json(res, 200, banners.filter((b) => b.active !== false));
});

router.get("/api/admin/banners", requireAuth, async (req, res) => {
  const banners = await store.readJSON("banners.json", []);
  json(res, 200, banners);
});

router.post("/api/admin/banners", requireAuth, async (req, res) => {
  const banners = await store.readJSON("banners.json", []);
  const b = req.body || {};
  if (!b.image) return json(res, 400, { error: "A imagem do banner é obrigatória." });
  const banner = {
    id: "ban_" + crypto.randomBytes(6).toString("hex"),
    image: String(b.image),
    title: String(b.title || "").trim(),
    subtitle: String(b.subtitle || "").trim(),
    link: String(b.link || "").trim(),
    active: b.active !== false
  };
  banners.push(banner);
  await store.writeJSON("banners.json", banners);
  json(res, 201, banner);
});

// Precisa vir ANTES de "/api/admin/banners/:id" — o roteador é simples e usa a
// primeira rota que bater na forma do caminho, então uma rota estática
// registrada depois de uma rota com :id nunca seria alcançada.
router.put("/api/admin/banners/reorder", requireAuth, async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return json(res, 400, { error: "Lista de ids inválida." });
  const banners = await store.readJSON("banners.json", []);
  const byId = Object.fromEntries(banners.map((b) => [b.id, b]));
  const reordered = ids.map((id) => byId[id]).filter(Boolean);
  banners.forEach((b) => { if (!ids.includes(b.id)) reordered.push(b); });
  await store.writeJSON("banners.json", reordered);
  json(res, 200, reordered);
});

router.put("/api/admin/banners/:id", requireAuth, async (req, res) => {
  const banners = await store.readJSON("banners.json", []);
  const idx = banners.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return json(res, 404, { error: "Banner não encontrado." });
  const b = req.body || {};
  banners[idx] = {
    ...banners[idx],
    image: b.image !== undefined ? String(b.image) : banners[idx].image,
    title: b.title !== undefined ? String(b.title).trim() : banners[idx].title,
    subtitle: b.subtitle !== undefined ? String(b.subtitle).trim() : banners[idx].subtitle,
    link: b.link !== undefined ? String(b.link).trim() : banners[idx].link,
    active: b.active !== undefined ? Boolean(b.active) : banners[idx].active
  };
  await store.writeJSON("banners.json", banners);
  json(res, 200, banners[idx]);
});

router.delete("/api/admin/banners/:id", requireAuth, async (req, res) => {
  let banners = await store.readJSON("banners.json", []);
  const exists = banners.some((x) => x.id === req.params.id);
  if (!exists) return json(res, 404, { error: "Banner não encontrado." });
  banners = banners.filter((x) => x.id !== req.params.id);
  await store.writeJSON("banners.json", banners);
  json(res, 200, { deleted: true });
});

// ---- Upload de imagem (admin) ----
// Recebe { imageBase64: "data:image/jpeg;base64,...." } já comprimida pelo navegador
// e envia para o Cloudinary, que guarda a imagem de forma permanente
// (arquivos salvos localmente no Render são apagados a cada novo deploy/restart).
router.post("/api/admin/upload", requireAuth, async (req, res) => {
  const { imageBase64 } = req.body || {};
  if (!imageBase64 || !imageBase64.startsWith("data:image/")) {
    return json(res, 400, { error: "Imagem inválida." });
  }
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return json(res, 500, { error: "Upload de imagem não configurado no servidor (faltam as credenciais do Cloudinary)." });
  }
  const approxBytes = imageBase64.length * 0.75;
  if (approxBytes > 6 * 1024 * 1024) {
    return json(res, 400, { error: "Imagem muito grande (máx. 6MB)." });
  }
  try {
    const url = await cloudinary.uploadImage(imageBase64, {
      cloudName: CLOUDINARY_CLOUD_NAME,
      apiKey: CLOUDINARY_API_KEY,
      apiSecret: CLOUDINARY_API_SECRET
    });
    json(res, 201, { url });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

// ---- Contas de cliente ----
router.post("/api/customers/signup", async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !email || !password) {
    return json(res, 400, { error: "Nome, e-mail e senha são obrigatórios." });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  if (!EMAIL_REGEX.test(cleanEmail)) {
    return json(res, 400, { error: "E-mail inválido." });
  }
  if (String(password).length < 8) {
    return json(res, 400, { error: "A senha precisa ter pelo menos 8 caracteres." });
  }
  const customers = await store.readJSON("customers.json", []);
  if (customers.some((c) => c.email === cleanEmail)) {
    return json(res, 409, { error: "Já existe uma conta com esse e-mail." });
  }
  const customer = {
    id: "cus_" + crypto.randomBytes(6).toString("hex"),
    name: String(name).trim(),
    email: cleanEmail,
    phone: String(phone || "").trim(),
    address: "",
    passwordHash: auth.hashPassword(String(password)),
    createdAt: new Date().toISOString()
  };
  customers.push(customer);
  await store.writeJSON("customers.json", customers);
  const token = auth.sign({ role: "customer", customerId: customer.id }, JWT_SECRET, CUSTOMER_TOKEN_TTL);
  json(res, 201, { token, customer: publicCustomer(customer) });
});

router.post("/api/customers/login", async (req, res) => {
  const ip = req.socket.remoteAddress || "unknown";
  if (!checkCustomerRateLimit(ip)) {
    return json(res, 429, { error: "Muitas tentativas. Aguarde alguns minutos." });
  }
  const { email, password } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();
  const customers = await store.readJSON("customers.json", []);
  const customer = customers.find((c) => c.email === cleanEmail);
  if (!customer || !auth.verifyPassword(String(password || ""), customer.passwordHash)) {
    return json(res, 401, { error: "E-mail ou senha incorretos." });
  }
  const token = auth.sign({ role: "customer", customerId: customer.id }, JWT_SECRET, CUSTOMER_TOKEN_TTL);
  json(res, 200, { token, customer: publicCustomer(customer) });
});

router.get("/api/customers/me", requireCustomerAuth, async (req, res) => {
  const customers = await store.readJSON("customers.json", []);
  const customer = customers.find((c) => c.id === req.customerId);
  if (!customer) return json(res, 404, { error: "Conta não encontrada." });
  json(res, 200, publicCustomer(customer));
});

router.put("/api/customers/me", requireCustomerAuth, async (req, res) => {
  const customers = await store.readJSON("customers.json", []);
  const idx = customers.findIndex((c) => c.id === req.customerId);
  if (idx === -1) return json(res, 404, { error: "Conta não encontrada." });
  const p = req.body || {};
  if (p.name !== undefined) customers[idx].name = String(p.name).trim();
  if (p.phone !== undefined) customers[idx].phone = String(p.phone).trim();
  if (p.address !== undefined) customers[idx].address = String(p.address).trim();
  await store.writeJSON("customers.json", customers);
  json(res, 200, publicCustomer(customers[idx]));
});

router.get("/api/customers/orders", requireCustomerAuth, async (req, res) => {
  const orders = await store.readJSON("orders.json", []);
  const mine = orders
    .filter((o) => o.customerId === req.customerId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  json(res, 200, mine);
});

// ---- Pedidos ----
router.post("/api/orders", async (req, res) => {
  const { customer, items } = req.body || {};

  // Se o cliente estiver logado, usamos os dados salvos da conta como
  // reserva para qualquer campo que não venha preenchido no corpo da
  // requisição — o padrão "Amazon" de não pedir tudo de novo a cada compra.
  const customerId = getOptionalCustomerId(req);
  let savedCustomer = null;
  if (customerId) {
    const customers = await store.readJSON("customers.json", []);
    savedCustomer = customers.find((c) => c.id === customerId) || null;
  }

  const resolvedCustomer = {
    name: (customer && customer.name) || (savedCustomer && savedCustomer.name) || "",
    phone: (customer && customer.phone) || (savedCustomer && savedCustomer.phone) || "",
    email: (customer && customer.email) || (savedCustomer && savedCustomer.email) || "",
    address: (customer && customer.address) || (savedCustomer && savedCustomer.address) || ""
  };

  if (!resolvedCustomer.name || !resolvedCustomer.phone || !Array.isArray(items) || items.length === 0) {
    return json(res, 400, { error: "Dados do pedido incompletos." });
  }
  const products = await store.readJSON("products.json", DEFAULT_PRODUCTS);
  // Recalcula o total no servidor a partir do preço real do produto —
  // nunca confiar no preço enviado pelo navegador.
  let total = 0;
  const resolvedItems = [];
  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) continue;
    const hasPromo = product.promoPrice && Number(product.promoPrice) < Number(product.price);
    const unitPrice = hasPromo ? Number(product.promoPrice) : Number(product.price);
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    total += unitPrice * qty;
    resolvedItems.push({ productId: product.id, name: product.name, price: unitPrice, qty });
  }
  if (resolvedItems.length === 0) return json(res, 400, { error: "Nenhum item válido no pedido." });

  const orders = await store.readJSON("orders.json", []);
  const order = {
    id: "ord_" + crypto.randomBytes(6).toString("hex"),
    date: new Date().toISOString(),
    customerId: customerId || null,
    customer: {
      name: String(resolvedCustomer.name).trim(),
      phone: String(resolvedCustomer.phone).trim(),
      email: String(resolvedCustomer.email || "").trim(),
      address: String(resolvedCustomer.address || "").trim()
    },
    items: resolvedItems,
    total,
    status: "pendente"
  };
  orders.push(order);
  await store.writeJSON("orders.json", orders);
  json(res, 201, order);
});

router.get("/api/admin/orders", requireAuth, async (req, res) => {
  const orders = await store.readJSON("orders.json", []);
  json(res, 200, orders);
});

// Consulta pública e enxuta de um pedido específico. Usada pelo site para
// descobrir se um pedido pendente já foi pago quando o cliente volta à loja
// depois de sair da tela de pagamento (sem passar pelo redirecionamento
// automático). Nunca devolve os dados do cliente — só o essencial.
router.get("/api/orders/:id", async (req, res) => {
  const orders = await store.readJSON("orders.json", []);
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return json(res, 404, { error: "Pedido não encontrado." });
  json(res, 200, {
    id: order.id,
    status: order.status,
    total: order.total,
    items: order.items,
    date: order.date
  });
});

router.put("/api/admin/orders/:id/status", requireAuth, async (req, res) => {
  const orders = await store.readJSON("orders.json", []);
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return json(res, 404, { error: "Pedido não encontrado." });
  const allowed = ["pendente", "confirmado", "enviado", "entregue", "cancelado"];
  if (!allowed.includes(req.body.status)) return json(res, 400, { error: "Status inválido." });
  order.status = req.body.status;
  await store.writeJSON("orders.json", orders);
  json(res, 200, order);
});

router.get("/api/admin/customers", requireAuth, async (req, res) => {
  const orders = await store.readJSON("orders.json", []);
  const map = {};
  orders.forEach((o) => {
    const key = (o.customer.phone || o.customer.email || o.customer.name).toLowerCase();
    if (!map[key]) map[key] = { name: o.customer.name, phone: o.customer.phone, email: o.customer.email, orders: 0, total: 0 };
    map[key].orders++;
    map[key].total += Number(o.total || 0);
  });
  json(res, 200, Object.values(map).sort((a, b) => b.total - a.total));
});

// ---- Pagamentos (Mercado Pago) ----
router.post("/api/payments/create-preference", async (req, res) => {
  if (!MP_ACCESS_TOKEN) return json(res, 500, { error: "Mercado Pago não configurado no servidor (falta MP_ACCESS_TOKEN)." });
  const { orderId } = req.body || {};
  const orders = await store.readJSON("orders.json", []);
  const order = orders.find((o) => o.id === orderId);
  if (!order) return json(res, 404, { error: "Pedido não encontrado." });

  // FRONTEND_URL só serve para montar os links de retorno se for uma URL de
  // verdade (http/https). Se estiver como "*" (comum enquanto se ajusta o CORS),
  // simplesmente não mandamos back_urls — o pagamento continua funcionando,
  // só sem o redirecionamento automático de volta pro site.
  const validFrontend = /^https?:\/\//.test(FRONTEND_URL || "");
  const backUrls = validFrontend ? {
    success: `${FRONTEND_URL}/#pedido-confirmado`,
    pending: `${FRONTEND_URL}/#pedido-pendente`,
    failure: `${FRONTEND_URL}/#pedido-falhou`
  } : null;

  try {
    const pref = await mercadopago.createPreference({
      order,
      accessToken: MP_ACCESS_TOKEN,
      backUrls,
      notificationUrl: `${PUBLIC_BASE_URL}/api/payments/webhook`
    });
    order.mpPreferenceId = pref.id;
    await store.writeJSON("orders.json", orders);
    json(res, 200, { init_point: pref.init_point, preferenceId: pref.id });
  } catch (e) {
    json(res, 500, { error: "Erro do Mercado Pago: " + e.message });
  }
});

router.post("/api/payments/webhook", async (req, res) => {
  // O Mercado Pago pode notificar por querystring (?topic=payment&id=123) ou no corpo (data.id)
  const paymentId = req.query.id || req.query["data.id"] || (req.body && req.body.data && req.body.data.id);
  if (!paymentId || !MP_ACCESS_TOKEN) return json(res, 200, { received: true });

  try {
    const payment = await mercadopago.getPayment(paymentId, MP_ACCESS_TOKEN);
    const orderId = payment.external_reference;
    if (orderId && payment.status === "approved") {
      const orders = await store.readJSON("orders.json", []);
      const order = orders.find((o) => o.id === orderId);
      if (order && order.status === "pendente") {
        order.status = "confirmado";
        order.paymentId = payment.id;
        await store.writeJSON("orders.json", orders);
      }
    }
  } catch (e) {
    console.error("Erro no webhook do Mercado Pago:", e.message);
  }
  json(res, 200, { received: true });
});

// ---- Servidor HTTP ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": FRONTEND_URL,
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
    });
    return res.end();
  }

  // Arquivos de upload servidos estaticamente
  if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
    const filePath = path.join(UPLOADS_DIR, path.basename(url.pathname));
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).slice(1);
      const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Access-Control-Allow-Origin": FRONTEND_URL });
      return fs.createReadStream(filePath).pipe(res);
    }
    res.writeHead(404);
    return res.end();
  }

  try {
    const handled = await router.handle(req, res, url);
    if (!handled) {
      json(res, 404, { error: "Rota não encontrada." });
    }
  } catch (e) {
    console.error("Erro não tratado numa rota:", e);
    if (!res.headersSent) json(res, 500, { error: "Erro interno do servidor." });
  }
});

server.listen(PORT, () => {
  console.log(`REI TECH backend rodando em ${PUBLIC_BASE_URL} (porta ${PORT})`);
  console.log(`Armazenamento: ${store.USE_SUPABASE ? "Supabase (permanente)" : "arquivo local (some a cada deploy no Render!)"}`);
});