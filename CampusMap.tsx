import { useEffect, useState } from 'react';
import { BackHandler, Keyboard, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Alert, Image, Pressable, Text } from './ui';
import AppIcon, { IconName } from './AppIcon';
import { AuthorByline } from './AuthorIdentity';
import MapCanvas from './MapCanvas';
import { Category, Place, CampusRoute, campusRoutes, categories, categoryIcon, categoryLabel, classroomBuilding, findPlace, getCampusRoute, getPlace, hasPlacePhoto, isPublishedPlace, mapPlace, placeIcon, placeName, placePhoto } from './campus';
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
import { CampusFacility, facilityName, facilityStyles } from './campusFacilities';
import PlaceIntroduction from './PlaceIntroduction';

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
const initialMapZoom = 1.4;

export type MapView = 'home' | 'search' | 'detail' | 'route';
export type MapRequest = { serial: number; view: 'home' | 'detail' | 'route'; route?: RouteBookmark; placeId?: string; category?: Category; fromSaved?: boolean };
function IconButton({ icon, label, onPress, selected = false, disabled = false, testID }: { icon: IconName; label: string; onPress: () => void; selected?: boolean; disabled?: boolean; testID?: string }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.iconButton, pressed && s.pressed, disabled && s.disabled]}><AppIcon name={icon} size={20} color={selected ? c.rust : c.ink} /></Pressable>;
}
function Action({ label, onPress, secondary = false, icon, testID }: { label: string; onPress: () => void; secondary?: boolean; icon?: IconName; testID?: string }) {
  return <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.action, secondary && s.secondary, pressed && (secondary ? s.pressed : s.primaryPressed)]}>{icon ? <AppIcon name={icon} color={secondary ? c.ink : c.surface} size={18} /> : null}<Text style={[s.actionLabel, secondary && s.secondaryLabel]}>{label}</Text></Pressable>;
}

function FacilitySheet({ facilities, onClose }: { facilities: readonly CampusFacility[] | null; onClose: () => void }) {
  const { language } = useLanguage();
  return <View style={[s.placeSheet, s.facilitySheet]} testID="map-facility-sheet">
    {facilities ? <>
      <View style={s.facilityHeader}><Text accessibilityRole="header" style={s.rowTitle}>地图设施</Text>
        <IconButton icon="close" label="关闭设施详情" onPress={onClose} />
      </View>
      <ScrollView style={s.facilityScroll} keyboardShouldPersistTaps="handled">
        {facilities.map(facility => {
          const { icon, color } = facilityStyles[facility.kind];
          return <View key={facility.id} style={s.facilityRow}>
            <AppIcon name={icon} color={color} size={18} />
            <View style={s.flex}><Text raw style={s.rowTitle}>{facilityName(facility, language)}</Text>
              <Text style={s.body}>{facility.detail}</Text>
              {facility.approximate ? <Text style={s.meta}>点位为示意，具体位置以现场为准。</Text> : null}
            </View>
          </View>;
        })}
      </ScrollView>
    </> : <>
      <Text accessibilityRole="header" style={s.rowTitle}>地图设施</Text>
      <View style={s.facilityLegend}>
        {Object.values(facilityStyles).map(({ icon, color, label }) => <View key={icon} style={s.legendItem}>
          <AppIcon name={icon} color={color} size={16} /><Text style={s.legendLabel}>{label}</Text>
        </View>)}
      </View>
      <Text style={s.meta}>放大查看更多设施，点图标查看位置和楼层。</Text>
    </>}
  </View>;
}
export default function CampusMap({ active, records, routes, campus, sampleLocation, request, onViewChange, onReturnSaved, onVisitRoute, onCommentPlace, routeImages }: {
  active: boolean; records: PlaceRecords; routes: RouteRecords; campus: ReturnType<typeof useCampus>; sampleLocation: boolean; request: MapRequest | null; onViewChange: (view: MapView) => void; onReturnSaved: () => void; onVisitRoute: (route: RouteBookmark) => void;
  onCommentPlace: (place: Place) => void;
  routeImages: ReadonlyMap<string, string>;
}) {
  const { language } = useLanguage();
  const { height, fontScale } = useWindowDimensions();
  const compactTools = height / Math.max(1, fontScale) < 680;
  const [view, setView] = useState<MapView>('home');
  const [selected, setSelected] = useState<Place | null>(null);
  const [category, setCategory] = useState<Category>('all');
  const [facilitiesOnly, setFacilitiesOnly] = useState(false);
  const [facilitySelection, setFacilitySelection] = useState<readonly CampusFacility[] | null>(null);
  const [zoom, setZoom] = useState(initialMapZoom);
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
  const changeView = (next: MapView) => { Keyboard.dismiss(); setFacilitySelection(null); setView(next); onViewChange(next); };
  const chooseCategory = (next: Category) => { setFacilitySelection(null); setFacilitiesOnly(false); setCategory(next); };
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
    if (request.category) chooseCategory(request.category);
    const place = request.placeId ? getPlace(request.placeId) : undefined;
    if (request.placeId) setSelected(place ?? null);
    if (request.view === 'detail') {
      if (!place) {
        Alert.alert('地点暂不可用', '地点已下线或暂时无法读取');
        changeView('home');
        if (request.fromSaved) onReturnSaved();
        return;
      }
      records.visit(place.id);
    }
    setReturnView('home'); setView(request.view); onViewChange(request.view);
  }, [request?.serial]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!active) return false;
      if (facilitySelection && view === 'home') { setFacilitySelection(null); return true; }
      if (view === 'home') return false;
      back();
      return true;
    });
    return () => listener.remove();
  }, [active, view, fromSaved, returnView, routeReturn, facilitySelection]);
  const startRoute = (place: Place) => {
    const available = campusRoutes.filter(route => route.destinationId === place.id);
    const shared = available.find(route => route.originId === 'gate') ?? available[0];
    setDestination(place); setOrigin(findPlace(shared?.originId ?? (place.id === 'gate' ? 'main' : 'gate')));
    setPreferredRoute(shared ? { id: shared.id, originId: shared.originId, destinationId: shared.destinationId, source: 'community' } : null);
    setRouteReturn(view); changeView('route');
  };
  const openPublishedRoute = (route: CampusRoute) => {
    const start = getPlace(route.originId), end = getPlace(route.destinationId);
    if (!start || !end) return;
    setFromSaved(false); setOrigin(start); setDestination(end); setSelected(end);
    setPreferredRoute({ id: route.id, originId: route.originId, destinationId: route.destinationId, source: 'community' });
    setRouteReturn('search'); changeView('route');
  };
  useEffect(() => {
    if (selected) {
      const latest = getPlace(selected.id);
      setSelected(latest ?? null);
      if (!latest && view === 'detail') {
        Alert.alert('地点暂不可用', '地点已下线或暂时无法读取');
        changeView('home');
      }
    }
    const currentOrigin = getPlace(origin.id), currentDestination = getPlace(destination.id);
    if (currentOrigin && currentDestination) { setOrigin(currentOrigin); setDestination(currentDestination); }
    else { setOrigin(findPlace('gate')); setDestination(findPlace('main')); setPreferredRoute(null); if (view === 'route') changeView('home'); }
  }, [campus.catalog]);
  const saved = selected ? records.saved.includes(selected.id) : false;
  const building = selected ? classroomBuilding(selected) : undefined;
  const placeSubtitle = selected ? [language !== 'en' ? selected.english : '', !building && selected.abbreviation].filter(Boolean).join(' · ') : '';
  const saveButton = selected && <IconButton testID="save-place" icon="bookmark" label={saved ? '取消收藏' : '收藏地点'} selected={saved} disabled={!records.ready} onPress={() => records.toggle(selected.id)} />;
  if (view === 'search') return <PlaceSearch onBack={back} onChoose={detail} onChooseRoute={openPublishedRoute} recentPlaceIds={records.recent} />;
  if (view === 'detail' && selected) return <View style={s.flex}>
    <ScrollView contentContainerStyle={s.detailPage}>
      <View style={s.hero}>
        {selected.id === 'main' || selected.imageUrl
          ? <Image source={placePhoto(selected)} style={s.heroPhoto} resizeMode={selected.isCommunity ? 'contain' : 'cover'} accessibilityLabel="校园地点照片" />
          : <MapCanvas selected={selected} variant="mini" />}
        <View style={s.heroActions}><View style={s.floating}><IconButton icon="back" label="返回" onPress={back} /></View><View style={s.floating}>{saveButton}</View></View>
        <Text style={s.credit}>{building ? '教室所在楼宇' : selected.imageUrl ? '投稿配图' : selected.id === 'main' ? '本部大楼 · HKU' : '地图位置'}</Text>
      </View>
      <View style={s.detailBody}><Text raw={selected.isCommunity} accessibilityRole="header" style={s.title}>{placeName(selected)}</Text>{placeSubtitle ? <Text raw style={s.meta}>{placeSubtitle}</Text> : null}
        {building ? <>
          <View style={s.infoRow}><AppIcon name="building" size={20} /><View style={s.flex}><Text style={s.rowTitle}>所在楼宇</Text><Text raw style={s.body}>{selected.buildingName ? t(selected.buildingName) : placeName(building)}</Text></View></View>
        </> : <>
        <View style={s.detailBadges}><Text style={s.categoryMeta}>{categoryLabel(selected)} ·</Text><Text style={s.categoryMeta}>{selected.isCommunity ? '同学提供' : '校园地图资料'}</Text></View>
        {selected.authorProfile ? <AuthorByline author={selected.authorProfile} /> : null}
        </>}
        <PlaceIntroduction place={selected} active={active} />
        {selected.id === 'main' || selected.imageUrl ? <><View testID="place-map-divider" style={s.divider} /><Text style={s.sectionTitle}>地图位置</Text><View style={s.miniMap}><MapCanvas selected={selected} variant="mini" /></View></> : null}
      </View>
    </ScrollView>
    <View style={s.footer}>
      {saveButton}
      {isPublishedPlace(selected) ? <IconButton testID="detail-comments" icon="comment" label="地点评论" onPress={() => onCommentPlace(selected)} /> : null}
      <Action testID="detail-route" icon="walk" label="查看步行路线" onPress={() => startRoute(selected)} />
    </View>
  </View>;
  if (view === 'route') return <RouteScreen initialOrigin={origin} initialDestination={destination} initialRouteId={preferredRoute?.source === 'community' ? preferredRoute.id : undefined} preferDemo={preferredRoute?.source === 'demo'} records={routes} recentPlaceIds={records.recent} onBack={back} onMap={(place?: Place) => { if (place) setSelected(mapPlace(place)); setFromSaved(false); chooseCategory('all'); changeView('home'); }} active={active} onVisit={onVisitRoute} catalogVersion={campus.catalog} routeImages={routeImages} />;
  return <View style={s.flex}>
    <View style={s.mapHome}>
      <MapCanvas selected={selected} category={category} zoom={zoom} onZoomChange={setZoom}
        onSelect={place => { setFacilitySelection(null); setSelected(place); }} catalogVersion={campus.catalog} sampleLocation={showDemo}
        livePosition={location.point} centerTick={centerTick} facilitiesOnly={facilitiesOnly} facilities={campus.catalog.facilities} onFacilitySelect={setFacilitySelection} />
      <View pointerEvents="box-none" style={s.mapOverlay}>
        <View pointerEvents="box-none" style={s.homeTop}><View pointerEvents="none" style={s.brandRow}><Text accessibilityRole="header" style={s.brand}>港大漫游</Text><Text style={s.area}>本部 · 百周年</Text></View>
          <Pressable testID="open-search" accessibilityRole="button" onPress={() => { setFromSaved(false); changeView('search'); }} style={({ pressed }) => [s.searchLauncher, pressed && s.pressed]}><AppIcon name="search" size={18} color={c.muted} /><Text style={[s.searchLabel, s.flex]}>搜索地点或路线</Text></Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.homeCategories}>
            {categories.map(item => {
              const selectedCategory = !facilitiesOnly && category === item.id;
              return <Pressable testID={`filter-${item.id}`} key={item.id} accessibilityRole="button" accessibilityState={{ selected: selectedCategory }}
                onPress={() => chooseCategory(item.id)} style={s.chipTarget}>
                <View style={[s.homeChip, selectedCategory && s.selectedChip]}><AppIcon name={categoryIcon(item.id)} size={16} color={selectedCategory ? c.green : c.muted} />
                <Text style={[s.chipText, selectedCategory && s.selectedChipText]}>{item.label}</Text></View>
              </Pressable>;
            }).flatMap((chip, index) => index === 0 ? [chip,
              <Pressable testID="filter-facilities" key="facilities" accessibilityRole="button" accessibilityState={{ selected: facilitiesOnly }}
                onPress={() => { setFacilitySelection(null); setFacilitiesOnly(true); }} style={s.chipTarget}>
                <View style={[s.homeChip, facilitiesOnly && s.selectedChip]}><AppIcon name="lift" size={16} color={facilitiesOnly ? c.green : c.muted} /><Text style={[s.chipText, facilitiesOnly && s.selectedChipText]}>地图设施</Text></View>
              </Pressable>] : [chip])}
          </ScrollView>
        </View>
        <View pointerEvents="box-none" style={[s.mapTools, compactTools && s.compactTools]}><View style={s.compass} accessible accessibilityLabel={t('北方在地图下方')}><View style={s.compassArrow}><AppIcon name="arrow" color={c.green} size={16} /></View><Text style={s.compassLabel}>N</Text></View><View style={[s.toolBox, compactTools && s.compactTools]}><IconButton icon="plus" label="放大地图" disabled={zoom >= MAX_MAP_ZOOM} onPress={() => setZoom(Math.min(MAX_MAP_ZOOM, zoom * 1.4))} /><View style={compactTools ? s.verticalDivider : s.toolDivider} /><IconButton icon="minus" label="缩小地图" disabled={zoom <= MIN_MAP_ZOOM} onPress={() => setZoom(Math.max(MIN_MAP_ZOOM, zoom / 1.4))} /></View>
          <View style={s.toolBox}><IconButton testID="locate-me" icon="locate" label={showDemo ? '回到演示位置' : hasLocation ? '回到我的位置' : '开启定位'} disabled={locating || (location.tracking && !hasLocation)}
            onPress={() => { if (hasLocation || showDemo) centerLocation(); else void location.start(); }} /></View>
        </View>
        <View pointerEvents="none" style={s.mapSpace} />
        {facilitiesOnly || facilitySelection ? <FacilitySheet facilities={facilitySelection} onClose={() => setFacilitySelection(null)} /> :
          selected ? <View testID="map-place-sheet" style={s.placeSheet}><View style={s.sheetSummary}>{hasPlacePhoto(selected) ? <Image source={placePhoto(selected)} style={s.sheetPhoto} resizeMode="cover" accessibilityLabel="校园地点照片" /> : <View style={[s.sheetPhoto, s.placeSymbol]}><AppIcon name={placeIcon(selected)} /></View>}<View style={s.flex}><Text raw={selected.isCommunity} style={s.rowTitle}>{placeName(selected)}</Text>{language !== 'en' && selected.english ? <Text raw style={s.meta}>{selected.english}</Text> : null}<Text style={s.categoryMeta}>{categoryLabel(selected)}</Text></View>{saveButton}</View><View style={s.sheetActions}><Action secondary label="地点详情" onPress={() => detail(selected)} /><Action icon="walk" label="查看路线" onPress={() => startRoute(selected)} /></View></View> : null}
        <Text pointerEvents="none" style={s.homeMapNote}>© OpenStreetMap</Text>
      </View>
    </View>
    {campus.error ? <Pressable accessibilityRole="button" onPress={() => void campus.reload()} style={{ padding: 10, backgroundColor: c.rustLight }}><Text style={s.meta}>{campus.error}</Text><Text style={s.meta}>点击重新加载</Text></Pressable> : null}
    <Pressable testID="gps-info" accessibilityRole="button" accessibilityLabel={locationAction} accessibilityHint={locationMessage} disabled={locating}
      onPress={() => { if (location.tracking) location.stop(); else void location.start(); }} style={({ pressed }) => [s.gpsRow, pressed && s.pressed]}>
      <AppIcon name="locate" size={18} color={c.muted} />
      <View style={s.flex}><Text style={s.gpsTitle}>GPS 实时定位</Text><Text raw accessibilityLiveRegion="polite" style={s.meta}>{locationMessage}</Text></View>
      <Text style={s.gpsAction}>{locating ? '等待授权' : locationAction}</Text>
    </Pressable>
  </View>;
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  title: { fontSize: 24, lineHeight: 32, color: c.ink, fontWeight: '600' },
  sectionTitle: { fontSize: 15, lineHeight: 24, fontWeight: '600', color: c.ink, marginVertical: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  body: { fontSize: 14, color: c.muted, lineHeight: 20 },
  meta: { fontSize: 12, color: c.muted, lineHeight: 16 },
  rowTitle: { fontSize: 16, color: c.ink, fontWeight: '600', lineHeight: 24 },
  note: { fontSize: 12, color: c.muted, lineHeight: 20, marginTop: 16, marginBottom: 8 },
  pressed: { backgroundColor: c.paper },
  primaryPressed: { backgroundColor: c.greenDark },
  disabled: { opacity: 0.35 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  action: { flex: 1, minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: c.green, borderWidth: 1, borderColor: c.green, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionLabel: { fontSize: 14, lineHeight: 20, color: c.surface, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  secondary: { backgroundColor: c.surface, borderColor: c.line },
  secondaryLabel: { color: c.ink },

  mapHome: { flex: 1, minHeight: 330, overflow: 'hidden' },
  mapOverlay: { ...StyleSheet.absoluteFill, paddingHorizontal: 16 },
  homeTop: { paddingTop: 8 },
  brandRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: 12, marginBottom: 8 },
  brand: { fontSize: 24, lineHeight: 32, color: c.green, fontWeight: '600' },
  area: { fontSize: 12, lineHeight: 16, color: c.muted },
  searchLauncher: { backgroundColor: c.surface, minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, flexDirection: 'row', gap: 8, alignItems: 'center', borderWidth: 1, borderColor: c.line },
  searchLabel: { color: c.ink, fontSize: 14, lineHeight: 20 },
  homeCategories: { gap: 8, paddingTop: 4 },
  chipTarget: { minHeight: 48, justifyContent: 'center' },
  homeChip: { minHeight: 36, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, gap: 4, flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderWidth: 1, borderColor: c.line },
  chipText: { fontSize: 12, color: c.ink, lineHeight: 16 },
  selectedChip: { backgroundColor: c.tint, borderColor: c.green },
  selectedChipText: { color: c.green, fontWeight: '600' },
  mapTools: { alignSelf: 'flex-end', alignItems: 'center', gap: 8 },
  compactTools: { flexDirection: 'row' },
  compass: { alignItems: 'center', backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  compassArrow: { transform: [{ rotate: '90deg' }] },
  compassLabel: { color: c.green, fontSize: 11, lineHeight: 12, fontWeight: '600' },
  toolBox: { backgroundColor: c.surface, borderRadius: 8, borderWidth: 1, borderColor: c.line, overflow: 'hidden' },
  toolDivider: { height: 1, backgroundColor: c.line, marginHorizontal: 8 },
  verticalDivider: { width: 1, backgroundColor: c.line, alignSelf: 'stretch', marginVertical: 8 },
  mapSpace: { flex: 1 },
  placeSheet: { borderRadius: 16, backgroundColor: c.surface, padding: 12, borderWidth: 1, borderColor: c.line },
  sheetSummary: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 },
  sheetPhoto: { width: 56, height: 56, borderRadius: 4 },
  placeSymbol: { backgroundColor: c.paper, alignItems: 'center', justifyContent: 'center' },
  sheetActions: { flexDirection: 'row', gap: 8 },
  homeMapNote: { alignSelf: 'flex-start', marginVertical: 4, color: c.ink, backgroundColor: c.app, fontSize: 10, lineHeight: 16, paddingHorizontal: 4 },
  gpsRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: c.app },
  gpsTitle: { fontSize: 12, color: c.ink, fontWeight: '600', lineHeight: 16 },
  gpsAction: { maxWidth: '36%', fontSize: 12, color: c.green, fontWeight: '600', lineHeight: 16, textAlign: 'right' },

  facilitySheet: { gap: 8 },
  facilityHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  facilityLegend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendLabel: { fontSize: 12, lineHeight: 16, color: c.ink },
  facilityScroll: { maxHeight: 128, flexGrow: 0 },
  facilityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.line },

  detailPage: { paddingBottom: 12 },
  hero: { height: 228 },
  heroPhoto: { width: '100%', height: '100%' },
  heroActions: { position: 'absolute', top: 12, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  floating: { backgroundColor: c.app, borderRadius: 8, overflow: 'hidden' },
  credit: { position: 'absolute', bottom: 8, right: 12, backgroundColor: '#203a31d9', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, color: c.surface },
  detailBody: { padding: 20, maxWidth: 650, width: '100%', alignSelf: 'center' },
  detailBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 16 },
  categoryMeta: { fontSize: 12, lineHeight: 16, color: c.muted },
  divider: { height: 1, backgroundColor: c.line, marginTop: 20 },
  infoRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  miniMap: { height: 168, overflow: 'hidden', borderRadius: 8 },
  footer: { backgroundColor: c.app, borderTopWidth: 1, borderTopColor: c.line, padding: 16, gap: 8, flexDirection: 'row', alignItems: 'center' },
});
