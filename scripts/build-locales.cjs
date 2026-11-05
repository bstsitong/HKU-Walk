const fs = require('fs');
const OpenCC = require('opencc-js');
const toTraditional = OpenCC.Converter({ from: 'cn', to: 'hk' });
const pairs = { ...require('../locales/prototype-en.json'), ...require('../locales/app-en.json'), ...require('../locales/errors-en.json') };
// Search aliases and language autonyms are not rendered as translatable copy.
const source = fs.readFileSync('campus.ts', 'utf8');
const names = [...source.matchAll(/name: '([^']+)', english: '([^']+)'/g)];
for (const [, zh, en] of names) pairs[toTraditional(zh)] = en;
for (const keyword of [...source.matchAll(/keywords: '([^']+)'/g)]) pairs[keyword[1]] = keyword[1];
pairs['花園'] = 'Garden';
const messages = Object.fromEntries(Object.entries(pairs).map(([text, en]) => [text, { en, 'zh-Hant': toTraditional(text) }]));
fs.writeFileSync('locales/messages.json', JSON.stringify(messages, null, 2) + '\n');
console.log(`${Object.keys(messages).length} messages generated for English and Traditional Chinese.`);
