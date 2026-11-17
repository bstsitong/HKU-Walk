const fs = require('fs');
const OpenCC = require('opencc-js');
const toTraditional = OpenCC.Converter({ from: 'cn', to: 'hk' });
const pairs = { ...require('../locales/prototype-en.json'), ...require('../locales/app-en.json'), ...require('../locales/errors-en.json'), ...require('../locales/map-features-en.json'), ...require('../locales/student-guide-en.json') };
// Search aliases and language autonyms are not rendered as translatable copy.
for (const { name, english, keywords } of [...require('../server/guide/base_places_v1.json'), ...require('../server/guide/base_places_v2.json'), ...require('../server/guide/additional_map_places.json'), ...require('../server/guide/campus_landmarks.json'), ...require('../server/guide/classrooms.json')]) {
  pairs[name] = english;
  pairs[toTraditional(name)] = english;
  if (keywords) pairs[keywords] = keywords;
}
pairs['花園'] = 'Garden';
Object.assign(pairs, require('../locales/campus-details-en.json'));
for (const file of ['base_places_v2', 'additional_map_places', 'campus_landmarks', 'classrooms']) {
  for (const { floor } of require(`../server/guide/${file}.json`)) {
    if (!floor || !floor.includes(' · ') || pairs[floor]) continue;
    pairs[floor] = floor.split(' · ').map(part => pairs[part] ?? part.replaceAll('、', ', ')).join(' · ');
  }
}
const messages = Object.fromEntries(Object.entries(pairs).map(([text, en]) => [text, { en, 'zh-Hant': toTraditional(text) }]));
fs.writeFileSync('locales/messages.json', JSON.stringify(messages, null, 2) + '\n');
console.log(`${Object.keys(messages).length} messages generated for English and Traditional Chinese.`);
