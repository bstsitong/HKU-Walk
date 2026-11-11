import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { Alert, Pressable, Text } from './ui';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AppIcon, { IconName } from './AppIcon';
import CampusMap, { MapRequest, MapView } from './CampusMap';
import usePlaces from './usePlaces';
import { getCampusRoute, getPlace, Place, placeName } from './campus';
import { PlaceDiscussion } from './Discussion';
import EditProfile from './EditProfile';
import { LanguageProvider, useLanguage } from './LanguageProvider';
import { colors } from './theme';
import { GuideArticles, GuideArticleScreen } from './GuideArticles';
import ProfileScreen from './ProfileScreen';
import { GuideArticle, GuideEntry } from './guideApi';
import useCampus from './useCampus';
import useSavedRoutes from './useSavedRoutes';
import { RouteBookmark } from './routeBookmarks';
import useGuide from './useGuide';
import useAccount from './useAccount';
import CommunityScreen from './CommunityScreen';
import { ApiError, setGuideLike, Submission } from './communityApi';
import useRecentActivity from './useRecentActivity';
import usePersonalStorage from './usePersonalStorage';

const tabs: { key: 'map' | 'guide' | 'profile'; label: string; icon: IconName }[] = [
  { key: 'map', label: '地图', icon: 'map' },
  { key: 'guide', label: '学生指南', icon: 'book' },
  { key: 'profile', label: '我的', icon: 'user' },
];
const bookmarkKey = 'hku-walk.guide-bookmarks.v1';
const emptyBookmarks: string[] = [];
function decodeBookmarks(value: unknown) {
  if (value === null) return emptyBookmarks;
  if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) throw new Error('Invalid bookmarks');
  return value as string[];
}

function MainApp() {
  useLanguage();
  const [tab, setTab] = useState<(typeof tabs)[number]['key']>('map');
  const campus = useCampus();
  const account = useAccount();
  const token = account.session?.token;
  const data = useGuide(token);
  const [reading, setReading] = useState<{ id: string; comments: boolean } | null>(null);
  const [commentPlace, setCommentPlace] = useState<Place | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const article = data.articles.find(item => item.id === reading?.id);
  const editingUser = editingProfile ? account.session?.user : undefined;
  const [liking, setLiking] = useState<string[]>([]);
  const likeRequests = useRef(new Set<string>());
  const owner = account.session?.user.id;
  const [communityEntry, setCommunityEntry] = useState<'home' | 'security' | 'login' | 'form' | Submission | null>(null);
  const savedRoutes = useSavedRoutes(owner);
  const history = useRecentActivity(owner);
  const placeRecords = usePlaces(owner);
  const guideBookmarks = usePersonalStorage(owner, bookmarkKey, emptyBookmarks, decodeBookmarks);
  const openLogin = () => setCommunityEntry('login');
  const openDiscussionLogin = (expired = false) => {
    if (expired) void account.expire().then(openLogin);
    else openLogin();
  };
  const requireAccount = <T,>(action: (value: T) => void) => (value: T) => {
    if (account.session) action(value);
    else if (account.ready) openLogin();
  };
  const records = { ...placeRecords, ready: account.session ? placeRecords.ready : account.ready, toggle: requireAccount(placeRecords.toggle) };
  const routes = { ...savedRoutes, ready: account.session ? savedRoutes.ready : account.ready, toggle: requireAccount(savedRoutes.toggle) };
  const bookmarks = {
    saved: guideBookmarks.data,
    ready: account.session ? guideBookmarks.ready : account.ready,
    toggle: requireAccount((id: string) => guideBookmarks.update(current =>
      current.includes(id) ? current.filter(item => item !== id) : [...current, id])),
  };
  const openArticle = (id: string, comments = false) => {
    history.visitPost(id);
    setReading({ id, comments });
  };
  const toggleLike = async (item: GuideArticle) => {
    if (!token) {
      Alert.alert('登录后才能点赞', undefined, [{ text: '取消', style: 'cancel' }, { text: '去登录', onPress: openLogin }]);
      return;
    }
    if (likeRequests.current.has(item.id)) return;
    likeRequests.current.add(item.id);
    setLiking(current => [...current, item.id]);
    try { data.updateArticle(item.id, await setGuideLike(token, item.id, !item.liked)); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) openDiscussionLogin(true);
      else Alert.alert('点赞失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      likeRequests.current.delete(item.id);
      setLiking(current => current.filter(id => id !== item.id));
    }
  };
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
  const openPlace = (place: Place) => { setTab('map'); setMapRequest({ serial: Date.now(), view: 'detail', placeId: place.id, fromSaved: true }); };
  const openRoute = (route: RouteBookmark, fromSaved = true) => { setTab('map'); setMapRequest({ serial: Date.now(), view: 'route', route, fromSaved }); };
  const openContent = (entry: GuideEntry) => {
    if (entry.mapType === 'place') {
      const place = getPlace('community-place-' + entry.id);
      if (place) { setTab('map'); setMapRequest({ serial: Date.now(), view: 'detail', placeId: place.id, fromSaved: tab === 'profile' }); return; }
    } else if (entry.mapType === 'route') {
      const route = getCampusRoute('community-route-' + entry.id);
      if (route) { openRoute({ id: route.id, originId: route.originId, destinationId: route.destinationId, source: 'community' }, tab === 'profile'); return; }
    }
    Alert.alert('内容暂不可用', '地点或路线已下线，请刷新后重试。');
  };
  const refreshAll = async () => { await Promise.all([data.reload(), campus.reload()]); };
  const guideData = { ...data, reload: refreshAll };

  return (
    <SafeAreaView style={s.shell}>
      <StatusBar style="dark" />
      <View style={[s.content, (tab !== 'map' || Boolean(commentPlace)) && s.hidden]}><CampusMap active={tab === 'map' && !commentPlace} records={records} routes={routes} campus={campus} sampleLocation={sampleLocation} request={mapRequest} onViewChange={setMapView} onReturnSaved={() => setTab('profile')} onVisitRoute={history.visitRoute} onCommentPlace={setCommentPlace} /></View>
      <View style={[s.content, (tab !== 'guide' || Boolean(article)) && s.hidden]}>
        <GuideArticles data={guideData} bookmarks={bookmarks} liking={liking} onLike={toggleLike} onOpen={openArticle} onContribute={() => setCommunityEntry('form')} />
      </View>
      <View style={[s.content, (tab !== 'profile' || Boolean(article) || Boolean(editingUser)) && s.hidden]}>
        <ProfileScreen active={tab === 'profile'} data={data} campus={campus} bookmarks={bookmarks} records={records} routes={routes} history={history}
          session={account.session} accountReady={account.ready} onAccount={() => account.session ? setCommunityEntry('security') : openLogin()}
          submissionsPaused={communityEntry !== null || Boolean(editingUser)} onOpenSubmission={setCommunityEntry} onEditProfile={() => setEditingProfile(true)}
          onContribute={() => setCommunityEntry('form')} sampleLocation={sampleLocation} onSampleLocation={chooseSampleLocation}
          onOpenPlace={openPlace} onOpenRoute={openRoute} onOpenContent={openContent} onOpenArticle={openArticle} />
      </View>
      {article && reading ? <GuideArticleScreen key={article.id} article={article} initiallyComments={reading.comments} session={account.session}
        onBack={() => setReading(null)} onLogin={openDiscussionLogin} bookmarks={bookmarks} liking={liking} onLike={toggleLike}
        onCommentCount={count => data.updateArticle(article.id, { commentCount: count })} /> : null}
      {commentPlace ? <PlaceDiscussion key={commentPlace.id} id={commentPlace.id} title={placeName(commentPlace)} session={account.session}
        onBack={() => setCommentPlace(null)} onLogin={openDiscussionLogin} /> : null}
      {editingUser ? <EditProfile key={editingUser.id} user={editingUser} onBack={() => setEditingProfile(false)}
        onSave={async draft => { await account.saveProfile(draft); void refreshAll(); }}
        onExpired={() => { setEditingProfile(false); openDiscussionLogin(true); }} /> : null}
      <CommunityScreen visible={communityEntry !== null} initialScreen={typeof communityEntry === 'string' ? communityEntry : 'home'}
        initialSubmission={typeof communityEntry === 'object' ? communityEntry ?? undefined : undefined} onClose={() => {
        if (communityEntry !== 'security' && communityEntry !== 'login') void refreshAll();
        setCommunityEntry(null);
      }} account={account} />
      {!article && !commentPlace && !editingUser && (tab !== 'map' || mapView === 'home') ? <View style={s.nav} accessibilityRole="tablist">
        {tabs.map(item => (
          <Pressable key={item.key} testID={`tab-${item.key}`} accessibilityRole="tab" accessibilityLabel={item.label}
            accessibilityState={{ selected: tab === item.key }}
            onPress={() => { Keyboard.dismiss(); setTab(item.key); }} style={s.navItem}>
            {tab === item.key ? <View style={s.navIndicator} /> : null}
            <AppIcon name={item.icon} size={20} color={tab === item.key ? colors.green : colors.muted} />
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
  nav: { flexDirection: 'row', backgroundColor: colors.app, borderTopColor: colors.line, borderTopWidth: 1, paddingHorizontal: 8 },
  navItem: { flex: 1, minHeight: 56, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', gap: 4 },
  navIndicator: { position: 'absolute', top: 0, alignSelf: 'center', width: 24, height: 2, backgroundColor: colors.green },
  navText: { fontSize: 12, lineHeight: 16, color: colors.muted, textAlign: 'center' },
  navTextActive: { color: colors.green, fontWeight: '600' },
});
