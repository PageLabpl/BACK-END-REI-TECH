// Envio de e-mail transacional usando a API REST do Resend (resend.com) —
// só fetch nativo do Node, sem nenhuma dependência externa.
// Documentação: https://resend.com/docs/api-reference/emails/send-email

const RESEND_API = "https://api.resend.com/emails";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function buildOrderConfirmationHtml(order, storeName) {
  const rows = order.items.map((i) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">${escapeHtml(i.qty)}x ${escapeHtml(i.name)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${money(i.price * i.qty)}</td>
    </tr>`).join("");

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#222;">
    <h2 style="color:#111;">Pedido confirmado! 🎉</h2>
    <p>Olá, ${escapeHtml(order.customer.name)}! Recebemos o pagamento do seu pedido <strong>#${escapeHtml(order.id)}</strong> na ${escapeHtml(storeName)}.</p>
    <table style="width:100%;border-collapse:collapse;margin:18px 0;">
      <thead>
        <tr><th style="text-align:left;padding-bottom:8px;border-bottom:2px solid #333;">Item</th><th style="text-align:right;padding-bottom:8px;border-bottom:2px solid #333;">Subtotal</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:1.1rem;text-align:right;"><strong>Total: ${money(order.total)}</strong></p>
    <div style="background:#f6f7f9;border-radius:8px;padding:14px 16px;margin-top:18px;">
      <p style="margin:0 0 6px 0;"><strong>Endereço de entrega</strong></p>
      <p style="margin:0;white-space:pre-line;">${escapeHtml(order.shippingAddress || order.customer.address)}</p>
    </div>
    <p style="margin-top:24px;color:#777;font-size:0.85rem;">Guarde este e-mail como comprovante da sua compra. Qualquer dúvida, é só responder este e-mail ou chamar nosso suporte.</p>
  </div>`;
}

/**
 * Envia o e-mail de confirmação de compra pro cliente.
 * @param {Object} opts
 * @param {Object} opts.order - o pedido já com status "confirmado"
 * @param {string} opts.apiKey - RESEND_API_KEY
 * @param {string} opts.fromEmail - endereço remetente verificado no Resend (ex: pedidos@seudominio.com)
 * @param {string} [opts.storeName] - nome da loja, usado no texto do e-mail
 */
async function sendOrderConfirmation({ order, apiKey, fromEmail, storeName = "loja" }) {
  if (!order.customer.email) return; // sem e-mail cadastrado, não tem pra quem mandar

  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from: `${storeName} <${fromEmail}>`,
      to: [order.customer.email],
      subject: `Pedido confirmado #${order.id} — ${storeName}`,
      html: buildOrderConfirmationHtml(order, storeName)
    })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Resend retornou status ${res.status} ao enviar o e-mail.`);
  }
}

module.exports = { sendOrderConfirmation };
