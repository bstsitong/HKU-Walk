import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { Alert, Pressable, Text } from './ui';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AppIcon, { IconName } from './AppIcon';
import CampusMap, { MapRequest, MapView } from './CampusMap';
import usePlaces from './usePlaces';
import { Category, getCampusRoute, getPlace, Place } from './campus';
import { LanguageProvider, useLanguage } from './LanguageProvider';
import { colors } from './theme';
import { GuideScreen, MoreScreen } from './GuideScreens';
import SavedScreen from './SavedScreen';
import { GuideEntry, GuideKey } from './guideApi';
import useCampus from './useCampus';
import useSavedRoutes from './useSavedRoutes';
import { RouteBookmark } from './routeBookmarks';
import useGuide from './useGuide';
import useAccount from './useAccount';
import CommunityScreen from './CommunityScreen';

const tabs: { key: 'map' | 'guide' | 'saved' | 'more'; label: string; icon: IconName }[] = [
  { key: 'map', label: '地图', icon: 'map' },
  { key: 'guide', label: '学生指南', icon: 'book' },
  { key: 'saved', label: '收藏', icon: 'saved' },
  { key: 'more', label: '更多', icon: 'more' },
];
const bookmarkKey = 'hku-walk.guide-bookmarks.v1';

function MainApp() {
  useLanguage();
  const [tab, setTab] = useState<(typeof tabs)[number]['key']>('map');
  const [category, setCategory] = useState<GuideKey | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const saveQueue = useRef(Promise.resolve());
  const data = useGuide();
  const campus = useCampus();
  const routes = useSavedRoutes();
  const account = useAccount();
  const [communityVisible, setCommunityVisible] = useState(false);
  const records = usePlaces();
  const [mapView, setMapView] = useState<MapView>('home');
  const [mapRequest, setMapRequest] = useState<MapRequest | null>(null);
  const [sampleLocation, setSampleLocation] = useState(false);
  const sampleChanges = useRef(0);
  const sampleQueue = useRef(Promise.resolve());
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem('hku-walk.sample-location.v1').then(value => { if (live && !sampleChanges.current) setSampleLocation(value === 'true'); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const chooseSampleLocation = (value: boolean) => {
    sampleChanges.current++; setSampleLocation(value);
    sampleQueue.current = sampleQueue.current.then(() => AsyncStorage.setItem('hku-walk.sample-location.v1', String(value))).catch(() => Alert.alert('设置暂时无法保存', '本次设置仍然有效。'));
  };
  const openMap = (category: Category) => { setTab('map'); setMapRequest({ serial: Date.now(), view: 'home', category }); };
  const openPlace = (place: Place) => { setTab('map'); setMapRequest({ serial: Date.now(), view: 'detail', placeId: place.id, fromSaved: true }); };
  const openRoute = (route: RouteBookmark, fromSaved = true) => { setTab('map'); setMapRequest({ serial: Date.now(), view: 'route', route, fromSaved }); };
  const openContent = (entry: GuideEntry) => {
    if (entry.mapType === 'place') {
      const place = getPlace('community-place-' + entry.id);
      if (place) { setTab('map'); setMapRequest({ serial: Date.now(), view: 'detail', placeId: place.id, fromSaved: tab === 'saved' }); return; }
    } else if (entry.mapType === 'route') {
      const route = getCampusRoute('community-route-' + entry.id);
      if (route) { openRoute({ id: route.id, originId: route.originId, destinationId: route.destinationId, source: 'community' }, tab === 'saved'); return; }
    }
    Alert.alert('内容暂不可用', '地点或路线已下线，请刷新后重试。');
  };
  const refreshAll = async () => { await Promise.all([data.reload(), campus.reload()]); };
  const guideData = { ...data, reload: refreshAll };

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(bookmarkKey).then(raw => {
      const value: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) throw new Error('Invalid bookmarks');
      if (active) { setSaved(value); setReady(true); }
    }).catch(() => Alert.alert('收藏暂时无法读取', '重新打开 App 后再试。'));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveQueue.current = saveQueue.current.then(() => AsyncStorage.setItem(bookmarkKey, JSON.stringify(saved)))
      .catch(() => { Alert.alert('收藏保存失败', '请检查设备存储空间后重试。'); });
  }, [saved, ready]);

  const bookmarks = {
    saved, ready,
    toggle: (id: string) => setSaved(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]),
  };
  return (
    <SafeAreaView style={s.shell}>
      <StatusBar style="dark" />
      <View style={[s.content, tab !== 'map' && s.hidden]}><CampusMap active={tab === 'map'} records={records} routes={routes} campus={campus} sampleLocation={sampleLocation} request={mapRequest} onViewChange={setMapView} onReturnSaved={() => setTab('saved')} /></View>
      {tab === 'guide' ? <GuideScreen data={guideData} bookmarks={bookmarks} selected={category} onSelect={setCategory} onContribute={() => setCommunityVisible(true)} onMap={openMap} onOpenContent={openContent} /> : null}
      {tab === 'saved' ? <SavedScreen data={data} campus={campus} bookmarks={bookmarks} records={records} routes={routes} onOpenPlace={openPlace} onOpenRoute={openRoute} onOpenContent={openContent} /> : null}
      {tab === 'more' ? <MoreScreen data={guideData} onContribute={() => setCommunityVisible(true)} sampleLocation={sampleLocation} onSampleLocation={chooseSampleLocation} /> : null}
      <CommunityScreen visible={communityVisible} onClose={() => { setCommunityVisible(false); void refreshAll(); }} account={account} />
      {tab !== 'map' || mapView === 'home' ? <View style={s.nav} accessibilityRole="tablist">
        {tabs.map(item => (
          <Pressable key={item.key} testID={`tab-${item.key}`} accessibilityRole="tab" accessibilityLabel={item.label}
            accessibilityState={{ selected: tab === item.key }}
            onPress={() => { Keyboard.dismiss(); setTab(item.key); }} style={s.navItem}>
            <View style={[s.navSymbol, tab === item.key && s.navActive]}><AppIcon name={item.icon} color={tab === item.key ? '#184d3e' : '#526258'} /></View>
            <Text style={[s.navText, tab === item.key && s.navTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View> : null}
    </SafeAreaView>
  );
}

export default function App() {
  return <SafeAreaProvider><LanguageProvider><MainApp /></LanguageProvider></SafeAreaProvider>;
}

const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.app },
  content: { flex: 1 },
  hidden: { display: 'none' },
  nav: { flexDirection: 'row', backgroundColor: colors.app, borderTopColor: colors.line, borderTopWidth: 1, paddingHorizontal: 5, paddingTop: 4, paddingBottom: 3 },
  navItem: { flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 2 },
  navSymbol: { minWidth: 45, minHeight: 29, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  navActive: { backgroundColor: '#eaf1e8' },
  navText: { fontSize: 11, lineHeight: 18, color: '#526258' },
  navTextActive: { color: '#184d3e', fontWeight: '700' },
});
