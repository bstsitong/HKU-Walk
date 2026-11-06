const fs = require('fs');
const OpenCC = require('opencc-js');
const toTraditional = OpenCC.Converter({ from: 'cn', to: 'hk' });
const pairs = { ...require('../locales/prototype-en.json'), ...require('../locales/app-en.json'), ...require('../locales/errors-en.json'), ...require('../locales/map-features-en.json') };
// Search aliases and language autonyms are not rendered as translatable copy.
for (const { name, english, keywords } of [...require('../server/guide/base_places_v1.json'), ...require('../server/guide/base_places_v2.json')]) {
  pairs[name] = english;
  pairs[toTraditional(name)] = english;
  if (keywords) pairs[keywords] = keywords;
}
pairs['花園'] = 'Garden';
const messages = Object.fromEntries(Object.entries(pairs).map(([text, en]) => [text, { en, 'zh-Hant': toTraditional(text) }]));
fs.writeFileSync('locales/messages.json', JSON.stringify(messages, null, 2) + '\n');
console.log(`${Object.keys(messages).length} messages generated for English and Traditional Chinese.`);
