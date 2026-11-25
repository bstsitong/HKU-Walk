const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(__dirname, '..');
let language = 'en';
const storage = new Map();
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: {
    getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => { storage.set(key, value); },
  }};
  if (name === './guideApi') return { API_BASE: 'https://example.invalid' };
  if (name === 'react-native') return { View: 'View', StyleSheet: { create: value => value } };
  if (name === './LanguageProvider') return { useLanguage: () => ({ language }) };
  if (name === './ui') return {
    Text: ({ raw, children, ...props }) => React.createElement('Text', props, raw ? children : translate(children, language)),
    Pressable: 'Pressable',
  };
  return load.call(this, name, parent, main);
};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
}).outputText, filename);
const { translate } = require('../localization.ts');
const useContentTranslation = require('../useContentTranslation.ts').default;
const PlaceIntroduction = require('../PlaceIntroduction.tsx').default;
let latest;
function Probe(props) { latest = useContentTranslation(props.content, props.language, props.active ?? true); return null; }
async function mount(Component, props) { let renderer; await act(async () => { renderer = create(React.createElement(Component, props)); }); return renderer; }
const update = (renderer, Component, props) => act(async () => renderer.update(React.createElement(Component, props)));
const unmount = renderer => act(async () => renderer.unmount());
const text = renderer => renderer.root.findAllByType('Text').flatMap(node => node.children.filter(child => typeof child === 'string')).join('\n');
const reply = payload => ({ ok: true, json: async () => ({ language: payload.language, sourceVersion: payload.sourceVersion || 'server-revision', texts: payload.sourceTexts.map(value => `${payload.language}: ${value}`) }) });
const content = { kind: 'place', id: 'fixture-study', sourceVersion: 'revision-one', texts: ['自习室 HW312'] };
async function run() {
  let requests = [];
  global.fetch = async (url, options) => { const payload = JSON.parse(options.body); requests.push({ url, payload }); return reply(payload); };
  const probe = await mount(Probe, { content, language: 'en' });
  assert.equal(latest.texts[0], 'en: 自习室 HW312');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /places\/fixture-study\/translation/);
  for (const selected of ['zh-Hant', 'zh-Hans', 'en']) {
    await update(probe, Probe, { content, language: selected });
    assert.equal(latest.texts[0], `${selected}: 自习室 HW312`);
  }
  assert.equal(requests.length, 3, 'Returning to a language reuses its translation');
  const changed = { ...content, texts: ['新的地点简介 HW312'] };
  await update(probe, Probe, { content: changed, language: 'en' });
  assert.equal(latest.texts[0], 'en: 新的地点简介 HW312');
  assert.equal(requests.length, 4, 'Text changes invalidate cache even if revision is unchanged');
  assert.deepEqual(content.texts, ['自习室 HW312'], 'Original records remain intact');
  await unmount(probe);

  let releaseOld;
  global.fetch = (_url, options) => { const payload = JSON.parse(options.body); return payload.language === 'en'
    ? new Promise(resolve => { releaseOld = () => resolve(reply(payload)); }) : Promise.resolve(reply(payload)); };
  const raceContent = { ...content, id: 'fixture-race' };
  const race = await mount(Probe, { content: raceContent, language: 'en' });
  assert.equal(latest.loading, true);
  await update(race, Probe, { content: raceContent, language: 'zh-Hans' });
  assert.equal(latest.texts[0], 'zh-Hans: 自习室 HW312');
  await act(async () => releaseOld());
  assert.equal(latest.texts[0], 'zh-Hans: 自习室 HW312', 'A late response cannot revert the interface language');
  await unmount(race);

  let calls = 0;
  global.fetch = async (_url, options) => { calls++; return reply(JSON.parse(options.body)); };
  const place = { id: 'fixture-component', description: '适合安静自习', updatedAt: 'revision-two' };
  const screen = await mount(PlaceIntroduction, { place: { ...place, description: '' }, active: true });
  assert.equal(text(screen), ''); assert.equal(calls, 0);
  for (const selected of ['en', 'zh-Hant', 'zh-Hans']) {
    language = selected;
    await update(screen, PlaceIntroduction, { place, active: true });
    assert.equal(text(screen), `${selected}: 适合安静自习`);
  }
  assert.equal(calls, 3);
  await unmount(screen);
  language = 'en';
  global.fetch = async () => ({ ok: false, json: async () => ({ code: 'translation_unavailable' }) });
  const error = await mount(PlaceIntroduction, { place: { ...place, id: 'fixture-error' }, active: true });
  assert.ok(!text(error).includes(place.description), 'An error must not silently display another language as a translation');
  assert.ok(text(error).includes('temporarily unavailable'));
  global.fetch = async (_url, options) => reply(JSON.parse(options.body));
  await act(async () => error.root.findByType('Pressable').props.onPress());
  assert.equal(text(error), 'en: 适合安静自习');
  await unmount(error);
  console.log('Passed automatic content language switching, source invalidation, cache reuse, late-response isolation, empty introduction and retry checks.');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = load; });
