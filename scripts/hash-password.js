// Uso: node scripts/hash-password.js "SuaSenhaForte123"
// Copie o resultado para ADMIN_PASSWORD_HASH no arquivo .env

const auth = require("../lib/auth");

const password = process.argv[2];

if (!password) {
  console.log("\nUso: node scripts/hash-password.js \"SuaSenhaForte123\"\n");
  process.exit(1);
}

if (password.length < 8) {
  console.log("\n[Aviso] Use uma senha com pelo menos 8 caracteres.\n");
}

const hash = auth.hashPassword(password);
console.log("\nAdicione esta linha ao seu arquivo .env:\n");
console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
