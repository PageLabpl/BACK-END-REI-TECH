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
const email = require("./lib/email");

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const FRONTEND_URL = process.env.FRONTEND_URL || "*";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;
const STORE_NAME = process.env.STORE_NAME || "REI TECH";

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
  { id: "p1", name: "Fone Bluetooth 5.3 Pro", description: "Cancelamento de ruído ativo, até 30h de bateria e conexão dual.", specs: ["Bluetooth 5.3", "Até 30h de bateria", "Cancelamento de ruído ativo"], image: "", price: 299, promoPrice: null, category: "proprio", section: "perifericos", badge: "Mais vendido", active: true },
  { id: "p2", name: "Carregador Turbo 30W", description: "Carga rápida USB-C com proteção contra sobrecarga e superaquecimento.", specs: ["Potência de 30W", "Entrada USB-C"], image: "", price: 79, promoPrice: null, category: "proprio", section: "acessorios", badge: "", active: true }
];

// Seções padrão (usadas na primeira vez que o site rodar; depois disso o
// admin pode adicionar/remover seções pelo próprio painel).
const DEFAULT_SECTIONS = [
  { id: "informatica", name: "Informática" },
  { id: "perifericos", name: "Periféricos" },
  { id: "impressoras", name: "Impressoras" },
  { id: "seguranca-eletronica", name: "Segurança Eletrônica" },
  { id: "redes", name: "Redes" },
  { id: "audio-video", name: "Áudio & Vídeo" },
  { id: "acessorios", name: "Acessórios" }
];

// ---- Rate limiting simples para login (evita força bruta) ----
const loginAttempts = new Map(); // "ip:tipo" -> { count, resetAt }
function checkRateLimit(key, max = 8) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  entry.count++;
  return entry.count <= max; // máx. tentativas a cada 10 minutos
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

// Exige que o cliente esteja logado (usado nas rotas "minha conta").
function requireCustomer(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = auth.verify(token, JWT_SECRET);
  if (!payload || payload.role !== "customer") {
    json(res, 401, { error: "Faça login para continuar." });
    return;
  }
  req.customerId = payload.id;
  next();
}

// Tenta identificar um cliente logado sem bloquear a rota se não houver
// token (usado em /api/orders — funciona tanto logado quanto como convidado).
function getOptionalCustomerId(req) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = auth.verify(token, JWT_SECRET);
  return payload && payload.role === "customer" ? payload.id : null;
}

function publicCustomer(c) {
  // Nunca devolve passwordHash pro frontend.
  const { passwordHash, ...rest } = c;
  return rest;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const router = new Router();

// ---- Health check ----
router.get("/api/health", (req, res) => json(res, 200, { ok: true }));

// ---- Auth do admin ----
router.post("/api/auth/login", (req, res) => {
  const ip = req.socket.remoteAddress || "unknown";
  if (!checkRateLimit(`admin:${ip}`)) {
    return json(res, 429, { error: "Muitas tentativas. Aguarde alguns minutos." });
  }
  const { password } = req.body || {};
  if (!password || !auth.verifyPassword(password, ADMIN_PASSWORD_HASH)) {
    return json(res, 401, { error: "Senha incorreta." });
  }
  const token = auth.sign({ role: "admin" }, JWT_SECRET);
  json(res, 200, { token });
});

// ==================== CONTA DO CLIENTE ====================

router.post("/api/customers/register", async (req, res) => {
  const ip = req.socket.remoteAddress || "unknown";
  if (!checkRateLimit(`register:${ip}`, 15)) {
    return json(res, 429, { error: "Muitas tentativas. Aguarde alguns minutos." });
  }
  const b = req.body || {};
  const name = String(b.name || "").trim();
  const email = String(b.email || "").trim().toLowerCase();
  const phone = String(b.phone || "").trim();
  const password = String(b.password || "");

  if (!name || !email || !phone || !password) {
    return json(res, 400, { error: "Preencha nome, e-mail, telefone e senha." });
  }
  if (!EMAIL_RE.test(email)) return json(res, 400, { error: "E-mail inválido." });
  if (password.length < 6) return json(res, 400, { error: "A senha precisa ter pelo menos 6 caracteres." });

  const customers = await store.readJSON("customers.json", []);
  if (customers.some((c) => c.email === email)) {
    return json(res, 409, { error: "Já existe uma conta com esse e-mail." });
  }

  const customer = {
    id: "cus_" + crypto.randomBytes(6).toString("hex"),
    name,
    email,
    phone,
    address: String(b.address || "").trim(),
    receiveOffers: b.receiveOffers !== false,
    passwordHash: auth.hashPassword(password),
    createdAt: new Date().toISOString()
  };
  customers.push(customer);
  await store.writeJSON("customers.json", customers);

  const token = auth.sign({ role: "customer", id: customer.id }, JWT_SECRET);
  json(res, 201, { token, customer: publicCustomer(customer) });
});

router.post("/api/customers/login", async (req, res) => {
  const ip = req.socket.remoteAddress || "unknown";
  if (!checkRateLimit(`custlogin:${ip}`)) {
    return json(res, 429, { error: "Muitas tentativas. Aguarde alguns minutos." });
  }
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  const password = String((req.body || {}).password || "");
  const customers = await store.readJSON("customers.json", []);
  const customer = customers.find((c) => c.email === email);
  if (!customer || !auth.verifyPassword(password, customer.passwordHash)) {
    return json(res, 401, { error: "E-mail ou senha incorretos." });
  }
  const token = auth.sign({ role: "customer", id: customer.id }, JWT_SECRET);
  json(res, 200, { token, customer: publicCustomer(customer) });
});

router.get("/api/customers/me", requireCustomer, async (req, res) => {
  const customers = await store.readJSON("customers.json", []);
  const customer = customers.find((c) => c.id === req.customerId);
  if (!customer) return json(res, 404, { error: "Conta não encontrada." });
  json(res, 200, publicCustomer(customer));
});

router.put("/api/customers/me", requireCustomer, async (req, res) => {
  const customers = await store.readJSON("customers.json", []);
  const idx = customers.findIndex((c) => c.id === req.customerId);
  if (idx === -1) return json(res, 404, { error: "Conta não encontrada." });
  const b = req.body || {};
  customers[idx] = {
    ...customers[idx],
    name: b.name !== undefined ? String(b.name).trim() : customers[idx].name,
    phone: b.phone !== undefined ? String(b.phone).trim() : customers[idx].phone,
    address: b.address !== undefined ? String(b.address).trim() : customers[idx].address,
    receiveOffers: b.receiveOffers !== undefined ? Boolean(b.receiveOffers) : customers[idx].receiveOffers
  };
  if (b.password) {
    if (String(b.password).length < 6) return json(res, 400, { error: "A nova senha precisa ter pelo menos 6 caracteres." });
    customers[idx].passwordHash = auth.hashPassword(String(b.password));
  }
  await store.writeJSON("customers.json", customers);
  json(res, 200, publicCustomer(customers[idx]));
});

router.get("/api/customers/me/orders", requireCustomer, async (req, res) => {
  const orders = await store.readJSON("orders.json", []);
  const mine = orders
    .filter((o) => o.customerId === req.customerId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  json(res, 200, mine);
});

// ==================== SEÇÕES DE PRODUTO ====================

router.get("/api/sections", async (req, res) => {
  const sections = await store.readJSON("sections.json", DEFAULT_SECTIONS);
  json(res, 200, sections);
});

router.post("/api/admin/sections", requireAuth, async (req, res) => {
  const sections = await store.readJSON("sections.json", DEFAULT_SECTIONS);
  const name = String((req.body || {}).name || "").trim();
  if (!name) return json(res, 400, { error: "Nome da seção é obrigatório." });
  const id = name.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  if (sections.some((s) => s.id === id)) return json(res, 409, { error: "Já existe uma seção com esse nome." });
  const section = { id, name };
  sections.push(section);
  await store.writeJSON("sections.json", sections);
  json(res, 201, section);
});

router.delete("/api/admin/sections/:id", requireAuth, async (req, res) => {
  let sections = await store.readJSON("sections.json", DEFAULT_SECTIONS);
  const exists = sections.some((s) => s.id === req.params.id);
  if (!exists) return json(res, 404, { error: "Seção não encontrada." });
  sections = sections.filter((s) => s.id !== req.params.id);
  await store.writeJSON("sections.json", sections);
  json(res, 200, { deleted: true });
});

// ==================== PRODUTOS ====================

// ---- Produtos (público) ----
router.get("/api/products", async (req, res) => {
  const products = await store.readJSON("products.json", DEFAULT_PRODUCTS);
  let list = products.filter((p) => p.active !== false);
  if (req.query.section) list = list.filter((p) => p.section === req.query.section);
  json(res, 200, list);
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
    section: String(p.section || "").trim(),
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
    section: p.section !== undefined ? String(p.section).trim() : products[idx].section,
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

// ---- Upload de imagem (admin) ----
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

// ==================== PEDIDOS ====================

router.post("/api/orders", async (req, res) => {
  const { customer, items, shippingAddress } = req.body || {};
  if (!customer || !customer.name || !customer.phone || !Array.isArray(items) || items.length === 0) {
    return json(res, 400, { error: "Dados do pedido incompletos." });
  }
  const products = await store.readJSON("products.json", DEFAULT_PRODUCTS);
  let total = 0;
  const resolvedItems = [];
  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) continue;
    const hasPromo = product.promoPrice && Number(product.promoPrice) < Number(product.price);
    const unitPrice = hasPromo ? Number(product.promoPrice) : Number(product.price);
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    total += unitPrice * qty;
    resolvedItems.push({ productId: product.id, name: product.name, price: unitPrice, qty, section: product.section || "" });
  }
  if (resolvedItems.length === 0) return json(res, 400, { error: "Nenhum item válido no pedido." });

  const customerId = getOptionalCustomerId(req);

  const orders = await store.readJSON("orders.json", []);
  const order = {
    id: "ord_" + crypto.randomBytes(6).toString("hex"),
    date: new Date().toISOString(),
    customerId: customerId || null,
    customer: {
      name: String(customer.name).trim(),
      phone: String(customer.phone).trim(),
      email: String(customer.email || "").trim(),
      address: String(customer.address || "").trim()
    },
    // Se o cliente não mandou um endereço de entrega separado, usa o
    // mesmo endereço de cadastro/cobrança.
    shippingAddress: String(shippingAddress || customer.address || "").trim(),
    items: resolvedItems,
    total,
    status: "pendente"
  };
  orders.push(order);
  await store.writeJSON("orders.json", orders);

  // Se o cliente estiver logado e não tiver endereço salvo ainda, aproveita
  // o endereço do pedido pra já deixar preenchido no perfil dele.
  if (customerId && order.customer.address) {
    const customers = await store.readJSON("customers.json", []);
    const idx = customers.findIndex((c) => c.id === customerId);
    if (idx !== -1 && !customers[idx].address) {
      customers[idx].address = order.customer.address;
      await store.writeJSON("customers.json", customers);
    }
  }

  json(res, 201, order);
});

router.get("/api/admin/orders", requireAuth, async (req, res) => {
  const orders = await store.readJSON("orders.json", []);
  json(res, 200, orders);
});

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
  const wasConfirmed = order.status === "confirmado" || order.status === "enviado" || order.status === "entregue";
  order.status = req.body.status;
  await store.writeJSON("orders.json", orders);

  // Se o pedido está virando "confirmado" agora (não estava antes), manda o
  // e-mail de confirmação — cobre o caso de pagamento combinado manualmente
  // pelo lojista, fora do fluxo automático do Mercado Pago.
  if (req.body.status === "confirmado" && !wasConfirmed && RESEND_API_KEY && RESEND_FROM_EMAIL) {
    try {
      await email.sendOrderConfirmation({ order, apiKey: RESEND_API_KEY, fromEmail: RESEND_FROM_EMAIL, storeName: STORE_NAME });
    } catch (emailErr) {
      console.error("Erro ao enviar e-mail de confirmação:", emailErr.message);
    }
  }

  json(res, 200, order);
});

// ==================== CLIENTES (ADMIN) ====================

router.get("/api/admin/customers", requireAuth, async (req, res) => {
  const [orders, customers] = await Promise.all([
    store.readJSON("orders.json", []),
    store.readJSON("customers.json", [])
  ]);

  const map = {};
  // Começa pelos clientes com conta cadastrada — são a fonte de verdade
  // pra contato/e-mail marketing.
  customers.forEach((c) => {
    map[c.email || c.id] = {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      registered: true,
      receiveOffers: c.receiveOffers,
      orders: 0,
      total: 0
    };
  });
  // Adiciona/combina com pedidos (inclusive de quem comprou como convidado).
  orders.forEach((o) => {
    const key = o.customerId
      ? (customers.find((c) => c.id === o.customerId)?.email || o.customerId)
      : (o.customer.email || o.customer.phone || o.customer.name).toLowerCase();
    if (!map[key]) {
      map[key] = {
        id: null,
        name: o.customer.name,
        phone: o.customer.phone,
        email: o.customer.email,
        registered: false,
        receiveOffers: false,
        orders: 0,
        total: 0
      };
    }
    map[key].orders++;
    map[key].total += Number(o.total || 0);
  });

  json(res, 200, Object.values(map).sort((a, b) => b.total - a.total));
});

// ==================== RELATÓRIOS / DRE (ADMIN) ====================

router.get("/api/admin/reports/dre", requireAuth, async (req, res) => {
  const orders = await store.readJSON("orders.json", []);
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const inRange = orders.filter((o) => new Date(o.date) >= since);
  const paidStatuses = ["confirmado", "enviado", "entregue"];
  const paid = inRange.filter((o) => paidStatuses.includes(o.status));
  const cancelled = inRange.filter((o) => o.status === "cancelado");
  const pending = inRange.filter((o) => o.status === "pendente");

  const receitaBruta = paid.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const ticketMedio = paid.length ? receitaBruta / paid.length : 0;

  // Receita por status
  const porStatus = {};
  inRange.forEach((o) => {
    porStatus[o.status] = porStatus[o.status] || { pedidos: 0, total: 0 };
    porStatus[o.status].pedidos++;
    porStatus[o.status].total += Number(o.total || 0);
  });

  // Receita por seção de produto (só pedidos pagos)
  const porSecao = {};
  paid.forEach((o) => {
    o.items.forEach((it) => {
      const sec = it.section || "sem-secao";
      porSecao[sec] = porSecao[sec] || { quantidade: 0, receita: 0 };
      porSecao[sec].quantidade += it.qty;
      porSecao[sec].receita += it.price * it.qty;
    });
  });

  // Receita por dia (últimos N dias) — pra gráfico simples no admin
  const porDia = {};
  paid.forEach((o) => {
    const day = o.date.slice(0, 10);
    porDia[day] = (porDia[day] || 0) + Number(o.total || 0);
  });

  // Top produtos por receita
  const porProduto = {};
  paid.forEach((o) => {
    o.items.forEach((it) => {
      porProduto[it.name] = porProduto[it.name] || { quantidade: 0, receita: 0 };
      porProduto[it.name].quantidade += it.qty;
      porProduto[it.name].receita += it.price * it.qty;
    });
  });
  const topProdutos = Object.entries(porProduto)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.receita - a.receita)
    .slice(0, 10);

  json(res, 200, {
    periodoDias: days,
    receitaBruta,
    pedidosPagos: paid.length,
    pedidosCancelados: cancelled.length,
    pedidosPendentes: pending.length,
    ticketMedio,
    porStatus,
    porSecao: Object.entries(porSecao).map(([id, v]) => ({ id, ...v })),
    porDia: Object.entries(porDia).sort(([a], [b]) => a.localeCompare(b)).map(([day, total]) => ({ day, total })),
    topProdutos
  });
});

// ---- Pagamentos (Mercado Pago) ----
router.post("/api/payments/create-preference", async (req, res) => {
  if (!MP_ACCESS_TOKEN) return json(res, 500, { error: "Mercado Pago não configurado no servidor (falta MP_ACCESS_TOKEN)." });
  const { orderId } = req.body || {};
  const orders = await store.readJSON("orders.json", []);
  const order = orders.find((o) => o.id === orderId);
  if (!order) return json(res, 404, { error: "Pedido não encontrado." });

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

        // Dispara o e-mail de confirmação de venda. Erro no envio não deve
        // derrubar o webhook (o Mercado Pago espera um 200 rápido), então
        // isolamos num try/catch próprio e só logamos se falhar.
        if (RESEND_API_KEY && RESEND_FROM_EMAIL) {
          try {
            await email.sendOrderConfirmation({
              order,
              apiKey: RESEND_API_KEY,
              fromEmail: RESEND_FROM_EMAIL,
              storeName: STORE_NAME
            });
          } catch (emailErr) {
            console.error("Erro ao enviar e-mail de confirmação:", emailErr.message);
          }
        } else {
          console.warn("[AVISO] RESEND_API_KEY/RESEND_FROM_EMAIL não configurados — e-mail de confirmação não enviado.");
        }
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
});
