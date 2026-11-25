const fs = require('node:fs');
const path = require('node:path');
const { root, auditCatalog, buildCatalog } = require('./locale-catalog.cjs');
try {
  const result = auditCatalog();
  const expected = JSON.stringify(buildCatalog(), null, 2) + '\n';
  if (fs.readFileSync(path.join(root, 'locales/messages.json'), 'utf8') !== expected) result.issues.push('Generated dictionary is stale. Run npm run locales:build.');
  fs.mkdirSync(path.join(root, '.local'), { recursive: true });
  fs.writeFileSync(path.join(root, '.local/missing-locales.json'), JSON.stringify(result.issues, null, 2));
  console.log(JSON.stringify({ total: result.total, missing: result.issues.length }));
  if (result.issues.length) {
    console.error(result.issues.join('\n'));
    if (process.argv.includes('--strict')) process.exitCode = 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
