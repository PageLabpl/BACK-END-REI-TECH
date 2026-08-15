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

  // auto_return exige back_urls.success — só faz sentido mandar os dois juntos.
  if (backUrls) {
    body.back_urls = backUrls;
    body.auto_return = "approved";
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
    const causeDetail = Array.isArray(data.cause) && data.cause.length
      ? data.cause.map((c) => c.description || c.code).join("; ")
      : null;
    throw new Error(causeDetail || data.message || "Erro ao criar preferência no Mercado Pago");
  }
  return data; // contém init_point (link de pagamento) e id
}

async function getPayment(paymentId, accessToken) {
  const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error("Erro ao consultar pagamento no Mercado Pago");
  return res.json();
}

module.exports = { createPreference, getPayment };
