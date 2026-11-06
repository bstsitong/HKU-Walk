const fs = require('fs');
const parser = require('@babel/parser');
const dictionary = require('../locales/messages.json');
const found = new Set();
const chinese = /[\u3400-\u9fff]/;
function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'StringLiteral' || value.type === 'JSXText') {
    const text = value.value.trim();
    if (chinese.test(text)) found.add(text);
  }
  for (const [key, child] of Object.entries(value)) {
    if (['loc','comments','leadingComments','trailingComments','tokens','extra'].includes(key)) continue;
    if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child);
  }
}
for (const name of fs.readdirSync('.').filter(name => /\.tsx?$/.test(name))) visit(parser.parse(fs.readFileSync(name, 'utf8'), { sourceType: 'module', plugins: ['typescript','jsx'] }));
function strings(value) { if (typeof value === 'string' && chinese.test(value)) found.add(value); else if (Array.isArray(value)) value.forEach(strings); else if (value && typeof value === 'object') Object.values(value).forEach(strings); }
strings(JSON.parse(fs.readFileSync('server/guide/seed.json','utf8')));
for (const place of require('../server/guide/base_places_v2.json')) strings([place.name, place.entrance, place.floor]);
const missing = [...found].filter(text => !dictionary[text]);
fs.mkdirSync('.local', { recursive: true });
fs.writeFileSync('.local/missing-locales.json', JSON.stringify(missing,null,2));
console.log(JSON.stringify({ total: found.size, missing: missing.length }));
if (process.argv.includes('--strict') && missing.length) process.exitCode = 1;
