// Upload de imagens para o Cloudinary via API REST (sem SDK),
// usando fetch nativo do Node e assinatura HMAC conforme a documentação oficial:
// https://cloudinary.com/documentation/upload_images#generating_authentication_signatures

const crypto = require("crypto");

function signParams(params, apiSecret) {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return crypto.createHash("sha1").update(sorted + apiSecret).digest("hex");
}

async function uploadImage(base64DataUri, { cloudName, apiKey, apiSecret, folder = "reitech-produtos" }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = { timestamp, folder };
  const signature = signParams(paramsToSign, apiSecret);

  const body = new URLSearchParams({
    file: base64DataUri,
    api_key: apiKey,
    timestamp: String(timestamp),
    folder,
    signature
  });

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error((data.error && data.error.message) || "Erro ao enviar imagem para o Cloudinary");
  }
  return data.secure_url;
}

module.exports = { uploadImage };
