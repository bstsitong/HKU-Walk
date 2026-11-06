// Exercise multilingual search against actual campus data without a device runtime.
const fs = require('fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const { filterPlaces, places, placeName } = require('../campus.ts');
const { setCurrentLanguage, translate, t } = require('../localization.ts');
const cases = [
  ['图书馆','library'], ['圖書館','library'], ['總圖','library'], ['ｌｉｂｒａｒｙ','library'],
  ['Main Lib','library'], ['Main Libary','library'], ['Main Librray','library'], ['图书官','library'],
  ['tu shu guan','library'], ['tushuguan','library'], ['daxuetushu','library'],
  [' CWLC ','chiwah'], ['C.W.L.C.','chiwah'], ['钮鲁诗','knowles'], ['鈕魯詩','knowles'],
  ['mAiN bUiLdInG','main'], ['LBO','library-old'], ['LBN','library-new'], ['CJT','jockey-club-tower'], ['港大站 C1','mtr-c1'], ['黄克竞','haking-wong'], ['地铁','gate'], ['港鐵港大站','gate'], ['花園','garden'], ['wc','toilet'],
];
for (const language of ['zh-Hans','zh-Hant','en']) {
  setCurrentLanguage(language);
  for (const [query, expected] of cases) assert.equal(filterPlaces('all', query)[0]?.id, expected, `${language}: ${query}`);
  assert.equal(filterPlaces('all').length, places.length);
  assert.ok(filterPlaces('building').length > 30);
  assert.equal(filterPlaces('food', 'library').length, 0);
  assert.equal(filterPlaces('food', 'Main Libary').length, 0);
  assert.equal(filterPlaces('all', 'no such place').length, 0);
  assert.equal(filterPlaces('all', '故书').length, 0);
  assert.equal(filterPlaces('all', '---').length, 0);
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
for (const category of [...require('../server/guide/seed.json'), ...require('../server/guide/student_guide_hku_v1.json')]) {
  for (const text of [category.title, category.subtitle, category.introduction, ...category.entries.flatMap(entry => [entry.title, entry.body])].filter(Boolean)) {
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
const { CAMPUS_MAP_VERSION } = require('../MapArtwork.ts');
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
const checked = readCampus({ mapVersion: CAMPUS_MAP_VERSION,places:[newPlace,{...newPlace,id:'community-place-36',x:-1}],routes:[newRoute,{...newRoute,id:'community-route-43',destinationId:'missing'}]});
assert.equal(checked.places.length,1); assert.equal(checked.routes.length,1);
setCommunityCampus(checked.places,checked.routes);
setCurrentLanguage('en');
assert.equal(placeName(getPlace(newPlace.id)),'更多');
assert.equal(filterPlaces('all','New study place')[0].id,newPlace.id);
assert.equal(filterPlaces('all','nsp')[0].id,newPlace.id);
assert.equal(serializeMapDraft('new_place', { ...newPlace }).data.abbreviation, 'NSP');
assert.equal(getCampusRoute(newRoute.id).steps.length,1);
assert.throws(() => readCampus({ mapVersion: 1, places: [newPlace], routes: [] }));
assert.equal(serializeMapDraft('new_place', newPlace).data.mapVersion, CAMPUS_MAP_VERSION);
assert.equal(editMapDraft({ type: 'place', mapVersion: 1, x: 20, y: 60 }).x, null);
assert.equal(editMapDraft({ type: 'place', mapVersion: CAMPUS_MAP_VERSION, x: 20, y: 60 }).x, 20);
const room = { ...newPlace, id: 'community-place-36', name: '學生研討室', english: 'Seminar Room 102', abbreviation: '',
  keywords: '小組討論室, Team Room', description: '这里比较宁静，座位旁有电源插口。', entrance: '东门旁设有电梯。', floor: '三楼' };
const annex = { ...newPlace, id: 'community-place-37', name: '图书馆附楼', english: 'Main Library Annex', abbreviation: '', keywords: '' };
const canteen = { ...newPlace, id: 'community-place-38', name: '红砖食堂', english: 'Red Brick Canteen', abbreviation: '', keywords: '', category: 'food' };
const takeaway = { ...canteen, id: 'community-place-39', name: '松林快餐店', english: 'Pine Takeaway' };
const nailong = { ...canteen, id: 'community-place-40', name: '奶龙', english: 'Nailong',
  description: '供应汉堡和快餐，可外带，也有榴莲千层。' };
const noSockets = { ...room, id: 'community-place-41', name: '榕树学习室', english: 'Banyan Study Room',
  keywords: '', description: '学习空间很安静，不过没有插座。', entrance: '这个入口没有电梯。', floor: '二楼' };
const updatedCatalog = readCampus({ mapVersion: CAMPUS_MAP_VERSION, places: [newPlace, room, annex, canteen, takeaway, nailong, noSockets], routes: [] });
setCommunityCampus(updatedCatalog.places, updatedCatalog.routes);
assert.equal(filterPlaces('all', '学生研讨室')[0].id, room.id);
assert.equal(filterPlaces('all', 'xiaozutaolunshi')[0].id, room.id);
assert.equal(filterPlaces('all', 'Team Room')[0].id, room.id);
assert.deepEqual(filterPlaces('all', 'Seminar Room 101'), []);
assert.equal(filterPlaces('all', 'Main Library', [annex.id])[0].id, 'library');
assert.equal(filterPlaces('all', 'Main Lib', [annex.id])[0].id, annex.id);
const foodIds = [...places.filter(place => place.category === 'food' && !place.isCommunity).map(place => place.id), canteen.id, takeaway.id, nailong.id].sort();
for (const query of ['吃饭的地方', '想找个地方吃饭', '請問附近有沒有吃飯的地方？', '想在港大吃饭',
  '附近有什么好吃的', '想找能垫垫肚子的地方', '食嘢', '找吃的', 'Where can I eat on campus?', 'Find me something to eat']) {
  assert.deepEqual(filterPlaces('all', query).map(place => place.id).sort(), foodIds, query);
}
assert.deepEqual(filterPlaces('study', '吃饭的地方'), []);
assert.deepEqual(filterPlaces('food', '吃饭的地方').map(place => place.id).sort(), foodIds);
assert.deepEqual(filterPlaces('all', '红砖食堂').map(place => place.id), [canteen.id]);
assert.deepEqual(filterPlaces('all', '快餐店').map(place => place.id), [takeaway.id, nailong.id]);
for (const query of ['哪里能吃汉堡？', 'any burgers on campus', '想找能买榴莲千层的地方', '我想去奶龙']) {
  assert.deepEqual(filterPlaces('all', query).map(place => place.id), [nailong.id], query);
}
for (const query of ['我想找个安静有插座的地方自习', 'I want somewhere to study with power sockets', '想找在三楼的地点']) {
  assert.deepEqual(filterPlaces('all', query).map(place => place.id), [room.id], query);
}
assert.deepEqual(filterPlaces('all', '哪里有升降机').map(place => place.id), ['east-gate', room.id]);
assert.deepEqual(filterPlaces('all', 'Where is a restroom?').map(place => place.id), ['toilet']);
assert.ok(filterPlaces('all', '我想找地方自习').every(place => place.category === 'study'));
assert.ok(filterPlaces('all', '我想找地方自习').some(place => place.id === room.id));
setCommunityCampus([],[]);
assert.equal(getPlace(newPlace.id),undefined);
assert.deepEqual(readRouteBookmarks([shared]),[shared]);
console.log('Passed: conversational category and detail search for newly published places, route bookmarks, catalog validation, map drafts and step photos.');

// Known OSM entrance coordinates used in drawing the campus map.
const { projectCampusLocation } = require('../campusLocation.ts');
for (const [id, lat, lon] of [['gate', 22.2832689, 114.1367440], ['mtr-c1', 22.2844548, 114.1346392]]) {
  const point = projectCampusLocation(lat, lon, 25);
  const entrance = getPlace(id);
  assert.ok(Math.abs(point.x - entrance.x) < 0.01 && Math.abs(point.y - entrance.y) < 0.03, id);
  assert.equal(point.accuracy, 25);
  assert.ok(point.radius > 10 && point.radius < 11);
}
assert.deepEqual(projectCampusLocation(22.28491, 114.13283, null), { x: 0, y: 0, accuracy: null, radius: null });
assert.deepEqual(projectCampusLocation(22.28028, 114.14104, -1), { x: 360, y: 580, accuracy: null, radius: null });
assert.equal(projectCampusLocation(22.29, 114.137, 10), null);
assert.equal(projectCampusLocation(22.283, 114.15, 10), null);
assert.equal(projectCampusLocation(NaN, 114.137, 10), null);
console.log('Passed: entrance alignment, map boundaries and GPS accuracy scaling.');

const { fromMapView, toMapView, mapCandidates, centreMapOn, mapScreenCentre, moveMapCamera } = require('../mapCamera.ts');
const { campusMapSvg, MAP_HEIGHT } = require('../MapArtwork.ts');
assert.deepEqual(toMapView({ x: 0, y: 0 }), { x: 360, y: MAP_HEIGHT });
assert.deepEqual(fromMapView({ x: 0, y: 0 }), { x: 360, y: 580 });
assert.deepEqual(fromMapView(toMapView({ x: 124, y: 307 })), { x: 124, y: 307 });
assert.match(campusMapSvg(label => label), /transform="rotate\(180 180 109\.7\)"/);
const gate = toMapView(getPlace('gate'));
const liveGate = toMapView(projectCampusLocation(22.2832689, 114.136744, null));
assert.ok(Math.hypot(gate.x - liveGate.x, gate.y - liveGate.y) < 0.02);

const viewport = { width: 360, height: 540 };
const focal = mapScreenCentre(viewport);
const fit = centreMapOn({ x: 180, y: 290 }, 1, viewport);
const closer = moveMapCamera(fit, 2, focal, focal, viewport);
assert.equal(closer.x + (focal.x - fit.x) * 2, focal.x);
assert.equal(closer.y + (focal.y - fit.y) * 2, focal.y);
const dragged = moveMapCamera(closer, 2, focal, { ...focal, x: focal.x + 50 }, viewport);
assert.equal(dragged.x, closer.x + 50);
assert.equal(moveMapCamera(dragged, 100, focal, focal, viewport).zoom, 4);
const overview = mapCandidates(places, 'main', 'all', 1);
const midZoom = mapCandidates(places, 'main', 'all', 1.7);
const closeZoom = mapCandidates(places, 'main', 'all', 3);
assert.ok(overview.length < midZoom.length && midZoom.length < closeZoom.length);
assert.equal(overview[0].id, 'main');
assert.ok(!overview.some(place => place.id === 'cafe') && closeZoom.some(place => place.id === 'cafe'));
assert.equal(mapCandidates(places, 'cafe', 'all', 1)[0].id, 'cafe');
assert.ok(mapCandidates(filterPlaces('food'), 'main', 'food', 1).some(place => place.id === 'cafe'));
console.log('Passed: south-up rendering, pin alignment, focal zoom, panning and map detail levels.');
