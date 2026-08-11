// Armazenamento simples em arquivos JSON.
// Para uma loja de pequeno/médio porte isso é suficiente e evita
// depender de um banco de dados externo para começar a vender.
// Se o catálogo crescer muito, migrar para Postgres/MySQL é o próximo passo.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function ensureFile(file, defaultValue) {
  const full = path.join(DATA_DIR, file);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(full)) {
    fs.writeFileSync(full, JSON.stringify(defaultValue, null, 2));
  }
  return full;
}

function readJSON(file, defaultValue) {
  const full = ensureFile(file, defaultValue);
  try {
    const raw = fs.readFileSync(full, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return defaultValue;
  }
}

function writeJSON(file, data) {
  const full = ensureFile(file, data);
  const tmp = full + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, full); // escrita atômica evita corromper o arquivo
}

module.exports = { readJSON, writeJSON };
