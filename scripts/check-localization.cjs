const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { translate, t, setCurrentLanguage } = require('../localization.ts');
const { localizedGuideArticle } = require('../guideLocalization.ts');
const { auditCatalog, buildCatalog, readTranslations } = require('./locale-catalog.cjs');

// Switching also refreshes previously translated system values, including parameters.
setCurrentLanguage('en');
const photo = t('路线第 {step} 步配图', { step: 12 });
assert.ok(!/[\u3400-\u9fff]/.test(photo));
assert.equal(translate(photo, 'zh-Hans'), '路线第 12 步配图');
assert.equal(translate(photo, 'zh-Hant'), '路線第 12 步配圖');
assert.equal(translate(translate('语言暂时无法保存', 'en'), 'zh-Hans'), '语言暂时无法保存');
assert.equal(translate('账号：这个账号已被使用。', 'en'), 'Username: This username is already taken.');
assert.equal(translate('Username: This username is already taken.', 'zh-Hans'), '账号：这个账号已被使用。');
assert.equal(translate('请确保这个字段不能多于 160 个字符。', 'en'), 'Use no more than 160 characters.');
assert.equal(translate('同学自己写的内容 test', 'en'), '同学自己写的内容 test');
assert.equal(translate('  返回  ', 'en'), '  Back  ');

// Product-owned non-Markdown entries translate; author content remains byte-for-byte intact.
const builtin = { title: '地点线路待添加', body: '点击放大', sourcePages: {}, markdown: false, isCommunity: false };
assert.equal(localizedGuideArticle(builtin, 'en').body, 'Tap to enlarge');
const authored = { ...builtin, isCommunity: true };
assert.equal(localizedGuideArticle(authored, 'en'), authored);

const dictionary = buildCatalog();
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hku-i18n-'));
const fixture = path.join(fixtureDir, 'screen.tsx');
const translations = path.join(fixtureDir, 'translations.json');
function issues(source) {
  fs.writeFileSync(fixture, source);
  return auditCatalog(dictionary, [fixture]).issues.join('\n');
}
try {
  assert.match(issues("const x = <Text>新加而尚未翻译的按钮</Text>;"), /missing translation/);
  assert.match(issues('const x = <Text>{`第 ${step} 个新位置`}</Text>;'), /use t\(/);
  assert.match(issues("import { Text as Label } from 'react-native'; const x = <Label>返回</Label>;"), /localized Text/);
  assert.match(issues('const x = <Text raw>返回</Text>;'), /raw must not/);
  assert.match(issues('const x = <Button label="Brand new action" />;'), /Chinese source key/);
  assert.equal(issues("import { Text } from './ui'; const x = <Text>返回</Text>;"), '');
  assert.equal(issues("import { Text } from './ui'; const x = <Text raw>{post.title}</Text>;"), '');
  fs.writeFileSync(translations, '{"新增":"New", "新增":"Another"}');
  assert.throws(() => readTranslations(translations), /duplicate/);
  fs.writeFileSync(translations, '{"第 {step} 步":"Step {count}"}');
  assert.throws(() => readTranslations(translations), /parameters differ/);
  fs.writeFileSync(translations, '{"新增":""}');
  assert.throws(() => readTranslations(translations), /empty translation/);
} finally {
  for (const file of [fixture, translations]) if (fs.existsSync(file)) fs.unlinkSync(file);
  fs.rmdirSync(fixtureDir);
}
console.log('Passed language switching, formatted text, author-content preservation and release-gate rejection cases.');
