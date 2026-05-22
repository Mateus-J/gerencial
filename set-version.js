/**
 * set-version.js
 * 
 * Executa ANTES do commit/deploy para gravar a versão no index.html.
 * Uso: node set-version.js
 * 
 * Como integrar ao GitHub Actions (workflow .github/workflows/deploy.yml):
 *   - run: node set-version.js
 *     (antes do step de deploy)
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'index.html');
const version = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
// ex: "20250522143012"

let html = fs.readFileSync(FILE, 'utf8');
html = html.replace(
  /<meta name="app-version" content="[^"]*">/,
  `<meta name="app-version" content="${version}">`
);
fs.writeFileSync(FILE, html, 'utf8');
console.log(`✅ Versão gravada: ${version}`);
