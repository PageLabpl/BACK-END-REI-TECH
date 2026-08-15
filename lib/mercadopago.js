// Integração direta com a API REST do Mercado Pago (sem SDK),
// usando o fetch nativo do Node. Documentação oficial:
// https://www.mercadopago.com.br/developers/pt/reference

const MP_API = "https://api.mercadopago.com";

async function createPreference({ order, backUrls, notificationUrl, accessToken }) {
  const body = {
    items: order.items.map((i) => ({
      title: i.name,
      quantity: i.qty,
      unit_price: Number(i.price),
      currency_id: "BRL"
    })),
    payer: {
      name: order.customer.name,
      email: order.customer.email
    },
    external_reference: order.id,
    notification_url: notificationUrl
  };

  // back_urls habilita os botões "Voltar ao site" nas telas de sucesso/pendente/
  // falha do Mercado Pago. Não usamos "auto_return": o Mercado Pago valida se
  // back_url.success é uma URL pública alcançável antes de aceitar a preferência
  // (com auto_return), e isso costuma quebrar em ambientes de teste/deploy com
  // FRONTEND_URL apontando pra localhost ou domínio ainda não publicado — gerando
  // o erro "auto_return invalid. back_url.success must be defined". Sem
  // auto_return, o cliente só clica manualmente em "Voltar ao site" — o
  // pagamento funciona igual.
  if (backUrls) {
    body.back_urls = backUrls;
  }

  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) {
    // Loga a resposta crua do Mercado Pago no console do servidor (aparece nos
    // "Logs" do Render) — é a forma mais rápida de descobrir a causa real,
    // já que o Mercado Pago costuma ser bem específico no campo "cause".
    console.error(
      "[Mercado Pago] Falha ao criar preferência. Status:", res.status,
      "\nResposta completa:", JSON.stringify(data, null, 2),
      "\nPayload enviado:", JSON.stringify(body, null, 2)
    );
    const causeDetail = Array.isArray(data.cause) && data.cause.length
      ? data.cause.map((c) => c.description || c.code).join("; ")
      : null;
    throw new Error(causeDetail || data.message || `Erro ao criar preferência no Mercado Pago (status ${res.status})`);
  }
  return data; // contém init_point (link de pagamento) e id
}

async function getPayment(paymentId, accessToken) {
  const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    console.error("[Mercado Pago] Falha ao consultar pagamento. Status:", res.status, "Resposta:", JSON.stringify(data));
    throw new Error("Erro ao consultar pagamento no Mercado Pago");
  }
  return res.json();
}

module.exports = { createPreference, getPayment };
