import { useEffect, useState } from 'react';
import { BackHandler, Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import { Alert, Image, Pressable, Text } from './ui';
import AppIcon, { IconName } from './AppIcon';
import { AuthorByline } from './AuthorIdentity';
import MapCanvas from './MapCanvas';
import { Category, Place, categories, categoryIcon, categoryLabel, findPlace, getCampusRoute, getPlace, hasPlacePhoto, placeIcon, placeName, placePhoto, places } from './campus';
import { PlaceRecords } from './usePlaces';
import { t } from './localization';
import { useLanguage } from './LanguageProvider';
import { colors as c } from './theme';
import PlaceSearch from './PlaceSearch';
import RouteScreen from './RouteScreen';
import { RouteRecords } from './useSavedRoutes';
import { RouteBookmark } from './routeBookmarks';
import useCampus from './useCampus';
import useCampusLocation from './useCampusLocation';
import { MAX_MAP_ZOOM, MIN_MAP_ZOOM } from './mapCamera';

const locationMessages = {
  idle: '授权后在校园地图上显示当前位置',
  requesting: '等待定位权限',
  searching: '正在获取当前位置…',
  slow: '暂未获取位置，可到室外再试',
  located: '已找到当前位置',
  outside: '你的位置在校园底图范围外',
  imprecise: '定位精度较低，可到室外再试',
  denied: '未获得定位权限，点此重试',
  blocked: '请在系统设置中允许定位',
  disabled: '请开启手机的定位服务后重试',
  unavailable: '暂时无法获取位置，点此重试',
} as const;

export type MapView = 'home' | 'search' | 'detail' | 'route';
export type MapRequest = { serial: number; view: 'home' | 'detail' | 'route'; route?: RouteBookmark; placeId?: string; category?: Category; fromSaved?: boolean };
function IconButton({ icon, label, onPress, selected = false, disabled = false, testID }: { icon: IconName; label: string; onPress: () => void; selected?: boolean; disabled?: boolean; testID?: string }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[s.iconButton, disabled && { opacity: 0.35 }]}><AppIcon name={icon} color={selected ? c.rust : c.green} /></Pressable>;
}
function Action({ label, onPress, secondary = false, icon, testID }: { label: string; onPress: () => void; secondary?: boolean; icon?: IconName; testID?: string }) {
  return <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={[s.action, secondary && s.secondary]}>{icon ? <AppIcon name={icon} color={secondary ? c.green : '#fff'} size={18} /> : null}<Text style={[s.actionLabel, secondary && s.secondaryLabel]}>{label}</Text></Pressable>;
}
export default function CampusMap({ active, records, routes, campus, sampleLocation, request, onViewChange, onReturnSaved, onVisitRoute, onCommentPlace }: {
  active: boolean; records: PlaceRecords; routes: RouteRecords; campus: ReturnType<typeof useCampus>; sampleLocation: boolean; request: MapRequest | null; onViewChange: (view: MapView) => void; onReturnSaved: () => void; onVisitRoute: (route: RouteBookmark) => void;
  onCommentPlace: (place: Place) => void;
}) {
  const { language } = useLanguage();
  const [view, setView] = useState<MapView>('home');
  const [selected, setSelected] = useState(findPlace('main'));
  const [category, setCategory] = useState<Category>('all');
  const [zoom, setZoom] = useState(MIN_MAP_ZOOM);
  const [centerTick, setCenterTick] = useState(0);
  const [origin, setOrigin] = useState(findPlace('gate'));
  const [destination, setDestination] = useState(findPlace('main'));
  const [preferredRoute, setPreferredRoute] = useState<RouteBookmark | null>(null);
  const [routeReturn, setRouteReturn] = useState<MapView>('home');
  const [returnView, setReturnView] = useState<MapView>('home');
  const [fromSaved, setFromSaved] = useState(false);
  const location = useCampusLocation(active && view === 'home');
  const locating = location.status === 'requesting';
  const showDemo = sampleLocation && location.status === 'idle';
  const hasLocation = Boolean(location.point);
  const centerLocation = () => { setZoom(value => Math.max(1.4, value)); setCenterTick(value => value + 1); };
  useEffect(() => { if (hasLocation) centerLocation(); }, [hasLocation]);
  const accuracy = location.point?.accuracy;
  const locationMessage = showDemo ? t('演示蓝点，点此开启实时定位') : accuracy == null
    ? t(locationMessages[location.status]) : t('定位精度约 {meters} 米', { meters: Math.max(1, Math.round(accuracy)) });
  const locationAction = location.tracking ? '停止定位' : location.status === 'blocked' ? '去设置' : '开启定位';
  const changeView = (next: MapView) => { Keyboard.dismiss(); setView(next); onViewChange(next); };
  const detail = (place: Place) => { setFromSaved(false); setSelected(place); records.visit(place.id); setReturnView(view === 'search' ? 'search' : 'home'); changeView('detail'); };
  const back = () => {
    if (view === 'route') { if (fromSaved && routeReturn === 'home') { setFromSaved(false); changeView('home'); onReturnSaved(); } else changeView(routeReturn); return; }
    if (view === 'detail' && fromSaved) { setFromSaved(false); changeView('home'); onReturnSaved(); return; }
    changeView(view === 'detail' ? returnView : 'home');
  };
  useEffect(() => {
    if (!request) return;
    setFromSaved(Boolean(request.fromSaved));
    if (request.view === 'route' && request.route) {
      const shared = request.route.source === 'community' ? getCampusRoute(request.route.id) : undefined;
      const start = getPlace(shared?.originId || request.route.originId), end = getPlace(shared?.destinationId || request.route.destinationId);
      if (!start || !end || (request.route.source === 'community' && !shared)) { Alert.alert('路线暂不可用', '路线已下线或暂时无法读取'); changeView('home'); if (request.fromSaved) onReturnSaved(); return; }
      setOrigin(start); setDestination(end); setSelected(end); setPreferredRoute(request.route); setRouteReturn('home'); changeView('route'); return;
    }
    if (request.category) setCategory(request.category);
    if (request.placeId) { const place = findPlace(request.placeId); setSelected(place); if (request.view === 'detail') records.visit(place.id); }
    setReturnView('home'); setView(request.view); onViewChange(request.view);
  }, [request?.serial]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { if (!active || view === 'home') return false; back(); return true; });
    return () => listener.remove();
  }, [active, view, fromSaved, returnView, routeReturn]);
  const startRoute = () => {
    setDestination(selected); setOrigin(findPlace(selected.id === 'gate' ? 'main' : 'gate'));
    setPreferredRoute(null); setRouteReturn(view); changeView('route');
  };
  useEffect(() => {
    const latest = getPlace(selected.id);
    if (latest) setSelected(latest);
    else { setSelected(findPlace('main')); if (view === 'detail') { Alert.alert('地点暂不可用', '地点已下线或暂时无法读取'); changeView('home'); } }
    const currentOrigin = getPlace(origin.id), currentDestination = getPlace(destination.id);
    if (currentOrigin && currentDestination) { setOrigin(currentOrigin); setDestination(currentDestination); }
    else { setOrigin(findPlace('gate')); setDestination(findPlace('main')); setPreferredRoute(null); if (view === 'route') changeView('home'); }
  }, [campus.catalog]);
  const saved = records.saved.includes(selected.id);
  const saveButton = <IconButton testID="save-place" icon="bookmark" label={saved ? '取消收藏' : '收藏地点'} selected={saved} disabled={!records.ready} onPress={() => records.toggle(selected.id)} />;
  if (view === 'search') return <PlaceSearch onBack={back} onChoose={detail} recentPlaceIds={records.recent} />;
  if (view === 'detail') return <View style={s.flex}>
    <ScrollView contentContainerStyle={s.detailPage}>
      <View style={s.hero}>
        {selected.id === 'main' || selected.imageUrl
          ? <Image source={placePhoto(selected)} style={s.heroPhoto} resizeMode="cover" accessibilityLabel="校园地点照片" />
          : <MapCanvas selected={selected} variant="mini" />}
        <View style={s.heroActions}><View style={s.floating}><IconButton icon="back" label="返回" onPress={back} /></View><View style={s.floating}>{saveButton}</View></View>
        <Text style={s.credit}>{selected.imageUrl ? '投稿配图' : selected.id === 'main' ? '本部大楼 · HKU' : '地图位置'}</Text>
      </View>
      <View style={s.detailBody}><Text raw={selected.isCommunity} accessibilityRole="header" style={s.title}>{placeName(selected)}</Text><Text raw style={s.meta}>{[language === 'en' && !selected.isCommunity ? selected.name : selected.english, selected.abbreviation].filter(Boolean).join(' · ')}</Text>
        <View style={[s.chips, s.detailBadges]}><Text style={s.badge}>{categoryLabel(selected.category)}</Text><Text style={s.rustBadge}>{selected.isCommunity ? '同学提供' : '校园地图资料'}</Text></View>
        {selected.authorProfile ? <AuthorByline author={selected.authorProfile} /> : null}
        {selected.description ? <Text raw={selected.isCommunity} style={s.body}>{selected.description}</Text> : null}
        <Pressable testID="detail-comments" accessibilityRole="button" onPress={() => onCommentPlace(selected)} style={s.commentsLink}>
          <AppIcon name="comment" size={20} /><Text style={[s.rowTitle, s.flex]}>地点评论</Text><AppIcon name="chevron" size={16} />
        </Pressable>
        <View style={s.divider} /><View style={s.sectionHeading}><Text style={s.sectionTitle}>怎么进入这里</Text></View>
        <View style={s.infoRow}><AppIcon name="building" size={20} /><View style={s.flex}><Text style={s.rowTitle}>入口位置</Text><Text raw={selected.isCommunity && Boolean(selected.entrance)} style={s.body}>{selected.entrance || '入口资料待补充'}</Text></View></View>
        <View style={s.infoRow}><AppIcon name="lift" size={20} /><View style={s.flex}><Text style={s.rowTitle}>楼层与升降机</Text><Text raw={selected.isCommunity && Boolean(selected.floor)} style={s.body}>{selected.floor || '楼层资料待补充'}</Text></View></View>
        {selected.id === 'main' || selected.imageUrl ? <><View style={s.divider} /><Text style={s.sectionTitle}>地图位置</Text><View style={s.miniMap}><MapCanvas selected={selected} variant="mini" /></View></> : null}
        <Text style={s.note}>{selected.isCommunity ? '地点位置由投稿人点选。' : '图标标出地点或所在楼宇，入口与开放情况以现场为准。'}</Text>
      </View>
    </ScrollView><View style={s.footer}>{saveButton}<Action testID="detail-route" icon="walk" label="查看步行路线" onPress={startRoute} /></View>
  </View>;
  if (view === 'route') return <RouteScreen initialOrigin={origin} initialDestination={destination} initialRouteId={preferredRoute?.source === 'community' ? preferredRoute.id : undefined} preferDemo={preferredRoute?.source === 'demo'} records={routes} recentPlaceIds={records.recent} onBack={back} onMap={(place?: Place) => { if (place) setSelected(place); setFromSaved(false); setCategory('all'); changeView('home'); }} active={active} onVisit={onVisitRoute} catalogVersion={campus.catalog} />;
  return <View style={s.flex}>
    <View style={s.mapHome}>
      <MapCanvas selected={selected} category={category} zoom={zoom} onZoomChange={setZoom} onSelect={setSelected} sampleLocation={showDemo} livePosition={location.point} centerTick={centerTick} />
      <View pointerEvents="box-none" style={s.homeTop}><View style={s.brandRow}><Text accessibilityRole="header" style={s.brand}>港大漫游</Text><Text style={s.small}>本部 · 百周年</Text></View>
        <Pressable testID="open-search" accessibilityRole="button" onPress={() => { setFromSaved(false); changeView('search'); }} style={s.searchLauncher}><AppIcon name="search" size={20} color={c.muted} /><Text style={[s.body, s.flex]}>想去哪里？搜索校园地点</Text></Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.homeCategories}>{categories.map(item => <Pressable testID={`filter-${item.id}`} key={item.id} accessibilityRole="button" accessibilityState={{ selected: category === item.id }} onPress={() => setCategory(item.id)} style={[s.homeChip, category === item.id && s.selectedChip]}><AppIcon name={categoryIcon(item.id)} size={15} color={category === item.id ? '#fff' : c.muted} /><Text style={[s.chipText, category === item.id && s.white]}>{item.label}</Text></Pressable>)}</ScrollView>
      </View>
      <View style={s.mapTools}><View style={s.compass} accessible accessibilityLabel={t('北方在地图下方')}><Text style={s.compassArrow}>▼</Text><Text style={s.small}>N</Text></View><View style={s.toolBox}><IconButton icon="plus" label="放大地图" disabled={zoom >= MAX_MAP_ZOOM} onPress={() => setZoom(Math.min(MAX_MAP_ZOOM, zoom * 1.4))} /><View style={s.toolDivider} /><IconButton icon="minus" label="缩小地图" disabled={zoom <= MIN_MAP_ZOOM} onPress={() => setZoom(Math.max(MIN_MAP_ZOOM, zoom / 1.4))} /></View>
        <View style={s.toolBox}><IconButton testID="locate-me" icon="locate" label={showDemo ? '回到演示位置' : hasLocation ? '回到我的位置' : '开启定位'} disabled={locating || (location.tracking && !hasLocation)}
          onPress={() => { if (hasLocation || showDemo) centerLocation(); else void location.start(); }} /></View>
      </View>
      <View style={s.placeSheet}><View style={s.sheetSummary}>{hasPlacePhoto(selected) ? <Image source={placePhoto(selected)} style={s.sheetPhoto} resizeMode="cover" accessibilityLabel="校园地点照片" /> : <View style={[s.sheetPhoto, s.placeSymbol]}><AppIcon name={placeIcon(selected)} /></View>}<View style={s.flex}><Text raw={selected.isCommunity} style={s.rowTitle}>{placeName(selected)}</Text><Text raw style={s.meta}>{language === 'en' && !selected.isCommunity ? selected.name : selected.english}</Text><Text style={[s.badge, s.sheetBadge]}>{categoryLabel(selected.category)}</Text></View>{saveButton}</View><View style={s.sheetActions}><Action secondary label="地点详情" onPress={() => detail(selected)} /><Action icon="walk" label="查看路线" onPress={startRoute} /></View></View>
      <Text pointerEvents="none" style={s.homeMapNote}>© OpenStreetMap</Text>
    </View>
    {campus.error ? <Pressable accessibilityRole="button" onPress={() => void campus.reload()} style={{ padding: 10, backgroundColor: c.rustLight }}><Text style={s.meta}>{campus.error}</Text><Text style={s.meta}>点击重新加载</Text></Pressable> : null}
    <Pressable testID="gps-info" accessibilityRole="button" accessibilityLabel={locationAction} accessibilityHint={locationMessage} disabled={locating}
      onPress={() => { if (location.tracking) location.stop(); else void location.start(); }} style={s.gpsRow}>
      <View style={s.gpsIcon}><AppIcon name="locate" size={20} /></View>
      <View style={s.flex}><Text style={s.gpsTitle}>GPS 实时定位</Text><Text raw accessibilityLiveRegion="polite" style={s.small}>{locationMessage}</Text></View>
      <Text style={hasLocation ? s.badge : s.rustBadge}>{locating ? '等待授权' : locationAction}</Text>
    </Pressable>
  </View>;
}

const s = StyleSheet.create({
  commentsLink: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, marginTop: 8 },
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
