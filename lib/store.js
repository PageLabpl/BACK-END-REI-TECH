// lib/store.js
// Armazenamento persistente via Supabase (Postgres), usando apenas o fetch
// nativo do Node — continua sem NENHUMA dependência externa (npm install
// segue não sendo necessário).
//
// Mantém a MESMA interface que o store.js antigo (baseado em arquivo local):
//   await store.readJSON(key, defaultValue)
//   await store.writeJSON(key, value)
// Ou seja, o resto do backend não precisa saber que os dados agora moram
// num banco de verdade — só que essas duas funções passaram a ser async
// (por isso os `await` foram adicionados em server.js).
//
// "key" (ex: "products.json", "orders.json") vira o identificador de uma
// linha na tabela genérica `kv_store` criada no Supabase (ver supabase-setup.sql).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "\n[ERRO] Configure SUPABASE_URL e SUPABASE_SERVICE_KEY no .env antes de iniciar.\n" +
    "Veja o README (seção Supabase) para criar o projeto gratuito e a tabela kv_store.\n"
  );
  process.exit(1);
}

const REST_URL = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/kv_store`;

function headers(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function readJSON(key, defaultValue) {
  const res = await fetch(
    `${REST_URL}?key=eq.${encodeURIComponent(key)}&select=value`,
    { headers: headers() }
  );
  if (!res.ok) {
    throw new Error(`Supabase (leitura de "${key}") retornou ${res.status}: ${await res.text()}`);
  }
  const rows = await res.json();
  if (rows.length === 0) {
    // Primeira vez que essa chave é usada nesse projeto Supabase:
    // grava o valor padrão para as próximas leituras já encontrarem algo.
    await writeJSON(key, defaultValue);
    return defaultValue;
  }
  return rows[0].value;
}

async function writeJSON(key, value) {
  const res = await fetch(`${REST_URL}?on_conflict=key`, {
    method: "POST",
    headers: headers({ Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify({ key, value })
  });
  if (!res.ok) {
    throw new Error(`Supabase (escrita de "${key}") retornou ${res.status}: ${await res.text()}`);
  }
}

module.exports = { readJSON, writeJSON };