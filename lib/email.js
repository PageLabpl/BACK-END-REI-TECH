// Envio de e-mail transacional via API REST do Resend (sem SDK), usando
// fetch nativo do Node. Documentação: https://resend.com/docs/api-reference/emails/send-email

const RESEND_API = "https://api.resend.com/emails";

function money(v) {
  return "R$" + Number(v).toFixed(2).replace(".", ",");
}

function buildHtml(order, storeName) {
  const itemsRows = order.items
    .map(
      (i) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #26314a;color:#f2f4fb;">${i.qty}x ${escapeHtml(i.name)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #26314a;color:#f2f4fb;text-align:right;">${money(i.price * i.qty)}</td>
      </tr>`
    )
    .join("");

  const addressBlock = order.shippingAddressText
    ? `<p style="margin:4px 0 0;color:#8a93ac;font-size:14px;">${escapeHtml(order.shippingAddressText)}</p>`
    : "";

  return `
  <div style="background:#05070d;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#0b1020;border:1px solid #1b2440;border-radius:14px;padding:32px;">
      <h1 style="color:#7dd3fc;font-size:20px;margin:0 0 4px;">${escapeHtml(storeName)}</h1>
      <p style="color:#f2f4fb;font-size:16px;margin:0 0 24px;">Seu pedido foi confirmado! 🎉</p>

      <p style="color:#8a93ac;font-size:13px;margin:0 0 4px;">Pedido</p>
      <p style="color:#f2f4fb;font-size:14px;margin:0 0 20px;">#${escapeHtml(order.id)}</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        ${itemsRows}
      </table>

      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding-top:10px;color:#8a93ac;">Subtotal</td>
          <td style="padding-top:10px;color:#8a93ac;text-align:right;">${money(order.itemsTotal != null ? order.itemsTotal : order.total)}</td>
        </tr>
        ${order.shippingCost ? `
        <tr>
          <td style="padding-top:6px;color:#8a93ac;">Frete${order.shippingLabel ? " — " + escapeHtml(order.shippingLabel) : ""}${order.shippingInsurance === "total" ? " (seguro total)" : ""}</td>
          <td style="padding-top:6px;color:#8a93ac;text-align:right;">${money(order.shippingCost)}</td>
        </tr>` : ""}
        <tr>
          <td style="padding-top:10px;color:#f2f4fb;font-weight:bold;">Total</td>
          <td style="padding-top:10px;color:#7dd3fc;font-weight:bold;text-align:right;">${money(order.total)}</td>
        </tr>
      </table>

      <p style="color:#8a93ac;font-size:13px;margin:24px 0 0;">Endereço de entrega</p>
      <p style="color:#f2f4fb;font-size:14px;margin:4px 0 0;">${escapeHtml(order.customer.name)}</p>
      ${addressBlock}

      <p style="color:#525b70;font-size:12px;margin:28px 0 0;">Qualquer dúvida sobre o pedido, é só responder este e-mail.</p>
    </div>
  </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]));
}

async function sendOrderConfirmation({ order, apiKey, fromEmail, storeName }) {
  if (!order.customer || !order.customer.email) {
    throw new Error("Pedido sem e-mail do cliente — nada para enviar.");
  }
  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: `${storeName} <${fromEmail}>`,
      to: [order.customer.email],
      subject: `Pedido confirmado — #${order.id}`,
      html: buildHtml(order, storeName)
    })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data && data.message) || `Resend respondeu ${res.status}`);
  }
  return res.json();
}

module.exports = { sendOrderConfirmation };
