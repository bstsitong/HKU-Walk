import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AppIcon, { IconName } from './AppIcon';
import CampusMap from './CampusMap';
import { GuideScreen, MoreScreen, SavedScreen } from './GuideScreens';
import { GuideKey } from './guideApi';
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
  const [tab, setTab] = useState<(typeof tabs)[number]['key']>('map');
  const [category, setCategory] = useState<GuideKey | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const saveQueue = useRef(Promise.resolve());
  const data = useGuide();
  const account = useAccount();
  const [communityVisible, setCommunityVisible] = useState(false);

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
      <View style={[s.content, tab !== 'map' && s.hidden]}><CampusMap active={tab === 'map'} /></View>
      {tab === 'guide' ? <GuideScreen data={data} bookmarks={bookmarks} selected={category} onSelect={setCategory} onContribute={() => setCommunityVisible(true)} /> : null}
      {tab === 'saved' ? <SavedScreen data={data} bookmarks={bookmarks} /> : null}
      {tab === 'more' ? <MoreScreen data={data} onContribute={() => setCommunityVisible(true)} /> : null}
      <CommunityScreen visible={communityVisible} onClose={() => { setCommunityVisible(false); void data.reload(); }} account={account} />
      <View style={s.nav} accessibilityRole="tablist">
        {tabs.map(item => (
          <Pressable key={item.key} testID={`tab-${item.key}`} accessibilityRole="tab" accessibilityLabel={item.label}
            accessibilityState={{ selected: tab === item.key }}
            onPress={() => { Keyboard.dismiss(); setTab(item.key); }} style={s.navItem}>
            <View style={[s.navSymbol, tab === item.key && s.navActive]}><AppIcon name={item.icon} color={tab === item.key ? '#184d3e' : '#526258'} /></View>
            <Text style={[s.navText, tab === item.key && s.navTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return <SafeAreaProvider><MainApp /></SafeAreaProvider>;
}

const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#f7f8f3' },
  content: { flex: 1 },
  hidden: { display: 'none' },
  nav: { flexDirection: 'row', backgroundColor: '#fff', borderTopColor: '#dbe3d9', borderTopWidth: 1, paddingHorizontal: 5, paddingTop: 4, paddingBottom: 3 },
  navItem: { flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 2 },
  navSymbol: { minWidth: 45, minHeight: 29, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  navActive: { backgroundColor: '#eaf1e8' },
  navText: { fontSize: 11, lineHeight: 18, color: '#526258' },
  navTextActive: { color: '#184d3e', fontWeight: '700' },
});
