const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const { Converter } = require('opencc-js');
const root = path.resolve(__dirname, '..');
const chinese = /[\u3400-\u9fff]/;
const traditional = Converter({ from: 'cn', to: 'hk' });
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const placeholders = text => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort().join(',');

function readTranslations(name) {
  const source = fs.readFileSync(path.resolve(root, name), 'utf8');
  const object = parser.parseExpression(source);
  const seen = new Set();
  for (const property of object.properties) {
    const key = property.key.value;
    if (seen.has(key)) throw new Error(`${name}:${property.loc.start.line}: duplicate translation: ${key}`);
    seen.add(key);
  }
  const pairs = JSON.parse(source);
  for (const [key, value] of Object.entries(pairs)) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}: empty translation: ${key}`);
    if (placeholders(key) !== placeholders(value)) throw new Error(`${name}: translation parameters differ: ${key}`);
    if (chinese.test(value.replace(/\]\([^)]*\)/g, ''))) throw new Error(`${name}: untranslated Chinese in English: ${key}`);
  }
  return pairs;
}

function buildCatalog() {
  const pairs = {}, owner = new Map();
  const files = fs.readdirSync(path.join(root, 'locales')).filter(name => name.endsWith('-en.json') && name !== 'guide-articles-en.json').sort();
  for (const file of files) {
    for (const [source, english] of Object.entries(readTranslations(`locales/${file}`))) {
      if (owner.has(source) && pairs[source] !== english) throw new Error(`Conflicting translation for ${source}: ${owner.get(source)} and ${file}`);
      pairs[source] = english;
      owner.set(source, file);
    }
  }
  for (const file of ['base_places_v1', 'base_places_v2', 'additional_map_places', 'campus_landmarks', 'classrooms']) {
    for (const place of read(`server/guide/${file}.json`)) {
      if (!place.english?.trim()) throw new Error(`${file}: missing English place name: ${place.id}`);
      pairs[place.name] = place.english;
      // Search aliases must never become UI translations.
      if (place.floor?.includes(' · ') && !pairs[place.floor]) pairs[place.floor] = place.floor.split(' · ').map(part => pairs[part] ?? part.replaceAll('、', ', ')).join(' · ');
    }
  }
  return Object.fromEntries(Object.entries(pairs).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([source, en]) => [source, { en, 'zh-Hant': traditional(source) }]));
}

function sourceFiles(dir = root) {
  const ignored = new Set(['node_modules', '.local', '.git', '.expo', '.venv', 'android', 'ios', 'dist', 'web-build', 'server', 'scripts', 'locales', 'deploy', 'assets']);
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) return ignored.has(entry.name) ? [] : sourceFiles(path.join(dir, entry.name));
    return /\.[jt]sx?$/.test(entry.name) && !/\.(?:test|spec|d)\.[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.config.js') ? [path.join(dir, entry.name)] : [];
  });
}

function auditCatalog(dictionary = buildCatalog(), files = sourceFiles()) {
  const found = new Map(), issues = [], importedData = new Set();
  function add(text, file, line) {
    const value = text.trim();
    if (chinese.test(value) && !found.has(value)) found.set(value, `${file}${line ? ':' + line : ''}`);
  }
  const neutral = new Set(['AI', 'Ask HKU', 'AI Ask HKU', 'HKU-Walk', 'N', 'English', '© OpenStreetMap', '© OpenStreetMap contributors', 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX']);
  const copyFields = new Set(['label', 'title', 'description', 'placeholder', 'accessibilityLabel', 'accessibilityHint']);
  function englishCopy(value, file, line) {
    if (/^[A-Za-z][A-Za-z \u00a0.,!?'-]+$/.test(value) && !neutral.has(value) && !dictionary[value]) issues.push(`${file}:${line}: register system text using a Chinese source key: ${value}`);
  }
  for (const filename of files) {
    const file = path.relative(root, filename).replaceAll('\\', '/');
    const native = new Map();
    const namespaces = new Set();
    const ast = parser.parse(fs.readFileSync(filename, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'ImportDeclaration') {
        if (node.source.value === 'react-native' && file !== 'ui.tsx') for (const binding of node.specifiers) {
          if (binding.imported) native.set(binding.local.name, binding.imported.name);
          else namespaces.add(binding.local.name);
        }
        if (node.source.value.startsWith('.') && node.source.value.endsWith('.json')) importedData.add(path.resolve(path.dirname(filename), node.source.value));
      }
      if (node.type === 'CallExpression' && node.callee.name === 'require' && node.arguments[0]?.type === 'StringLiteral') {
        const name = node.arguments[0].value;
        if (name.startsWith('.') && name.endsWith('.json')) importedData.add(path.resolve(path.dirname(filename), name));
      }
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && native.get(node.callee.object.name) === 'Alert' && file !== 'LanguageProvider.tsx') issues.push(`${file}:${node.loc.start.line}: use the localized Alert from ./ui`);
      if (node.type === 'StringLiteral' || node.type === 'JSXText') add(node.value, file, node.loc.start.line);
      if (node.type === 'TemplateLiteral' && node.expressions.length && node.quasis.some(part => chinese.test(part.value.cooked ?? ''))) issues.push(`${file}:${node.loc.start.line}: use t('text {parameter}', { parameter }) instead of interpolating Chinese text`);
      if (node.type === 'TemplateLiteral' && !node.expressions.length) add(node.quasis[0].value.cooked ?? '', file, node.loc.start.line);
      if (node.type === 'BinaryExpression' && node.operator === '+' && [node.left, node.right].some(part => part.type === 'StringLiteral' && chinese.test(part.value)) && ![node.left, node.right].every(part => part.type === 'StringLiteral')) issues.push(`${file}:${node.loc.start.line}: use t() parameters instead of concatenating Chinese copy`);
      if (node.type === 'JSXAttribute' && copyFields.has(node.name.name) && node.value?.type === 'StringLiteral') englishCopy(node.value.value, file, node.loc.start.line);
      if (node.type === 'ObjectProperty' && copyFields.has(node.key.name ?? node.key.value) && node.value.type === 'StringLiteral') englishCopy(node.value.value, file, node.loc.start.line);
      if (node.type === 'JSXElement') {
        const opening = node.openingElement, name = opening.name.name;
        const nativeName = opening.name.type === 'JSXMemberExpression' && namespaces.has(opening.name.object.name) ? opening.name.property.name : native.get(name);
        if (['Text', 'TextInput', 'Pressable', 'Image'].includes(nativeName)) issues.push(`${file}:${node.loc.start.line}: use the localized ${nativeName} from ./ui`);
        if (name === 'Text') {
          const raw = opening.attributes.some(attr => attr.name?.name === 'raw' && (!attr.value || attr.value.expression?.value === true));
          for (const child of node.children) {
            const value = child.type === 'JSXText' ? child.value.trim() : child.type === 'JSXExpressionContainer' && child.expression.type === 'StringLiteral' ? child.expression.value : '';
            if (raw && chinese.test(value)) issues.push(`${file}:${child.loc.start.line}: raw must not bypass translation for system text: ${value}`);
            englishCopy(value, file, child.loc.start.line);
          }
        }
      }
      for (const [key, child] of Object.entries(node)) {
        if (['loc', 'comments', 'leadingComments', 'trailingComments', 'tokens', 'extra'].includes(key)) continue;
        if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child);
      }
    }
    visit(ast);
  }
  function dataStrings(value, file) {
    if (typeof value === 'string') add(value, file);
    else if (Array.isArray(value)) value.forEach(item => dataStrings(item, file));
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) if (!['id', 'keywords', 'sourceUrl', 'externalUrl', 'imageUrl', 'english', 'abbreviation', 'parentBuildingId'].includes(key)) dataStrings(item, file);
  }
  for (const file of ['seed', 'student_guide_hku_v1']) importedData.add(path.join(root, `server/guide/${file}.json`));
  for (const filename of importedData) {
    const file = path.relative(root, filename).replaceAll('\\', '/');
    if (file.startsWith('locales/') || file.startsWith('place-search-') || file === 'server/guide/student_guide_articles.json') continue;
    dataStrings(JSON.parse(fs.readFileSync(filename, 'utf8')), file);
  }
  const guideEnglish = readTranslations('locales/guide-articles-en.json');
  const { createHash } = require('node:crypto');
  const revisions = read('locales/guide-source-revisions.json');
  const normalize = body => body.replaceAll('\\n', '\n').replaceAll('\\u000b', ' ').replaceAll('\u000b', ' ').replace(/\r\n/g, '\n').trimEnd();
  const links = body => [...body.matchAll(/\]\(([^)]*)\)/g)].map(match => match[1]);
  for (const article of read('server/guide/student_guide_articles.json')) {
    add(article.title, 'student_guide_articles.json');
    const pages = [[article.title, article.body], ...Object.entries(article.sourcePages ?? {}).map(([key, page]) => {
      add(page.title, 'student_guide_articles.json'); return [`${article.title}#${key}`, page.body];
    })];
    for (const [key, body] of pages) {
      if (!guideEnglish[key]) issues.push(`Guide body needs an English translation: ${key}`);
      else if (JSON.stringify(links(guideEnglish[key])) !== JSON.stringify(links(body))) issues.push(`Guide translation changed a link or page anchor: ${key}`);
      const hash = createHash('sha256').update(normalize(body)).digest('hex');
      if (revisions[key] !== hash) issues.push(`Guide source changed; update its English translation and source revision: ${key}`);
    }
  }
  for (const [text, location] of found) if (!dictionary[text]) issues.push(`${location}: missing translation: ${text}`);
  for (const [source, value] of Object.entries(dictionary)) for (const language of ['en', 'zh-Hant']) if (!value[language]?.trim() || placeholders(source) !== placeholders(value[language])) issues.push(`Invalid ${language} translation: ${source}`);
  return { total: found.size, issues };
}

function writeCatalog() {
  const dictionary = buildCatalog(), destination = path.join(root, 'locales/messages.json');
  const output = JSON.stringify(dictionary, null, 2) + '\n';
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== output) fs.writeFileSync(destination, output);
  return dictionary;
}
function ensureLocales() {
  const dictionary = writeCatalog(), { total, issues } = auditCatalog(dictionary);
  if (issues.length) throw new Error(`Language release blocked (${issues.length} issue(s)):\n${issues.join('\n')}`);
  return { total, messages: Object.keys(dictionary).length };
}
module.exports = { root, buildCatalog, auditCatalog, writeCatalog, ensureLocales, sourceFiles, readTranslations };
