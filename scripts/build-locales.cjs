const fs = require('node:fs');
const path = require('node:path');
const { root, buildCatalog, writeCatalog } = require('./locale-catalog.cjs');
if (process.argv.includes('--check')) {
  const expected = JSON.stringify(buildCatalog(), null, 2) + '\n';
  if (fs.readFileSync(path.join(root, 'locales/messages.json'), 'utf8') !== expected) {
    console.error('Translation dictionary is stale. Run npm run locales:build.');
    process.exitCode = 1;
  }
} else {
  console.log(`${Object.keys(writeCatalog()).length} messages generated for English and Traditional Chinese.`);
}
