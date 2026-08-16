// Integração com a API do Melhor Envio (agrega Correios + transportadoras
// privadas como Jadlog, Azul Cargo etc). Documentação:
// https://docs.melhorenvio.com.br/reference/calculo-de-frete
//
// Usa um token de acesso gerado direto no painel (Configurações > Tokens de
// Acesso) — mais simples do que implementar o fluxo completo de OAuth pra
// uma loja pequena. O token não expira automaticamente feito o de OAuth.

function baseUrl(sandbox) {
  return sandbox ? "https://sandbox.melhorenvio.com.br" : "https://melhorenvio.com.br";
}

// Monta a lista de "produtos" que vai na cotação — cada item do carrinho
// vira uma entrada, usando peso/dimensões do cadastro (ou o padrão de
// pacote mínimo, se o lojista ainda não preencheu).
function buildProductsPayload(items, defaultPackage) {
  return items.map((i) => ({
    id: i.productId,
    width: i.width || defaultPackage.width,
    height: i.height || defaultPackage.height,
    length: i.length || defaultPackage.length,
    weight: i.weight || defaultPackage.weight,
    insurance_value: Number(i.price) || 0,
    quantity: i.qty || 1
  }));
}

async function calculateShipping({ token, fromCep, toCep, items, sandbox, defaultPackage, userAgent }) {
  const url = `${baseUrl(sandbox)}/api/v2/me/shipment/calculate`;
  const body = {
    from: { postal_code: String(fromCep).replace(/\D/g, "") },
    to: { postal_code: String(toCep).replace(/\D/g, "") },
    products: buildProductsPayload(items, defaultPackage),
    options: { receipt: false, own_hand: false }
  };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        // O Melhor Envio pede um User-Agent identificando a aplicação e um
        // contato — sem isso algumas contas recebem erro de bloqueio.
        "User-Agent": userAgent || "REI TECH (contato@reitech.com)"
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new Error("Não foi possível conectar ao Melhor Envio agora.");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(data)) {
    throw new Error((data && data.message) || `Melhor Envio respondeu ${res.status}`);
  }

  // Cada item do array é a cotação de uma transportadora — as que não
  // atendem aquele CEP/produto vêm com um campo "error" preenchido.
  const valid = data
    .filter((q) => !q.error && q.price)
    .map((q) => ({
      service: q.name,
      company: q.company && q.company.name,
      price: Number(q.price),
      estimatedDays: q.delivery_time != null ? Number(q.delivery_time) : null
    }))
    .sort((a, b) => a.price - b.price);

  return valid;
}

module.exports = { calculateShipping };
