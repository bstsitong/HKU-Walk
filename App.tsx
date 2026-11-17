import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Keyboard, StyleSheet, View } from 'react-native';
import { Alert, Pressable, Text } from './ui';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AppIcon, { IconName } from './AppIcon';
import { AssistantHost, AssistantProvider } from './Assistant';
import type { AssistantTarget } from './Assistant';
import { confirmPostRemoval } from './CommunityUI';
import { OpenAuthorProfile } from './AuthorIdentity';
import CampusMap, { MapRequest, MapView } from './CampusMap';
import usePlaces from './usePlaces';
import { getCampusRoute, getPlace, Place, placeName } from './campus';
import { DiscussionScreen } from './Discussion';
import EditProfile from './EditProfile';
import { LanguageProvider, useLanguage } from './LanguageProvider';
import { colors } from './theme';
import { GuideArticles, GuideArticleScreen } from './GuideArticles';
import ProfileScreen from './ProfileScreen';
import InboxScreen from './InboxScreen';
import PublicProfileScreen from './PublicProfileScreen';
import { GuideArticle, GuideEntry } from './guideApi';
import useCampus from './useCampus';
import useSavedRoutes from './useSavedRoutes';
import { RouteBookmark } from './routeBookmarks';
import RouteScreen from './RouteScreen';
import useGuide from './useGuide';
import useAccount from './useAccount';
import CommunityScreen from './CommunityScreen';
import { ApiError, deleteGuideArticle, DiscussionTarget, fetchInboxCount, fetchSubmission, InboxMessage, setGuideLike, Submission } from './communityApi';
import useRecentActivity from './useRecentActivity';
import usePersonalStorage from './usePersonalStorage';
import StartupUpdate from './StartupUpdate';

const tabs: { key: 'map' | 'guide' | 'profile'; label: string; icon: IconName }[] = [
  { key: 'map', label: '地图', icon: 'map' },
  { key: 'guide', label: '学生指南', icon: 'book' },
  { key: 'profile', label: '我的', icon: 'user' },
];
function MainApp() {
  useLanguage();
  const [tab, setTab] = useState<(typeof tabs)[number]['key']>('map');
  const campus = useCampus();
  const account = useAccount();
  const token = account.session?.token;
  const data = useGuide(token);
  // Older servers already expose route overview images in the student guide.
  const routeImages = useMemo(() => new Map(data.categories.flatMap(category => category.entries)
    .filter(entry => entry.mapType === 'route' && entry.imageUrl)
    .map(entry => [entry.id, entry.imageUrl])), [data.categories]);
  const [reading, setReading] = useState<{ id: string; comments: boolean } | null>(null);
  const [commentPlace, setCommentPlace] = useState<Place | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [publicProfileId, setPublicProfileId] = useState<string | null>(null);
  const article = data.articles.find(item => item.id === reading?.id);
  const editingUser = editingProfile ? account.session?.user : undefined;
  const [liking, setLiking] = useState<string[]>([]);
  const [deletingArticle, setDeletingArticle] = useState(false);
  const removingArticle = useRef(false);
  const likeRequests = useRef(new Set<string>());
  const owner = account.session?.user.id;
  const [inboxOwner, setInboxOwner] = useState<string>();
  const [inboxTarget, setInboxTarget] = useState<DiscussionTarget | null>(null);
  const [badge, setBadge] = useState<{ token: string; unread: number }>();
  const inboxNavigation = useRef(0);
  const inboxActive = Boolean(owner && inboxOwner === owner && token);
  const [communityEntry, setCommunityEntry] = useState<'home' | 'security' | 'login' | 'form' | Submission | null>(null);
  const personalRecords = usePersonalStorage(owner, token, tab === 'profile');
  const savedRoutes = useSavedRoutes(personalRecords);
  const history = useRecentActivity(personalRecords);
  const placeRecords = usePlaces(personalRecords);
  const openLogin = () => setCommunityEntry('login');
  const openDiscussionLogin = (expired = false) => {
    if (expired) void account.expire().then(openLogin);
    else openLogin();
  };
  const closeInbox = () => {
    inboxNavigation.current++;
    setInboxTarget(null);
    setInboxOwner(undefined);
  };
  const openInbox = () => {
    if (owner) { setInboxTarget(null); setInboxOwner(owner); }
    else if (account.ready) openLogin();
  };
  const onInboxExpired = () => { closeInbox(); openDiscussionLogin(true); };
  const openInboxMessage = async (message: InboxMessage) => {
    const version = ++inboxNavigation.current;
    if (message.kind !== 'review') {
      if (message.target) setInboxTarget(message.target);
      return;
    }
    if (!token) return;
    try {
      const result = await fetchSubmission(token, message.submissionId);
      if (version === inboxNavigation.current) setCommunityEntry(result.submission);
    } catch (error) {
      if (version !== inboxNavigation.current) return;
      if (error instanceof ApiError && error.status === 401) onInboxExpired();
      else Alert.alert('内容暂不可用', error instanceof ApiError && error.status === 404 ? undefined : '请稍后重试。');
    }
  };
  useEffect(() => {
    if (!token || tab !== 'profile' || inboxActive) return;
    let live = true;
    let running = false;
    const check = async () => {
      if (running || AppState.currentState === 'background') return;
      running = true;
      try {
        const { unread } = await fetchInboxCount(token);
        if (live) setBadge({ token, unread });
      } catch { /* An unavailable badge should not interrupt the profile. */ }
      finally { running = false; }
    };
    void check();
    const timer = setInterval(check, 30000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void check(); });
    return () => { live = false; clearInterval(timer); listener.remove(); };
  }, [token, tab, inboxActive]);
  const requireAccount = <T,>(action: (value: T) => void) => (value: T) => {
    if (account.session) action(value);
    else if (account.ready) openLogin();
  };
  const records = { ...placeRecords, ready: account.session ? placeRecords.ready : account.ready, toggle: requireAccount(placeRecords.toggle) };
  const routes = { ...savedRoutes, ready: account.session ? savedRoutes.ready : account.ready, toggle: requireAccount(savedRoutes.toggle) };
  const bookmarks = {
    saved: personalRecords.data.saved_posts,
    ready: account.session ? personalRecords.ready : account.ready,
    toggle: requireAccount((id: string) => personalRecords.toggle('saved_posts', id)),
  };
  const openArticle = (id: string, comments = false) => {
    history.visitPost(id);
    setReading({ id, comments });
  };
  const removeArticle = async (id: string) => {
    if (!token || removingArticle.current) return;
    removingArticle.current = true;
    setDeletingArticle(true);
    try {
      await deleteGuideArticle(token, id);
      data.removeArticle(id);
      setReading(current => current?.id === id ? null : current);
      void data.reload();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) openDiscussionLogin(true);
      else Alert.alert('帖子删除失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally { removingArticle.current = false; setDeletingArticle(false); }
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
  const openProfilePost = (id: string) => {
    setPublicProfileId(null);
    setCommentPlace(null);
    closeInbox();
    setTab('guide');
    openArticle(id);
    if (!data.articles.some(item => item.id === id)) void data.reload();
  };
  const renderAssistantTarget = (target: AssistantTarget, onBack: () => void, active: boolean) => {
    if (target.kind === 'route') {
      const destination = getPlace(target.id);
      return destination ? <RouteScreen key={destination.id} initialDestination={destination} publishedOnly
        records={routes} recentPlaceIds={records.recent} onBack={onBack} active={active}
        onVisit={history.visitRoute} catalogVersion={campus.catalog} routeImages={routeImages} /> : null;
    }
    const source = data.articles.find(item => item.id === target.id);
    return source ? <GuideArticleScreen key={`${source.id}:${target.pageKey ?? ''}`} article={source} initiallyComments={false} initialSourcePage={target.pageKey}
      session={account.session} onBack={onBack} active={active} readOnly bookmarks={bookmarks} liking={liking}
      onLike={toggleLike} onCommentCount={count => data.updateArticle(source.id, { commentCount: count })}
      onLogin={openDiscussionLogin} onDelete={() => confirmPostRemoval(() => void removeArticle(source.id))}
      deleting={deletingArticle} /> : null;
  };

  return (
    <OpenAuthorProfile.Provider value={setPublicProfileId}>
    <AssistantProvider renderTarget={renderAssistantTarget}>
    <SafeAreaView style={s.shell}>
      <AssistantHost restingBottom={tab === 'map' && mapView === 'home' && !article && !commentPlace ? 274 : undefined}>
      <StatusBar style="dark" />
      <View style={[s.content, (tab !== 'map' || Boolean(commentPlace)) && s.hidden]}><CampusMap active={tab === 'map' && !commentPlace} records={records} routes={routes} campus={campus} sampleLocation={false} request={mapRequest} onViewChange={setMapView} onReturnSaved={() => setTab('profile')} onVisitRoute={history.visitRoute} onCommentPlace={setCommentPlace} routeImages={routeImages} /></View>
      <View style={[s.content, (tab !== 'guide' || Boolean(article)) && s.hidden]}>
        <GuideArticles data={guideData} bookmarks={bookmarks} liking={liking} onLike={toggleLike} onOpen={openArticle} onContribute={() => setCommunityEntry('form')} />
      </View>
      <View style={[s.content, (tab !== 'profile' || Boolean(article) || Boolean(editingUser) || inboxActive) && s.hidden]}>
        <ProfileScreen active={tab === 'profile' && !inboxActive} data={data} campus={campus} bookmarks={bookmarks} records={records} routes={routes} history={history}
          session={account.session} accountReady={account.ready} onAccount={() => account.session ? setCommunityEntry('security') : openLogin()}
          submissionsPaused={communityEntry !== null || Boolean(editingUser)} onOpenSubmission={setCommunityEntry} onEditProfile={() => setEditingProfile(true)}
          onContribute={() => setCommunityEntry('form')} onLogin={openDiscussionLogin} onPrivacySaved={() => void refreshAll()}
          onOpenPlace={openPlace} onOpenRoute={openRoute} onOpenContent={openContent} onOpenArticle={openArticle}
          onInbox={openInbox} unread={badge && badge.token === token ? badge.unread : 0} onSaveCover={account.saveCover} />
      </View>
      {article && reading ? <GuideArticleScreen key={article.id} article={article} initiallyComments={reading.comments} session={account.session}
        onBack={() => setReading(null)} onLogin={openDiscussionLogin} bookmarks={bookmarks} liking={liking} onLike={toggleLike}
        onCommentCount={count => data.updateArticle(article.id, { commentCount: count })}
        onDelete={() => confirmPostRemoval(() => void removeArticle(article.id))} deleting={deletingArticle} /> : null}
      {commentPlace ? <DiscussionScreen key={commentPlace.id} kind="place" id={commentPlace.id} title={placeName(commentPlace)} session={account.session}
        onBack={() => setCommentPlace(null)} onLogin={openDiscussionLogin} /> : null}
      {inboxActive && token && (inboxTarget ?
        <DiscussionScreen key={`${inboxTarget.kind}-${inboxTarget.commentId}`} kind={inboxTarget.kind}
          id={inboxTarget.id} title={inboxTarget.title} focusCommentId={inboxTarget.commentId} session={account.session}
          onBack={() => setInboxTarget(null)} onLogin={expired => { if (expired) onInboxExpired(); else openLogin(); }} /> :
        <InboxScreen key={owner} token={token} onBack={closeInbox} onOpen={message => void openInboxMessage(message)}
          onProfile={id => { inboxNavigation.current++; setPublicProfileId(id); }} onExpired={onInboxExpired}
          onUnread={unread => setBadge({ token, unread })} />)}
      {editingUser ? <EditProfile key={editingUser.id} user={editingUser} onBack={() => setEditingProfile(false)}
        onSave={async draft => { await account.saveProfile(draft); void refreshAll(); }}
        onExpired={() => { setEditingProfile(false); openDiscussionLogin(true); }} /> : null}
      <CommunityScreen visible={communityEntry !== null} initialScreen={typeof communityEntry === 'string' ? communityEntry : 'home'}
        initialSubmission={typeof communityEntry === 'object' ? communityEntry ?? undefined : undefined} onClose={() => {
        if (communityEntry !== 'security' && communityEntry !== 'login') void refreshAll();
        setCommunityEntry(null);
      }} account={account} />
      {!article && !commentPlace && !editingUser && !inboxActive && (tab !== 'map' || mapView === 'home') ? <View style={s.nav} accessibilityRole="tablist">
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
      {publicProfileId ? <PublicProfileScreen key={publicProfileId} id={publicProfileId} onBack={() => setPublicProfileId(null)} onOpenPost={openProfilePost} /> : null}
      </AssistantHost>
    </SafeAreaView>
    </AssistantProvider>
    </OpenAuthorProfile.Provider>
  );
}

export default function App() {
  return <SafeAreaProvider><LanguageProvider><StartupUpdate><MainApp /></StartupUpdate></LanguageProvider></SafeAreaProvider>;
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
