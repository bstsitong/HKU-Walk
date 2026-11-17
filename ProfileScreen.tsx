import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { usePhotoPicker } from './PhotoCrop';
import { Alert, Pressable, Text } from './ui';
import AppIcon, { IconName } from './AppIcon';
import { accountAuthor, AuthorByline, Avatar } from './AuthorIdentity';
import { getCampusRoute, getPlace, Place, placeName } from './campus';
import { PlaceRow } from './PlaceSearch';
import { PlaceRecords } from './usePlaces';
import { RouteRecords } from './useSavedRoutes';
import { RouteBookmark } from './routeBookmarks';
import { EntryCard, openLink } from './GuideScreens';
import { GuideEntry } from './guideApi';
import { useLanguage } from './LanguageProvider';
import { languages, t } from './localization';
import useGuide from './useGuide';
import useCampus from './useCampus';
import { colors as c } from './theme';
import { Account, ApiError, fetchPrivacy, fetchSubmissions, PickedImage, Privacy, Submission, updatePrivacy } from './communityApi';
import SubmissionPhoto from './SubmissionPhoto';
import useRecentActivity from './useRecentActivity';
import { guideArticleTitle } from './guideLocalization';
type Bookmarks = { saved: string[]; ready: boolean; toggle: (id: string) => void };
const panels = { submissions: '投稿', saved: '收藏', recent: '历史记录' } as const;
const sections = { places: '地点', routes: '路线', posts: '帖子' } as const;
type Section = keyof typeof sections;
const guestBenefits: { icon: IconName; title: string; description: string }[] = [
  { icon: 'edit', title: '投稿', description: '提交新地点、路线或指南帖子' },
  { icon: 'bookmark', title: '收藏', description: '保存常用地点、路线和帖子' },
  { icon: 'history', title: '历史记录', description: '找回看过的地点、路线和帖子' },
];

export default function ProfileScreen({ active, session, accountReady, onAccount, onContribute, onLogin, onPrivacySaved, data, campus, bookmarks, records, routes, history, submissionsPaused, onOpenSubmission, onOpenPlace, onOpenRoute, onOpenContent, onOpenArticle, onEditProfile, onSaveCover, onInbox, unread }: {
  active: boolean; session: Account | null; accountReady: boolean; onAccount: () => void; onContribute: () => void;
  history: ReturnType<typeof useRecentActivity>; submissionsPaused: boolean; onOpenSubmission: (submission: Submission) => void;
  onLogin: (expired?: boolean) => void; onPrivacySaved: () => void;
  data: ReturnType<typeof useGuide>; campus: ReturnType<typeof useCampus>; bookmarks: Bookmarks; records: PlaceRecords; routes: RouteRecords;
  onOpenPlace: (place: Place) => void; onOpenRoute: (route: RouteBookmark) => void; onOpenContent: (entry: GuideEntry) => void;
  onOpenArticle: (id: string) => void; onEditProfile: () => void;
  onSaveCover: (image: PickedImage | null) => Promise<void>;
  onInbox: () => void; unread: number;
}) {
  const { pickPhoto, cropEditor } = usePhotoPicker();
  const { language } = useLanguage();
  const [section, setSection] = useState<Section>('places');
  const [panel, setPanel] = useState<keyof typeof panels>('saved');
  const [settings, setSettings] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverWorking = useRef(false);
  const coverAspect = useRef(2);
  const cover = session?.user.coverUrl;
  const recent = panel === 'recent';
  const closeSettings = useCallback(() => setSettings(false), []);
  useEffect(() => {
    if (!active || !settings) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { closeSettings(); return true; });
    return () => subscription.remove();
  }, [active, settings, closeSettings]);
  useEffect(() => { setPanel('saved'); setSection('places'); setConfirm(false); }, [session?.user.id]);
  const postIds = recent ? history.posts : bookmarks.saved;
  const guideEntries = new Map(data.categories.flatMap(category => category.entries.map(entry => [entry.id, { entry, category: category.key }] as const)));
  const routeItems = recent ? history.routes : routes.saved;
  const ids = recent ? records.recent : records.saved;
  const hasHistory = section === 'places' ? ids.length : section === 'routes' ? routeItems.length : postIds.length;
  const clearHistory = section === 'places' ? records.clearRecent : section === 'routes' ? history.clearRoutes : history.clearPosts;
  const savePlaceButton = (id: string) => <Pressable accessibilityRole="button" accessibilityLabel={records.saved.includes(id) ? '取消收藏' : '收藏地点'} disabled={!records.ready} onPress={() => records.toggle(id)} style={s.iconButton}><AppIcon name="bookmark" size={20} color={records.saved.includes(id) ? c.green : c.muted} /></Pressable>;
  const updateCover = async (remove = false) => {
    if (coverWorking.current) return;
    coverWorking.current = true;
    setCoverBusy(true);
    try {
      let image: PickedImage | null = null;
      if (!remove) {
        image = await pickPhoto({ aspect: coverAspect.current });
        if (!image) return;
      }
      await onSaveCover(image);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onLogin(true);
      else Alert.alert('资料卡背景未能更新', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      coverWorking.current = false;
      setCoverBusy(false);
    }
  };
  const chooseCover = () => {
    if (!cover) { void updateCover(); return; }
    Alert.alert('资料卡背景', undefined, [
      { text: '取消', style: 'cancel' },
      { text: '恢复默认背景', onPress: () => void updateCover(true) },
      { text: '更换图片', onPress: () => void updateCover() },
    ]);
  };
  if (settings) return <Preferences onBack={closeSettings} token={session?.token} accountReady={accountReady} onLogin={onLogin} onPrivacySaved={onPrivacySaved} />;
  return <View style={s.flex}>
    {cropEditor}
    <ScrollView style={s.flex} contentContainerStyle={s.page} refreshControl={session && panel === 'saved' ? <RefreshControl refreshing={data.loading || campus.loading} onRefresh={() => { void data.reload(); void campus.reload(); }} tintColor={c.green} /> : undefined}>
      <View style={s.header}>
        <Pressable testID="profile-settings" accessibilityRole="button" accessibilityLabel="设置" style={s.headerAction} onPress={() => setSettings(true)}>
          <AppIcon name="settings" size={22} />
        </Pressable>
        <Pressable testID="profile-inbox" accessibilityRole="button"
          accessibilityLabel={unread ? t('{count} 条未读消息', { count: unread }) : '消息'} style={s.headerAction} onPress={onInbox}>
          <AppIcon name="mail" size={22} />
          {unread ? <View style={s.inboxDot} /> : null}
        </Pressable>
      </View>
      {!accountReady ? <ActivityIndicator color={c.green} style={s.empty} accessibilityLabel="正在读取登录信息…" /> : !session ? <>
        <View style={s.guestPanel} testID="profile-guest">
          <Text accessibilityRole="header" style={s.title}>登录后使用个人功能</Text>
          <Text style={s.body}>投稿、收藏和查看历史记录都需要登录。</Text>
          <Pressable testID="profile-account" accessibilityRole="button" onPress={onAccount}
            style={({ pressed }) => [s.profileButton, s.loginButton, pressed && s.dim]}>
            <Text style={s.loginLabel}>登录或注册</Text><AppIcon name="arrow" size={17} color={c.surface} />
          </Pressable>
        </View>
        <View style={s.guestHeading}><AppIcon name="lock" size={16} /><Text style={s.rowTitle}>登录后可用</Text></View>
        {guestBenefits.map(({ icon, title, description }) => <View key={icon} style={s.settingRow}>
          <View style={s.symbol}><AppIcon name={icon} size={20} /></View>
          <View style={s.flex}><Text style={s.rowTitle}>{title}</Text><Text style={s.body}>{description}</Text></View>
        </View>)}
      </> : <>
      <View style={s.profile} testID="profile-member" onLayout={({ nativeEvent: { layout } }) => {
        if (layout.width > 0 && layout.height > 0) coverAspect.current = layout.width / layout.height;
      }}>
        {cover ? <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
          <SubmissionPhoto uri={cover} token={session.token} showStatus={false} style={s.coverImage} resizeMode="cover" />
        </View> : null}
        <Pressable testID="profile-cover" accessibilityRole="button" accessibilityLabel="资料卡背景"
          accessibilityState={{ busy: coverBusy, disabled: coverBusy }} disabled={coverBusy} onPress={chooseCover}
          style={StyleSheet.absoluteFill} />
        <View style={s.identity} pointerEvents="none">
          <Avatar uri={session.user.avatarUrl} size={52} />
          <View style={s.flex}>
            <View style={cover && s.coverIdentity}>
              <Text raw style={[s.name, cover && s.coverText]}>{accountAuthor(session.user).name}</Text>
              {session.user.bio ? <Text raw style={[s.bio, cover && s.coverText]}>{session.user.bio}</Text> : null}
            </View>
          </View>
          <View style={[s.coverIcon, cover && s.coverIconOnPhoto]}>
            {coverBusy ? <ActivityIndicator color={cover ? c.green : c.surface} size="small" /> :
              <AppIcon name="photo" size={18} color={cover ? c.green : c.surface} />}
          </View>
        </View>
        <View style={[s.profileActions, cover && s.coverActions]} pointerEvents="box-none">
          <Pressable testID="profile-edit" accessibilityRole="button" onPress={onEditProfile} style={s.accountAction}>
            <AppIcon name="edit" size={15} color={cover ? c.green : c.tint} /><Text style={[s.accountLabel, cover && s.coverText]}>编辑资料</Text>
          </Pressable>
          <Pressable testID="profile-account" accessibilityRole="button" onPress={onAccount} style={s.accountAction}>
            <Text style={[s.accountLabel, cover && s.coverText]}>账号与安全</Text><AppIcon name="chevron" size={14} color={cover ? c.green : c.tint} />
          </Pressable>
        </View>
        <Pressable testID="profile-submissions" accessibilityRole="button" onPress={onContribute}
          style={({ pressed }) => [s.profileButton, s.createButton, pressed && s.dim]}>
          <AppIcon name="plus" size={18} /><Text style={s.createLabel}>新建投稿</Text>
        </Pressable>
      </View>
      <View accessibilityRole="tablist" style={[s.tabs, s.primaryTabs]}>
        {(Object.keys(panels) as (keyof typeof panels)[]).map(key => <Pressable key={key} testID={`profile-panel-${key}`} accessibilityRole="tab"
          accessibilityState={{ selected: panel === key }} onPress={() => { setPanel(key); setConfirm(false); }} style={[s.tab, panel === key && s.tabActive]}>
          <Text style={[s.tabText, s.primaryTabText, panel === key && s.active]}>{panels[key]}</Text>
        </Pressable>)}
      </View>
      <View accessibilityRole="tablist" style={s.sectionTabs}>
        {(Object.keys(sections) as Section[]).map(key => <Pressable testID={`profile-section-${key}`} key={key} accessibilityRole="tab" accessibilityState={{ selected: section === key }}
          onPress={() => { setSection(key); setConfirm(false); }} style={[s.sectionTab, section === key && s.sectionActive]}>
          <Text style={[s.tabText, section === key && s.active]}>{sections[key]}</Text>
        </Pressable>)}
      </View>
    {panel === 'submissions' ? (
      active && !submissionsPaused ? <SubmissionList key={session.user.id} token={session.token} section={section} onOpen={onOpenSubmission} /> : null
    ) : section === 'posts' ? <>
      {data.error ? <Text style={s.notice}>{data.error}</Text> : null}
      {postIds.map(id => {
        const article = data.articles.find(post => post.id === id);
        if (article) return <View key={id} style={s.routeRow}>
          <Pressable testID={`profile-article-${id}`} accessibilityRole="button" onPress={() => onOpenArticle(id)} style={s.routeMain}>
            <AppIcon name="book" size={18} /><Text raw style={[s.rowTitle, s.flex]}>{guideArticleTitle(article, language)}</Text><AppIcon name="chevron" size={16} />
          </Pressable>
          {!recent ? <Pressable accessibilityRole="button" accessibilityLabel="取消收藏" disabled={!bookmarks.ready} onPress={() => bookmarks.toggle(id)} style={s.iconButton}><AppIcon name="bookmark" /></Pressable> : null}
        </View>;
        const item = guideEntries.get(id);
        return item ? <EntryCard key={id} {...item} bookmarks={bookmarks} onOpenContent={onOpenContent} onVisit={history.visitPost} /> : (
          <View key={id} style={s.unavailable}><Text style={[s.body,s.flex]}>帖子已下线或暂时无法读取</Text>{!recent ? <Pressable accessibilityRole="button" accessibilityLabel="取消收藏" disabled={!bookmarks.ready} onPress={() => bookmarks.toggle(id)} style={s.iconButton}><AppIcon name="bookmark" /></Pressable> : null}</View>
        );
      })}
      {!postIds.length ? <View style={s.empty}><AppIcon name="book" size={24} /><Text style={s.body}>{recent ? '还没有浏览过帖子。' : '还没有收藏帖子。在指南帖子旁点书签即可收藏。'}</Text></View> : null}
    </> : section === 'routes' ? <>
      {campus.error ? <Text style={s.notice}>{campus.error}</Text> : null}
      {routeItems.map(route => {
        const shared = route.source === 'community' ? getCampusRoute(route.id) : undefined;
        const origin = getPlace(shared?.originId || route.originId), destination = getPlace(shared?.destinationId || route.destinationId);
        const available = Boolean(origin && destination && (route.source === 'demo' || shared));
        return <View key={route.id} style={s.routeRow}><Pressable testID={`saved-route-${route.id}`} disabled={!available} accessibilityRole="button" onPress={() => onOpenRoute(route)} style={s.routeMain}><View style={s.symbol}><AppIcon name="walk" /></View><View style={s.flex}>
          {shared ? <Text raw style={s.rowTitle}>{shared.title}</Text> : <Text raw style={s.rowTitle}>{origin && destination ? `${placeName(origin)} → ${placeName(destination)}` : ''}</Text>}
          <Text style={s.meta}>{!available ? '路线已下线或暂时无法读取' : shared ? '同学分享的路线' : destination?.parentBuildingId ? '教室路线' : '演示路线'}</Text>
          {shared && origin && destination ? <Text raw style={s.meta}>{placeName(origin)} → {placeName(destination)}</Text> : null}
        </View>{available ? <AppIcon name="chevron" size={17} /> : null}</Pressable>{!recent ? <Pressable accessibilityRole="button" accessibilityLabel="取消收藏路线" disabled={!routes.ready} onPress={() => routes.toggle(route)} style={s.iconButton}><AppIcon name="bookmark" /></Pressable> : null}</View>;
      })}
      {!routeItems.length ? <View style={s.empty}><AppIcon name="walk" size={24} /><Text style={s.body}>{recent ? '还没有浏览过路线。' : '还没有收藏路线。打开步行路线后，点右上角书签。'}</Text></View> : null}
    </> : <>
      {ids.map(id => { const place = getPlace(id); return place ? <PlaceRow key={id} place={place} onPress={() => onOpenPlace(place)} trailing={savePlaceButton(id)} /> : <View key={id} style={s.unavailable}><Text style={[s.body,s.flex]}>地点已下线或暂时无法读取</Text>{savePlaceButton(id)}</View>; })}
      {!ids.length ? <View style={s.empty}><AppIcon name={recent ? 'history' : 'pin'} size={30} /><Text style={s.body}>{recent ? '还没有浏览记录。打开地点详情后会出现在这里。' : '还没有收藏地点。在地点旁点书签试试。'}</Text></View> : null}
    </>}
    {recent && hasHistory ? confirm ? <View style={s.confirm}><Text style={s.body}>清空此分类的浏览记录？</Text><Pressable accessibilityRole="button" onPress={() => { clearHistory(); setConfirm(false); }} style={s.subTab}><Text style={s.active}>确认清空</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setConfirm(false)} style={s.subTab}><Text style={s.active}>取消</Text></Pressable></View> : <Pressable accessibilityRole="button" onPress={() => setConfirm(true)} style={s.clear}><AppIcon name="trash" size={17} /><Text style={s.active}>清空浏览记录</Text></Pressable> : null}
    </>}
    </ScrollView>
  </View>;
}

const submissionSections = { place: 'places', new_place: 'places', route: 'routes', new_route: 'routes', guide: 'posts', food: 'posts', group: 'posts' } as const;
const submissionStatuses = { pending: '待审核', approved: '已通过', changes_requested: '需修改' } as const;

function SubmissionList({ token, section, onOpen }: { token: string; section: Section; onOpen: (item: Submission) => void }) {
  const [items, setItems] = useState<Submission[]>([]);
  const [page, setPage] = useState(1);
  const [next, setNext] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setFailed(false);
    fetchSubmissions(token, page).then(result => {
      if (!current) return;
      setItems(previous => page === 1 ? result.submissions : [...previous, ...result.submissions.filter(item => !previous.some(existing => existing.id === item.id))]);
      setNext(result.nextPage);
    }).catch(() => { if (current) setFailed(true); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [token, page, retry]);

  const visible = items.filter(item => submissionSections[item.kind] === section);
  return <>
    {visible.map(item => <Pressable key={item.id} testID={`profile-submission-${item.id}`} accessibilityRole="button" onPress={() => onOpen(item)} style={s.settingRow}>
      <View style={s.flex}><Text raw style={s.rowTitle}>{item.title}</Text>
        {item.authorProfile ? <AuthorByline author={item.authorProfile} /> : null}
      </View><Text style={s.meta}>{submissionStatuses[item.status]}</Text><AppIcon name="chevron" size={16} />
    </Pressable>)}
    {loading ? <ActivityIndicator color={c.green} style={s.empty} /> : failed ? <View style={s.empty}>
      <Text style={s.body}>暂时无法读取投稿。</Text><Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={s.subTab}><Text style={s.active}>重新加载</Text></Pressable>
    </View> : next ? <Pressable accessibilityRole="button" onPress={() => setPage(next)} style={s.clear}><Text style={s.active}>加载更早的投稿</Text></Pressable> : !visible.length ? <View style={s.empty}>
      <Text style={s.body}>这个分类还没有投稿。</Text>
    </View> : null}
  </>;
}

function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return <View style={s.panelHeader}>
    <Pressable accessibilityRole="button" accessibilityLabel="返回" style={s.iconButton} onPress={onBack}><AppIcon name="back" size={20} /></Pressable>
    <Text accessibilityRole="header" style={s.title}>{title}</Text>
  </View>;
}

function Preferences({ onBack, token, accountReady, onLogin, onPrivacySaved }: {
  onBack: () => void; token?: string; accountReady: boolean; onLogin: (expired?: boolean) => void; onPrivacySaved: () => void;
}) {
  const { language, chooseLanguage } = useLanguage();
  const [about, setAbout] = useState(false);
  return <View style={s.flex}>
    <PanelHeader title="设置" onBack={onBack} />
    <ScrollView style={s.flex} contentContainerStyle={s.page}>
      <View style={s.settingRow}><AppIcon name="globe" size={18} /><Text style={s.rowTitle}>界面语言</Text></View>
      <View accessibilityRole="radiogroup" style={s.languageOptions}>{languages.map(item => <Pressable key={item.code} testID={`language-${item.code}`} accessibilityRole="radio" accessibilityState={{ checked: language === item.code }} onPress={() => chooseLanguage(item.code)} style={[s.language, language === item.code && s.selectedLanguage]}><Text raw style={[s.body, language === item.code && s.selectedLanguageText]}>{item.label}</Text></Pressable>)}</View>
      <View style={s.privacyHeading}>
        <AppIcon name="lock" size={18} /><Text accessibilityRole="header" style={[s.rowTitle, s.flex]}>隐私设置</Text>
      </View>
      {!accountReady ? <ActivityIndicator color={c.green} style={s.privacyLoading} /> : token ?
        <PrivacyControls key={token} token={token} onLogin={onLogin} onSaved={onPrivacySaved} /> :
        <Pressable accessibilityRole="button" onPress={() => onLogin()} style={s.settingRow}>
          <Text style={[s.body, s.flex]}>登录后可管理投稿、评论和主页隐私。</Text>
          <Text style={s.active}>去登录</Text><AppIcon name="chevron" size={16} />
        </Pressable>}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: about }} onPress={() => setAbout(!about)} style={s.settingRow}><AppIcon name="info" size={18} /><Text style={[s.rowTitle, s.flex]}>关于港大漫游</Text><AppIcon name="chevron" size={16} /></Pressable>
      {about ? <View style={s.about}>
        <Text style={s.body}>独立校园地图与学生指南项目，并非香港大学官方应用。校园照片来自 HKU Wallpapers；地点与楼宇名称参考港大校园地图，部分入口资料尚待补充。投稿经管理员审核后发布，原文不会随界面语言改变。</Text>
        <Pressable accessibilityRole="link" onPress={() => void openLink('https://www.openstreetmap.org/copyright')} style={s.settingRow}><Text raw style={[s.body, s.flex]}>© OpenStreetMap contributors</Text><AppIcon name="external" size={16} /></Pressable>
      </View> : null}
    </ScrollView>
  </View>;
}

const privacyOptions: { key: keyof Privacy; label: string; description: string }[] = [
  { key: 'showPostAuthor', label: '投稿显示署名', description: '关闭后，所有投稿都以匿名用户显示。' },
  { key: 'showCommentAuthor', label: '评论显示署名', description: '关闭后，帖子和地点评论都会显示为匿名用户。' },
  { key: 'publicProfile', label: '允许他人查看我的主页', description: '开启后，访客可以从你的公开署名查看主页。' },
];

function PrivacyControls({ token, onLogin, onSaved }: {
  token: string; onLogin: (expired?: boolean) => void; onSaved: () => void;
}) {
  const [privacy, setPrivacy] = useState<Privacy>();
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'load' | 'save' | 'expired'>();
  useEffect(() => {
    let live = true;
    setError(undefined);
    fetchPrivacy(token).then(({ privacy }) => {
      if (live) setPrivacy(privacy);
    }).catch(cause => {
      if (live) setError(cause instanceof ApiError && cause.status === 401 ? 'expired' : 'load');
    });
    return () => { live = false; };
  }, [token, retry]);
  const change = async (key: keyof Privacy, value: boolean) => {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const result = await updatePrivacy(token, { [key]: value });
      setPrivacy(result.privacy);
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 401 ? 'expired' : 'save');
    } finally { setSaving(false); }
  };

  if (error === 'expired' || error === 'load') return <Pressable accessibilityRole="button"
    onPress={() => error === 'expired' ? onLogin(true) : setRetry(value => value + 1)} style={s.settingRow}>
    <Text style={[s.body, s.flex]}>{error === 'expired' ? '登录已失效，请重新登录。' : '暂时无法读取隐私设置。'}</Text>
    <Text style={s.active}>{error === 'expired' ? '去登录' : '重新加载'}</Text>
  </Pressable>;
  if (!privacy) return <ActivityIndicator color={c.green} style={s.privacyLoading} />;
  return <>
    {privacyOptions.map(({ key, label, description }) => <View key={key} style={[s.settingRow, s.privacyRow]}>
      <View style={s.flex}>
        <Text style={s.rowTitle}>{label}</Text><Text style={s.privacyDescription}>{description}</Text>
      </View>
      <Switch testID={`privacy-${key}`} accessibilityLabel={t(label)} accessibilityHint={t(description)} disabled={saving}
        value={privacy[key]} onValueChange={value => void change(key, value)} trackColor={{ true: c.green }} thumbColor={c.surface} />
    </View>)}
    {saving ? <Text accessibilityLiveRegion="polite" style={s.privacyFeedback}>正在保存…</Text> : null}
    {error === 'save' ? <Text accessibilityLiveRegion="polite" style={s.privacyFeedback}>隐私设置未能保存，请再试一次。</Text> : null}
  </>;
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  page: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 28 },
  profile: { backgroundColor: c.green, borderRadius: 12, padding: 14, gap: 12, overflow: 'hidden' },
  coverImage: { width: '100%', height: '100%' },
  coverIdentity: { backgroundColor: c.app, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  coverText: { color: c.ink },
  coverActions: { backgroundColor: c.app, alignSelf: 'flex-start', maxWidth: '100%', paddingHorizontal: 8, borderRadius: 8 },
  coverIcon: { width: 34, height: 34, borderRadius: 17, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff24' },
  coverIconOnPhoto: { backgroundColor: c.app },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerAction: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  inboxDot: { position: 'absolute', top: 10, right: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: c.rust },
  guestPanel: { backgroundColor: c.tint, padding: 16, borderRadius: 12, gap: 8 },
  guestHeading: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 18, marginBottom: 4 },
  profileButton: { minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', padding: 9, borderRadius: 8 },
  loginButton: { backgroundColor: c.green, marginTop: 6 },
  loginLabel: { color: c.surface, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  createButton: { backgroundColor: c.tint },
  createLabel: { color: c.green, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  dim: { opacity: 0.7 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 20, lineHeight: 28, fontWeight: '600', color: c.surface },
  bio: { color: c.tint, fontSize: 13, lineHeight: 19, marginTop: 3 },
  profileActions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18 },
  accountAction: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48 },
  accountLabel: { flexShrink: 1, fontSize: 13, lineHeight: 20, color: c.tint },
  panelHeader: { width: '100%', maxWidth: 650, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, minHeight: 56 },
  title: { fontSize: 22, lineHeight: 28, color: c.ink, fontWeight: '600', flexShrink: 1 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.line, marginBottom: 8 },
  primaryTabs: { marginTop: 16 },
  primaryTabText: { fontSize: 16, lineHeight: 24 },
  tab: { flex: 1, minHeight: 48, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: c.green },
  tabText: { fontSize: 14, color: c.muted, lineHeight: 20, textAlign: 'center' },
  sectionTabs: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  sectionTab: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, justifyContent: 'center', borderRadius: 8 },
  sectionActive: { backgroundColor: c.tint },
  active: { color: c.green, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 20, color: c.muted },
  meta: { fontSize: 12, lineHeight: 16, color: c.muted },
  rowTitle: { fontSize: 15, lineHeight: 20, color: c.ink, fontWeight: '600' },
  iconButton: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'flex-start', gap: 8, paddingVertical: 24 },
  routeRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: c.line },
  routeMain: { flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 12 },
  symbol: { width: 38, height: 38, borderRadius: 8, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' },
  unavailable: { flexDirection: 'row', alignItems: 'center', padding: 8, backgroundColor: c.paper, borderRadius: 8, marginBottom: 8 },
  notice: { fontSize: 12, lineHeight: 20, color: c.ink, padding: 12, backgroundColor: c.rustLight, marginBottom: 12, borderRadius: 8 },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, marginTop: 8 },
  confirm: { marginTop: 16, gap: 8 },
  subTab: { minHeight: 48, padding: 12, borderRadius: 8, backgroundColor: c.paper },
  settingRow: { minHeight: 56, flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.line },
  privacyHeading: { minHeight: 48, marginTop: 8, flexDirection: 'row', gap: 12, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: c.line },
  privacyRow: { paddingVertical: 12 },
  privacyDescription: { fontSize: 13, lineHeight: 19, color: c.muted, marginTop: 4 },
  privacyLoading: { minHeight: 56 },
  privacyFeedback: { color: c.muted, fontSize: 13, lineHeight: 19, marginVertical: 8 },
  languageOptions: { flexDirection: 'row', gap: 8, paddingVertical: 12 },
  language: { flex: 1, minHeight: 48, padding: 8, borderRadius: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' },
  selectedLanguage: { backgroundColor: c.tint, borderColor: c.green },
  selectedLanguageText: { color: c.green, fontWeight: '600' },
  about: { paddingTop: 12, gap: 8 },
});
