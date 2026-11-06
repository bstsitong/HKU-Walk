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
assert.equal(t('{title}，{status}', { title: '更多', status: t('待审核') }), '更多, Pending');
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
const { readRouteBookmarks, demoRouteId } = require('../routeBookmarks.ts');
const { emptyMapDraft, serializeMapDraft, validateMapDraft, editMapDraft } = require('../mapSubmission.ts');
const { readCampus } = require('../campusCatalog.ts');
const { setCommunityCampus, getPlace, getCampusRoute } = require('../campus.ts');
const demo = { id: demoRouteId('gate','library'), originId: 'gate', destinationId: 'library', source: 'demo' };
const shared = { id: 'community-route-42', originId: 'gate', destinationId: 'community-place-35', source: 'community' };
assert.deepEqual(readRouteBookmarks(JSON.parse(JSON.stringify([demo,shared,demo,{...demo,destinationId:'gate'},{...shared,id:'other'}]))), [demo,shared]);
assert.ok(validateMapDraft('new_place', emptyMapDraft('new_place')));
assert.equal(validateMapDraft('new_place',{ x: 360, y: 580, category: 'study' }), null);
assert.ok(validateMapDraft('new_route',{ originId:'gate',destinationId:'gate',steps:[{title:'a',body:'b'}] }));
const edit = editMapDraft({ originId:'gate',destinationId:'library',steps:[{title:'A',body:'a',imageUrl:'/api/images/a',sourceIndex:0},{title:'B',body:'b',imageUrl:'/api/images/b',sourceIndex:1}] });
edit.steps.reverse();
const serialized = serializeMapDraft('new_route',edit);
assert.deepEqual(serialized.inherit,{'0':1,'1':0});
assert.deepEqual(serialized.data.steps,[{title:'B',body:'b'},{title:'A',body:'a'}]);
edit.steps[0].removeImage = true;
edit.steps[1].image = {uri:'local:test',name:'new.jpg',type:'image/jpeg'};
const changed = serializeMapDraft('new_route',edit);
assert.deepEqual(changed.removed,[0]); assert.deepEqual(changed.inherit,{}); assert.equal(changed.uploads[0].index,1);
const newPlace = {id:'community-place-35',entryId:'35',name:'更多',english:'New study place',abbreviation:'NSP',keywords:'',category:'study',x:100,y:200,isCommunity:true};
const newRoute = {id:'community-route-42',entryId:'42',title:'My route',body:'Route details',originId:'gate',destinationId:newPlace.id,steps:[{title:'Step',body:'Walk to the entrance'}],isCommunity:true,updatedAt:'2026-11-06'};
const checked = readCampus({places:[newPlace,{...newPlace,id:'community-place-36',x:-1}],routes:[newRoute,{...newRoute,id:'community-route-43',destinationId:'missing'}]});
assert.equal(checked.places.length,1); assert.equal(checked.routes.length,1);
setCommunityCampus(checked.places,checked.routes);
setCurrentLanguage('en');
assert.equal(placeName(getPlace(newPlace.id)),'更多');
assert.equal(filterPlaces('all','New study place')[0].id,newPlace.id);
assert.equal(filterPlaces('all','nsp')[0].id,newPlace.id);
assert.equal(serializeMapDraft('new_place', { ...newPlace }).data.abbreviation, 'NSP');
assert.equal(getCampusRoute(newRoute.id).steps.length,1);
setCommunityCampus([],[]);
assert.equal(getPlace(newPlace.id),undefined);
assert.deepEqual(readRouteBookmarks([shared]),[shared]);
console.log('Passed: route bookmark persistence and identity, community search, catalog validation, new map drafts, photo inheritance and step reordering.');
