// Exercise multilingual search against actual campus data without a device runtime.
const fs = require('fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const { filterPlaces, places, placeName } = require('../campus.ts');
const { setCurrentLanguage, translate, t } = require('../localization.ts');
const cases = [['图书馆','library'],['圖書館','library'],['ｌｉｂｒａｒｙ','library'],[' CWLC ','chiwah'],['钮鲁诗','knowles'],['鈕魯詩','knowles'],['mAiN bUiLdInG','main'],['地铁','gate'],['花園','garden'],['wc','toilet']];
for (const language of ['zh-Hans','zh-Hant','en']) {
  setCurrentLanguage(language);
  for (const [query, expected] of cases) assert.deepEqual(filterPlaces('all', query).map(p => p.id), [expected], `${language}: ${query}`);
  assert.equal(filterPlaces('all').length, 8);
  assert.equal(filterPlaces('building').length, 2);
  assert.equal(filterPlaces('food', 'library').length, 0);
  assert.equal(filterPlaces('all', 'no such place').length, 0);
  for (const place of places) assert.ok(placeName(place));
}
setCurrentLanguage('en');
assert.equal(t('从 {place} 出发', { place: 'Main Library' }), 'Start at Main Library');
assert.equal(translate('账号：这个账号已被使用。'), 'Username: This username is already taken.');
assert.equal(translate('请确保这个字段不能多于 160 个字符。'), 'Use no more than 160 characters.');
assert.equal(translate('同学自己写的内容 test'), '同学自己写的内容 test');
setCurrentLanguage('zh-Hant');
assert.equal(translate('本部大楼'), '本部大樓');
for (const category of require('../server/guide/seed.json')) {
  for (const text of [category.title, category.subtitle, category.introduction, ...category.entries.flatMap(entry => [entry.title, entry.body])]) {
    assert.ok(translate(text, 'en') && !/[\u3400-\u9fff]/.test(translate(text,'en')), `Missing guide translation: ${text}`);
  }
}
const messages = require('../locales/messages.json');
for (const [key, value] of Object.entries(messages)) {
  assert.ok(value.en && value['zh-Hant'], `Empty translation: ${key}`);
  const placeholders = text => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
  assert.deepEqual(placeholders(key), placeholders(value.en), `English placeholders: ${key}`);
  assert.deepEqual(placeholders(key), placeholders(value['zh-Hant']), `Traditional placeholders: ${key}`);
}
console.log('Passed: multilingual search, category and empty results, route text, validation messages, all built-in guide content, and translation placeholders.');
