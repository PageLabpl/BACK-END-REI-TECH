// Autenticação sem dependências externas:
// - Senha: hash com scrypt (nativo do Node, resistente a força bruta)
// - Sessão: token assinado com HMAC-SHA256 (equivalente a um JWT simples)

const crypto = require("crypto");

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12 horas

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(hash, "hex");
  if (candidate.length !== original.length) return false;
  return crypto.timingSafeEqual(candidate, original);
}

function base64url(input) {
  return Buffer.from(JSON.stringify(input))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return JSON.parse(Buffer.from(str, "base64").toString("utf8"));
}

function sign(payload, secret, ttlSeconds = TOKEN_TTL_SECONDS) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = base64url(body);
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function verify(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [encoded, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const payload = fromBase64url(encoded);
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

module.exports = { hashPassword, verifyPassword, sign, verify, TOKEN_TTL_SECONDS };
