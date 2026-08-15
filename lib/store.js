// Armazenamento de dados: usa o Supabase (Postgres gerenciado, permanente)
// quando SUPABASE_URL e SUPABASE_SERVICE_KEY estão configurados no .env.
// Sem essas variáveis, cai automaticamente para arquivos JSON locais —
// útil para rodar e testar na sua máquina sem precisar de internet/Supabase.
//
// Os dados de cada "coleção" (products, orders, customers) ficam guardados
// como uma linha JSON numa tabela genérica chamada kv_store. Isso evita
// exigir um esquema de tabelas relacional específico — o SQL para criar
// essa tabela está no README, seção "Configurando o Supabase".

const fs = require("fs");
const path = require("path");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);

const DATA_DIR = path.join(__dirname, "..", "data");

// ---------------------------------------------------------------
// Backend 1: Supabase (Postgres via API REST/PostgREST)
// ---------------------------------------------------------------
async function supabaseReadJSON(key, defaultValue) {
  const url = `${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  });
  if (!res.ok) {
    throw new Error(`Supabase respondeu ${res.status} ao ler "${key}". Confira SUPABASE_URL/SUPABASE_SERVICE_KEY e se a tabela kv_store existe.`);
  }
  const rows = await res.json();
  if (rows.length > 0) return rows[0].value;
  // Chave ainda não existe — cria com o valor padrão para a próxima leitura já vir pronta.
  await supabaseWriteJSON(key, defaultValue);
  return defaultValue;
}

async function supabaseWriteJSON(key, value) {
  const url = `${SUPABASE_URL}/rest/v1/kv_store?on_conflict=key`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }])
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase respondeu ${res.status} ao salvar "${key}": ${text}`);
  }
}

// ---------------------------------------------------------------
// Backend 2: arquivos JSON locais (fallback para desenvolvimento)
// ---------------------------------------------------------------
function ensureFile(file, defaultValue) {
  const full = path.join(DATA_DIR, file);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(full)) {
    fs.writeFileSync(full, JSON.stringify(defaultValue, null, 2));
  }
  return full;
}

function fileReadJSON(file, defaultValue) {
  const full = ensureFile(file, defaultValue);
  try {
    const raw = fs.readFileSync(full, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return defaultValue;
  }
}

function fileWriteJSON(file, data) {
  const full = ensureFile(file, data);
  const tmp = full + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, full); // escrita atômica evita corromper o arquivo
}

// ---------------------------------------------------------------
// Interface pública — igual nos dois casos, o resto do backend
// nem precisa saber qual dos dois está sendo usado por baixo.
// ---------------------------------------------------------------
async function readJSON(name, defaultValue) {
  if (USE_SUPABASE) return supabaseReadJSON(name, defaultValue);
  return fileReadJSON(name, defaultValue);
}

async function writeJSON(name, data) {
  if (USE_SUPABASE) return supabaseWriteJSON(name, data);
  return fileWriteJSON(name, data);
}

module.exports = { readJSON, writeJSON, USE_SUPABASE };
