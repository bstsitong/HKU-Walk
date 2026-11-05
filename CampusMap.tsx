import { useEffect, useState } from 'react';
import { BackHandler, Keyboard, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert, Image, Pressable, Text, TextInput } from './ui';
import AppIcon, { IconName } from './AppIcon';
import MapCanvas from './MapCanvas';
import StepIllustration from './StepIllustration';
import { Category, Place, categories, categoryIcon, categoryLabel, filterPlaces, findPlace, hasPlacePhoto, placeIcon, placeName, placePhoto, places, routeSteps } from './campus';
import { PlaceRecords } from './usePlaces';
import { t } from './localization';
import { useLanguage } from './LanguageProvider';
import { colors as c } from './theme';

export type MapView = 'home' | 'search' | 'detail' | 'route';
export type MapRequest = { serial: number; view: 'home' | 'detail'; placeId?: string; category?: Category; fromSaved?: boolean };
function IconButton({ icon, label, onPress, selected = false, disabled = false, testID }: { icon: IconName; label: string; onPress: () => void; selected?: boolean; disabled?: boolean; testID?: string }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[s.iconButton, disabled && { opacity: 0.35 }]}><AppIcon name={icon} color={selected ? c.rust : c.green} /></Pressable>;
}
function Action({ label, onPress, secondary = false, icon, testID }: { label: string; onPress: () => void; secondary?: boolean; icon?: IconName; testID?: string }) {
  return <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={[s.action, secondary && s.secondary]}>{icon ? <AppIcon name={icon} color={secondary ? c.green : '#fff'} size={18} /> : null}<Text style={[s.actionLabel, secondary && s.secondaryLabel]}>{label}</Text></Pressable>;
}
export function PlaceRow({ place, onPress, trailing }: { place: Place; onPress: () => void; trailing?: React.ReactNode }) {
  const { language } = useLanguage();
  return <View style={s.placeRow}>
    <Pressable testID={`place-${place.id}`} accessibilityRole="button" onPress={onPress} style={s.placeMain}>
      <View style={s.placeSymbol}><AppIcon name={placeIcon(place)} size={22} /></View>
      <View style={s.flex}><Text style={s.rowTitle}>{placeName(place)}</Text><Text raw style={s.meta}>{language === 'en' ? place.name : place.english}</Text><Text style={s.meta}>{categoryLabel(place.category)}</Text></View>
      {!trailing ? <AppIcon name="chevron" size={17} color={c.muted} /> : null}
    </Pressable>{trailing}
  </View>;
}

function SearchPlaces({ onBack, onChoose, title }: { onBack: () => void; onChoose: (place: Place) => void; title?: string }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const results = filterPlaces(category, query);
  return <View style={s.flex}>
    <View style={s.searchHeader}>
      <IconButton icon="back" label="返回" onPress={onBack} />
      <View style={s.searchInput}><AppIcon name="search" size={18} color={c.muted} /><TextInput testID="place-search" accessibilityLabel={title || '搜索校园地点'} placeholder={title || '搜索名称、英文或简称'} value={query} onChangeText={setQuery} returnKeyType="search" autoCorrect={false} style={s.input} onSubmitEditing={Keyboard.dismiss} />
        {query ? <IconButton icon="close" label="清空搜索" onPress={() => setQuery('')} /> : null}
      </View>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
      {title ? <Text accessibilityRole="header" style={s.sectionTitle}>{title}</Text> : null}
      {!query && category === 'all' ? <>
        <Text style={s.sectionTitle}>常用搜索</Text><View style={s.chips}>{places.slice(0, 3).map(place => <Pressable accessibilityRole="button" key={place.id} onPress={() => setQuery(place.name)} style={s.chip}><Text style={s.chipText}>{placeName(place)}</Text></Pressable>)}</View>
        <Text style={s.sectionTitle}>按类别探索</Text><View style={s.explore}>{categories.filter(item => ['building', 'food', 'toilet', 'access'].includes(item.id)).map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => setCategory(item.id)} style={s.exploreItem}><View style={s.exploreIcon}><AppIcon name={categoryIcon(item.id)} /></View><Text style={s.meta}>{item.label}</Text></Pressable>)}</View>
      </> : <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filters}>{categories.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: category === item.id }} onPress={() => setCategory(item.id)} style={[s.chip, category === item.id && s.selectedChip]}><Text style={[s.chipText, category === item.id && s.white]}>{item.label}</Text></Pressable>)}</ScrollView>}
      <View style={s.sectionHeading}><Text style={s.sectionTitle}>{query || category !== 'all' ? '搜索结果' : '校园地点'}</Text><Text style={s.meta}>{t('{count} 个地点', { count: results.length })}</Text></View>
      {results.map(place => <PlaceRow key={place.id} place={place} onPress={() => { Keyboard.dismiss(); onChoose(place); }} />)}
      {!results.length ? <View style={s.empty}><AppIcon name="search" size={34} color={c.muted} /><Text style={s.rowTitle}>没有找到相关地点</Text><Text style={[s.body, s.center]}>试试建筑的英文名称、简称，或者换一个关键词。</Text><Action secondary label="查看全部地点" onPress={() => { setQuery(''); setCategory('all'); }} /></View> : null}
      <Text style={s.note}>地点资料仅用于本次原型演示</Text>
    </ScrollView>
  </View>;
}

export default function CampusMap({ active, records, sampleLocation, request, onViewChange, onReturnSaved }: {
  active: boolean; records: PlaceRecords; sampleLocation: boolean; request: MapRequest | null; onViewChange: (view: MapView) => void; onReturnSaved: () => void;
}) {
  const { language } = useLanguage();
  const [view, setView] = useState<MapView>('home');
  const [selected, setSelected] = useState(findPlace('main'));
  const [category, setCategory] = useState<Category>('all');
  const [zoom, setZoom] = useState(1);
  const [centerTick, setCenterTick] = useState(0);
  const [origin, setOrigin] = useState(findPlace('gate'));
  const [destination, setDestination] = useState(findPlace('main'));
  const [selector, setSelector] = useState<'origin' | 'destination' | null>(null);
  const [allSteps, setAllSteps] = useState(false);
  const [routeReturn, setRouteReturn] = useState<MapView>('home');
  const [returnView, setReturnView] = useState<MapView>('home');
  const [fromSaved, setFromSaved] = useState(false);
  const changeView = (next: MapView) => { Keyboard.dismiss(); setView(next); onViewChange(next); };
  const detail = (place: Place) => { setFromSaved(false); setSelected(place); records.visit(place.id); setReturnView(view === 'search' ? 'search' : 'home'); changeView('detail'); };
  const back = () => {
    if (selector) { setSelector(null); return; }
    if (view === 'route') { changeView(routeReturn); return; }
    if (view === 'detail' && fromSaved) { setFromSaved(false); changeView('home'); onReturnSaved(); return; }
    changeView(view === 'detail' ? returnView : 'home');
  };
  useEffect(() => {
    if (!request) return;
    setFromSaved(Boolean(request.fromSaved));
    if (request.category) setCategory(request.category);
    if (request.placeId) { const place = findPlace(request.placeId); setSelected(place); if (request.view === 'detail') records.visit(place.id); }
    setReturnView('home'); setView(request.view); onViewChange(request.view);
  }, [request?.serial]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { if (!active || view === 'home') return false; back(); return true; });
    return () => listener.remove();
  }, [active, view, selector, fromSaved, returnView, routeReturn]);
  const startRoute = () => {
    setDestination(selected); setOrigin(findPlace(selected.id === 'gate' ? 'main' : 'gate'));
    setAllSteps(false); setRouteReturn(view); changeView('route');
  };
  const saved = records.saved.includes(selected.id);
  const saveButton = <IconButton testID="save-place" icon="bookmark" label={saved ? '取消收藏' : '收藏地点'} selected={saved} disabled={!records.ready} onPress={() => records.toggle(selected.id)} />;
  if (view === 'search') return <SearchPlaces onBack={back} onChoose={detail} />;
  if (view === 'detail') return <View style={s.flex}>
    <ScrollView contentContainerStyle={s.detailPage}>
      <View style={s.hero}><Image source={placePhoto(selected)} style={s.heroPhoto} resizeMode="cover" accessibilityLabel="港大校园照片" /><View style={s.heroActions}><View style={s.floating}><IconButton icon="back" label="返回" onPress={back} /></View><View style={s.floating}>{saveButton}</View></View><Text style={s.credit}>{selected.id === 'main' ? '本部大楼' : '校园实景'} · HKU</Text></View>
      <View style={s.detailBody}><Text accessibilityRole="header" style={s.title}>{placeName(selected)}</Text><Text raw style={s.meta}>{language === 'en' ? selected.name : selected.english}</Text>
        <View style={[s.chips, s.detailBadges]}><Text style={s.badge}>{categoryLabel(selected.category)}</Text><Text style={s.plainBadge}>校园地点</Text><Text style={s.rustBadge}>资料演示</Text></View>
        <Text style={s.body}>{selected.id === 'main' ? '红砖、拱廊与钟楼，是这栋校园历史建筑的鲜明印记。从这里查看建筑位置，并辨认抵达入口。' : '在地图上确认地点位置，再查看入口与楼层提示。地点及入口资料目前为示例，后续由实地记录完善。'}</Text>
        <View style={s.divider} /><View style={s.sectionHeading}><Text style={s.sectionTitle}>怎么进入这里</Text><Text style={s.meta}>以下为流程示例</Text></View>
        <View style={s.infoRow}><AppIcon name="building" size={20} /><View style={s.flex}><Text style={s.rowTitle}>入口位置</Text><Text style={s.body}>入口说明示例：从建筑前方入口进入。</Text></View></View>
        <View style={s.infoRow}><AppIcon name="lift" size={20} /><View style={s.flex}><Text style={s.rowTitle}>楼层与升降机</Text><Text style={s.body}>楼层说明示例：G/F · 入口层。</Text></View></View>
        <View style={s.divider} /><Text style={s.sectionTitle}>地图位置</Text><View style={s.miniMap}><MapCanvas selected={selected} variant="mini" /></View>
        <Text style={s.note}>照片：HKU Wallpapers。照片只作校园氛围展示，入口位置及路线请以后续实地记录为准。</Text>
      </View>
    </ScrollView><View style={s.footer}>{saveButton}<Action testID="detail-route" icon="walk" label="查看步行路线" onPress={startRoute} /></View>
  </View>;
  if (view === 'route') {
    const steps = routeSteps.map((step, index) => ({ ...step, title: index === 0 ? t('从 {place} 出发', { place: placeName(origin) }) : index === 4 ? t('找到 {place} 入口', { place: placeName(destination) }) : index === 5 ? t('到达 {place}', { place: placeName(destination) }) : t(step.title) }));
    return <View style={s.flex}>
      <View style={s.topBar}><IconButton icon="back" label="返回" onPress={back} /><Text accessibilityRole="header" style={s.topTitle}>步行路线</Text></View>
      <ScrollView contentContainerStyle={s.routePage}>
        <View style={s.endpointGroup}><View style={s.endpoints}>{(['origin', 'destination'] as const).map((key, index) => <Pressable key={key} testID={`route-${key}`} accessibilityRole="button" accessibilityLabel={t(index ? '选择终点' : '选择起点')} onPress={() => setSelector(key)} style={[s.endpoint, index === 0 && s.endpointLine]}><View style={[s.endpointDot, index === 1 && s.endDot]} /><Text style={[s.endpointText, s.flex]}>{placeName(key === 'origin' ? origin : destination)}</Text><AppIcon name="chevron" size={16} /></Pressable>)}</View><IconButton testID="route-swap" icon="swap" label="交换起点和终点" onPress={() => { setOrigin(destination); setDestination(origin); setAllSteps(false); }} /></View>
        <View style={s.routeMap}><MapCanvas selected={destination} origin={origin} variant="route" /><View pointerEvents="none" style={s.mapDemo}><AppIcon name="walk" size={15} /><Text style={s.small}>步行路线示意</Text></View><Text style={s.routeMapNote}>示意地图 · 非实际导航</Text></View>
        <View style={s.routeBody}><View style={s.sectionHeading}><View><Text style={s.body}><Text style={s.duration}>8</Text> 分钟 · 示例</Text><Text style={s.meta}>480 m · 演示步行路线</Text></View><Text style={s.badge}>步行</Text></View>
          <View style={s.walkNote}><AppIcon name="walk" size={17} /><Text style={[s.meta, s.flex]}>步行途中按指引乘坐电梯或经过楼梯。</Text></View>
          <View style={s.sectionHeading}><Text style={s.sectionTitle}>{t('图文路线指引 · {count} 步', { count: steps.length })}</Text><Text style={s.small}>每步配图待完善</Text></View>
          {steps.slice(0, allSteps ? steps.length : 3).map((step, index) => <View key={step.photo} style={s.step}>
            <View style={s.stepTrack}><View style={[s.stepDot, index === 2 && s.stepLift]}><Text style={s.stepNumber}>{index + 1}</Text></View>{index < steps.length - 1 ? <View style={s.stepLine} /> : null}</View>
            <View style={s.stepCopy}><Text style={s.rowTitle}>{step.title}</Text><Text style={s.body}>{step.copy}</Text></View>
            <View style={s.stepPhoto} accessibilityLabel={t(step.photo)}><StepIllustration step={index} /><Text style={s.photoLabel}>{step.photo}</Text><Text style={s.small}>配图待补</Text></View>
          </View>)}
          <Text style={s.note}>距离、用时与通行方式均为演示，请勿据此实际导航。</Text>
        </View>
      </ScrollView><View style={s.footer}><Action testID="route-all-steps" icon={allSteps ? 'map' : 'walk'} label={allSteps ? '返回地图' : t('查看全部 {count} 步', { count: steps.length })} onPress={() => { if (allSteps) { setFromSaved(false); changeView('home'); } else setAllSteps(true); }} /></View>
      <Modal visible={selector !== null} animationType="slide" onRequestClose={() => setSelector(null)}><SafeAreaView style={s.modal}><SearchPlaces title={selector === 'origin' ? '选择起点' : '选择终点'} onBack={() => setSelector(null)} onChoose={place => {
        const other = selector === 'origin' ? destination : origin;
        if (place.id === other.id) { Alert.alert('请选择不同地点', '起点和终点不能相同。'); return; }
        if (selector === 'origin') setOrigin(place); else setDestination(place);
        setAllSteps(false); setSelector(null);
      }} /></SafeAreaView></Modal>
    </View>;
  }
  return <View style={s.flex}>
    <View style={s.mapHome}>
      <MapCanvas selected={selected} category={category} zoom={zoom} onSelect={setSelected} sampleLocation={sampleLocation} centerTick={centerTick} />
      <View pointerEvents="box-none" style={s.homeTop}><View style={s.brandRow}><Text accessibilityRole="header" style={s.brand}>港大漫游</Text><Text style={s.small}>本部 · 百周年</Text></View>
        <Pressable testID="open-search" accessibilityRole="button" onPress={() => { setFromSaved(false); changeView('search'); }} style={s.searchLauncher}><AppIcon name="search" size={20} color={c.muted} /><Text style={[s.body, s.flex]}>想去哪里？搜索校园地点</Text></Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.homeCategories}>{categories.map(item => <Pressable testID={`filter-${item.id}`} key={item.id} accessibilityRole="button" accessibilityState={{ selected: category === item.id }} onPress={() => setCategory(item.id)} style={[s.homeChip, category === item.id && s.selectedChip]}><AppIcon name={categoryIcon(item.id)} size={15} color={category === item.id ? '#fff' : c.muted} /><Text style={[s.chipText, category === item.id && s.white]}>{item.label}</Text></Pressable>)}</ScrollView>
      </View>
      <View style={s.mapTools}><View style={s.compass}><Text style={s.compassArrow}>▲</Text><Text style={s.small}>N</Text></View><View style={s.toolBox}><IconButton icon="plus" label="放大地图" disabled={zoom >= 2.2} onPress={() => setZoom(Math.min(2.2, zoom + 0.3))} /><View style={s.toolDivider} /><IconButton icon="minus" label="缩小地图" disabled={zoom <= 1} onPress={() => setZoom(Math.max(1, zoom - 0.3))} /></View><View style={s.toolBox}><IconButton icon="locate" label="回到演示位置" onPress={() => setCenterTick(value => value + 1)} /></View></View>
      <View style={s.placeSheet}><View style={s.sheetSummary}>{hasPlacePhoto(selected) ? <Image source={placePhoto(selected)} style={s.sheetPhoto} resizeMode="cover" accessibilityLabel="校园地点照片" /> : <View style={[s.sheetPhoto, s.placeSymbol]}><AppIcon name={placeIcon(selected)} /></View>}<View style={s.flex}><Text style={s.rowTitle}>{placeName(selected)}</Text><Text raw style={s.meta}>{language === 'en' ? selected.name : selected.english}</Text><Text style={[s.badge, s.sheetBadge]}>{categoryLabel(selected.category)}</Text></View>{saveButton}</View><View style={s.sheetActions}><Action secondary label="地点详情" onPress={() => detail(selected)} /><Action icon="walk" label="查看路线" onPress={startRoute} /></View></View>
      <Text pointerEvents="none" style={s.homeMapNote}>校园示意图 · 非实际导航</Text>
    </View>
    <Pressable testID="gps-info" accessibilityRole="button" accessibilityLabel="GPS 定位接入说明" onPress={() => Alert.alert('GPS 实时定位', '后续接入 GPS 并获得定位授权后，可在地图上查看自己的实时位置。当前仅显示演示位置，尚未开启实时定位。')} style={s.gpsRow}><View style={s.gpsIcon}><AppIcon name="locate" size={20} /></View><View style={s.flex}><Text style={s.gpsTitle}>GPS 实时定位</Text><Text style={s.small}>接入后查看自己的实时位置</Text></View><Text style={s.rustBadge}>待接入</Text></Pressable>
  </View>;
}

const s = StyleSheet.create({
  flex: { flex: 1 }, white: { color: '#fff' }, center: { textAlign: 'center' },
  page: { padding: 18, paddingTop: 8, paddingBottom: 28, width: '100%', maxWidth: 650, alignSelf: 'center' },
  title: { fontSize: 24, lineHeight: 32, color: c.ink, fontWeight: '800' },
  sectionTitle: { fontSize: 14, lineHeight: 22, fontWeight: '700', color: c.ink, marginVertical: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  body: { fontSize: 13, color: c.muted, lineHeight: 22 }, meta: { fontSize: 11, color: c.muted, lineHeight: 18 }, small: { fontSize: 10, color: c.muted, lineHeight: 16 },
  rowTitle: { fontSize: 14, color: c.ink, fontWeight: '700', lineHeight: 22 }, note: { fontSize: 11, color: c.muted, lineHeight: 20, marginTop: 18, marginBottom: 10 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  action: { flex: 1, minHeight: 46, paddingHorizontal: 10, paddingVertical: 11, backgroundColor: c.green, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionLabel: { fontSize: 13, lineHeight: 20, color: '#fff', fontWeight: '700', textAlign: 'center', flexShrink: 1 }, secondary: { backgroundColor: c.tint }, secondaryLabel: { color: c.green },
  searchHeader: { flexDirection: 'row', alignItems: 'center', paddingRight: 18, paddingVertical: 8 }, searchInput: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: c.tint, borderRadius: 10, paddingLeft: 12 }, input: { flex: 1, minHeight: 48, paddingVertical: 10, paddingHorizontal: 9, fontSize: 14, color: c.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 44, paddingHorizontal: 11, paddingVertical: 12, borderRadius: 8, backgroundColor: c.tint, marginRight: 6, justifyContent: 'center' }, chipText: { fontSize: 11, color: c.ink, lineHeight: 18 }, selectedChip: { backgroundColor: c.green },
  explore: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 12 }, exploreItem: { alignItems: 'center', gap: 8, padding: 5, minWidth: 60 }, exploreIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }, filters: { marginVertical: 8 },
  placeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: c.line }, placeMain: { flex: 1, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }, placeSymbol: { width: 43, height: 48, borderRadius: 10, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: 38, gap: 14 }, detailPage: { paddingBottom: 12 }, hero: { height: 228 }, heroPhoto: { width: '100%', height: '100%' }, heroActions: { position: 'absolute', top: 12, left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between' }, floating: { backgroundColor: c.app, borderRadius: 10 }, credit: { position: 'absolute', bottom: 10, right: 12, backgroundColor: '#203a31d9', borderRadius: 4, paddingHorizontal: 7, paddingVertical: 4, fontSize: 10, color: '#fff' }, detailBody: { padding: 20, maxWidth: 650, width: '100%', alignSelf: 'center' }, detailBadges: { marginTop: 12, marginBottom: 17 }, badge: { fontSize: 10, color: c.green, backgroundColor: c.tint, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 5, overflow: 'hidden', alignSelf: 'flex-start' }, plainBadge: { fontSize: 10, color: c.muted, paddingVertical: 4 }, rustBadge: { fontSize: 10, lineHeight: 16, color: c.rust, backgroundColor: c.rustLight, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5, overflow: 'hidden' }, divider: { height: 1, backgroundColor: c.line, marginTop: 20, marginBottom: 3 }, infoRow: { flexDirection: 'row', gap: 12, marginTop: 12 }, miniMap: { height: 170, overflow: 'hidden', borderRadius: 10 }, footer: { backgroundColor: c.app, borderTopWidth: 1, borderTopColor: c.line, padding: 15, gap: 10, flexDirection: 'row', alignItems: 'center' },
  topBar: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9 }, topTitle: { fontSize: 20, fontWeight: '800', color: c.ink, flex: 1 }, routePage: { paddingBottom: 10 }, endpointGroup: { flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 8, marginBottom: 17, gap: 6 }, endpoints: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: c.line, borderRadius: 13, overflow: 'hidden' }, endpoint: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 55, padding: 13 }, endpointLine: { borderBottomWidth: 1, borderBottomColor: c.line }, endpointDot: { width: 8, height: 8, borderWidth: 2, borderColor: c.green, borderRadius: 4 }, endDot: { borderRadius: 2, backgroundColor: c.rust, borderColor: c.rust }, endpointText: { fontSize: 13, color: c.ink, lineHeight: 20 }, routeMap: { height: 245, marginHorizontal: 8, overflow: 'hidden' }, mapDemo: { position: 'absolute', top: 10, left: 10, backgroundColor: c.app, borderRadius: 6, flexDirection: 'row', gap: 5, padding: 6, alignItems: 'center' }, routeMapNote: { position: 'absolute', bottom: 7, left: 8, color: c.muted, backgroundColor: '#fbfcf8dd', fontSize: 10, padding: 3 }, routeBody: { padding: 18 }, duration: { fontSize: 28, fontWeight: '800', color: c.ink, lineHeight: 36 }, walkNote: { flexDirection: 'row', gap: 7, alignItems: 'center', marginTop: 10 }, step: { flexDirection: 'row', gap: 10, minHeight: 120 }, stepTrack: { alignItems: 'center', width: 26 }, stepDot: { width: 26, height: 28, borderRadius: 9, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }, stepLift: { backgroundColor: c.rustLight }, stepNumber: { color: c.green, fontSize: 12, fontWeight: '700' }, stepLine: { width: 1, flex: 1, backgroundColor: '#b6c8b1' }, stepCopy: { flex: 1, paddingTop: 2, paddingBottom: 20 }, stepPhoto: { width: 92, marginBottom: 15, minHeight: 100, backgroundColor: c.tint, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#c6d1bc', alignItems: 'center', paddingBottom: 6 }, photoLabel: { fontSize: 10, color: c.muted, lineHeight: 17, textAlign: 'center', paddingHorizontal: 3 }, modal: { flex: 1, backgroundColor: c.app },
  mapHome: { flex: 1, minHeight: 330, overflow: 'hidden' }, homeTop: { position: 'absolute', top: 10, left: 16, right: 16 }, brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }, brand: { fontSize: 23, lineHeight: 31, color: c.ink, fontWeight: '800' }, searchLauncher: { backgroundColor: '#fff', minHeight: 50, padding: 12, borderRadius: 11, flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 1, borderColor: c.line }, homeCategories: { gap: 6, paddingVertical: 10 }, homeChip: { minHeight: 44, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 10, gap: 5, flexDirection: 'row', alignItems: 'center', backgroundColor: c.app }, mapTools: { position: 'absolute', right: 12, top: 174, alignItems: 'center', gap: 8 }, compass: { alignItems: 'center', paddingVertical: 4 }, compassArrow: { color: c.green, fontSize: 13 }, toolBox: { backgroundColor: c.app, borderRadius: 9, overflow: 'hidden' }, toolDivider: { height: 1, backgroundColor: c.line, marginHorizontal: 8 }, placeSheet: { position: 'absolute', bottom: 28, left: 15, right: 15, borderRadius: 14, backgroundColor: '#fff', padding: 14, borderWidth: 1, borderColor: c.line }, sheetSummary: { flexDirection: 'row', gap: 11, alignItems: 'center', marginBottom: 12 }, sheetPhoto: { width: 57, height: 64, borderRadius: 9 }, sheetBadge: { marginTop: 5 }, sheetActions: { flexDirection: 'row', gap: 8 }, homeMapNote: { position: 'absolute', bottom: 6, left: 16, color: c.muted, backgroundColor: '#fbfcf8dd', fontSize: 10, padding: 2 }, gpsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 9, backgroundColor: c.app }, gpsIcon: { width: 35, height: 35, borderRadius: 9, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }, gpsTitle: { fontSize: 12, color: c.ink, fontWeight: '700', lineHeight: 19 },
});
