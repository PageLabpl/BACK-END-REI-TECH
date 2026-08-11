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
    back_urls: backUrls,
    auto_return: "approved",
    notification_url: notificationUrl
  };

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
    throw new Error(data.message || "Erro ao criar preferência no Mercado Pago");
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
