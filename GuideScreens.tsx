import { useEffect, useState } from 'react';
import {
  ActivityIndicator, BackHandler, Linking, Modal, Switch,
  RefreshControl, ScrollView, StyleSheet, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert, Image, Pressable, Text } from './ui';
import { useLanguage } from './LanguageProvider';
import { languages, t } from './localization';
import { colors } from './theme';
import { PlaceRecords } from './usePlaces';
import { Category, Place, findPlace } from './campus';
import { PlaceRow } from './CampusMap';
import AppIcon, { IconName } from './AppIcon';
import { ADMIN_URL, GuideCategory, GuideEntry, GuideKey } from './guideApi';
import useGuide from './useGuide';

type GuideData = ReturnType<typeof useGuide>;
type Bookmarks = { saved: string[]; ready: boolean; toggle: (id: string) => void };
const green = '#184d3e';
const ink = '#203a31';
const muted = colors.muted;
const paper = colors.paper;
const icons: Record<GuideKey, IconName> = { links: 'link', tips: 'tips', food: 'food', groups: 'groups' };

async function openLink(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('暂时无法打开链接', '请检查网络后重试。');
  }
}

function RefreshButton({ data }: { data: GuideData }) {
  return (
    <Pressable testID="refresh-guide" accessibilityRole="button" accessibilityLabel="刷新学生指南"
      disabled={data.loading} onPress={() => void data.reload()} style={s.iconButton}>
      {data.loading ? <ActivityIndicator color={green} /> : <AppIcon name="refresh" />}
    </Pressable>
  );
}

function Feedback({ data }: { data: GuideData }) {
  if (data.loading && !data.categories.length) {
    return <View style={s.empty}><ActivityIndicator color={green} /><Text style={s.body}>正在读取学生指南…</Text></View>;
  }
  if (data.error) {
    return (
      <View style={s.feedback}>
        <Text style={s.body}>{data.error}{data.categories.length ? ' 当前保留上次读取的内容。' : ''}</Text>
        <Pressable accessibilityRole="button" disabled={data.loading} onPress={() => void data.reload()} style={s.smallAction}>
          <Text style={s.actionText}>重新加载</Text>
        </Pressable>
      </View>
    );
  }
  if (!data.categories.length) return <Text style={s.body}>还没有发布的学生指南，稍后再来看看。</Text>;
  return null;
}

function EntryCard({ entry, category, bookmarks, first = false, onMap }: { entry: GuideEntry; category: GuideKey; bookmarks: Bookmarks; first?: boolean; onMap?: (category: Category) => void }) {
  const [expanded, setExpanded] = useState(category === 'links' || first);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [entry.imageUrl]);
  const saved = bookmarks.saved.includes(entry.id);
  const isLink = category === 'links';
  return (
    <View style={s.entry}>
      <View style={s.entryHeader}>
        <Pressable accessibilityRole="button" accessibilityState={isLink ? undefined : { expanded }}
          testID={`guide-entry-${entry.id}`}
          onPress={() => isLink ? void openLink(entry.externalUrl) : setExpanded(value => !value)}
          style={s.entrySummary}>
          <View style={[s.entrySymbol, category === 'food' && s.foodSymbol]}><AppIcon name={icons[category]} size={20} color={category === 'food' ? colors.rust : green} /></View>
          <View style={s.flex}>
            <Text raw={entry.isCommunity !== false} style={s.entryTitle}>{entry.title}</Text>
            {isLink ? <Text raw={entry.isCommunity !== false} style={s.meta}>{entry.body}</Text> : null}
            {entry.isExample ? <Text style={s.example}>内容示例</Text> : null}
          </View>
          <View style={!isLink && expanded ? s.chevronOpen : undefined}><AppIcon name={isLink ? 'external' : 'chevron'} size={16} /></View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t(saved ? '取消收藏：{title}' : '收藏：{title}', { title: entry.title })}
          accessibilityState={{ selected: saved, disabled: !bookmarks.ready }}
          disabled={!bookmarks.ready} onPress={() => bookmarks.toggle(entry.id)} style={s.iconButton}>
          <AppIcon name="saved" color={saved ? '#a14630' : muted} size={19} />
        </Pressable>
      </View>
      {expanded && !isLink ? (
        <View style={s.entryBody}>
          <Text raw={entry.isCommunity !== false} style={s.body}>{entry.body}</Text>
          {entry.imageUrl && !imageFailed ? (
            <Image source={{ uri: entry.imageUrl }} accessibilityLabel={t('内容配图：{title}', { title: entry.isCommunity === false ? t(entry.title) : entry.title })} style={s.contentImage}
              resizeMode="cover" onError={() => setImageFailed(true)} />
          ) : category === 'food' ? (
            <View style={s.photoSlot}><AppIcon name="photo" /><Text style={s.meta}>{imageFailed ? '配图暂时无法加载' : '店铺与餐点实拍待补充'}</Text></View>
          ) : null}
          {entry.externalUrl ? (
            <Pressable accessibilityRole="link" onPress={() => void openLink(entry.externalUrl)} style={s.smallAction}>
              <Text style={s.actionText}>{category === 'groups' ? '打开入群链接' : '查看相关链接'}</Text><AppIcon name="external" size={16} />
            </Pressable>
          ) : category === 'groups' ? <Text style={s.pending}>邀请入口待群主补充</Text> : null}
          {category === 'food' && onMap ? <Pressable accessibilityRole="button" onPress={() => onMap('food')} style={s.smallAction}><AppIcon name="map" size={17} /><Text style={s.actionText}>在地图查看餐饮</Text></Pressable> : null}
        </View>
      ) : null}
    </View>
  );
}

export function GuideScreen({ data, bookmarks, selected, onSelect, onContribute, onMap }: {
  data: GuideData; bookmarks: Bookmarks; selected: GuideKey | null; onSelect: (key: GuideKey | null) => void; onContribute: () => void; onMap: (category: Category) => void;
}) {
  const [foodFilter, setFoodFilter] = useState<number | null>(null);
  useEffect(() => setFoodFilter(null), [selected]);
  const category = data.categories.find(item => item.key === selected);
  const foodTags = ['午餐', '咖啡轻食', '朋友聚餐'];
  const foodPatterns = [/午餐|赶课|lunch/i, /咖啡|轻食|coffee|caf[eé]/i, /聚餐|朋友|dinner|weekend/i];
  const entries = category?.entries.filter(entry => category.key !== 'food' || foodFilter === null || foodPatterns[foodFilter].test(entry.title + ' ' + entry.body)) ?? [];
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!selected) return false;
      onSelect(null);
      return true;
    });
    return () => listener.remove();
  }, [selected, onSelect]);

  return (
    <>
      {category ? (
        <View style={s.topBar}>
          <Pressable accessibilityRole="button" accessibilityLabel="返回学生指南" onPress={() => onSelect(null)} style={s.iconButton}><AppIcon name="back" /></Pressable>
          <Text accessibilityRole="header" style={s.topTitle}>{category.title}</Text>
          <RefreshButton data={data} />
        </View>
      ) : null}
      <ScrollView style={s.flex} contentContainerStyle={s.page}
        refreshControl={<RefreshControl refreshing={data.loading} onRefresh={() => void data.reload()} tintColor={green} />}>
        {!category ? (
          <>
            <View style={s.headingRow}><Text accessibilityRole="header" style={s.title}>学生指南</Text><RefreshButton data={data} /></View>
            <Text style={s.subtitle}>从第一天开始，慢慢熟悉校园生活。</Text>
          </>
        ) : <Text style={s.subtitle}>{category.introduction}</Text>}
        <Feedback data={data} />
        {category ? (
          <>
            {category.key === 'food' ? <View style={s.foodFilters}>{foodTags.map((tag, index) => <Pressable key={tag} accessibilityRole="button" accessibilityState={{ selected: foodFilter === index }} onPress={() => setFoodFilter(foodFilter === index ? null : index)} style={[s.foodFilter, foodFilter === index && s.selectedLanguage]}><Text style={[s.meta, foodFilter === index && s.white]}>{tag}</Text></Pressable>)}</View> : null}
            {entries.length ? entries.map((entry, index) => (
              <EntryCard key={entry.id} entry={entry} category={category.key} bookmarks={bookmarks} first={index === 0} onMap={onMap} />
            )) : <Text style={s.body}>{category.entries.length ? '当前筛选没有内容，再点一次标签可以查看全部。' : '这个分类还没有发布内容。'}</Text>}
            {category.key === 'food' ? <Pressable accessibilityRole="link" onPress={() => void openLink('https://catering.hku.hk/en/')} style={s.settingRow}><Text style={s.settingTitle}>查看校内餐饮目录</Text><AppIcon name="external" size={17} /></Pressable> : null}
          </>
        ) : (
          <>
            {data.categories.length ? <View style={s.intro}><AppIcon name="book" size={27} /><View style={s.flex}><Text style={s.introTitle}>常用的、好吃的、一起玩的</Text><Text style={s.meta}>四个入口，把校园生活放在手边。</Text></View></View> : null}
            <View style={s.cardGrid}>
              {data.categories.map((item, index) => (
                <Pressable key={item.key} testID={`guide-card-${item.key}`} accessibilityRole="button"
                  onPress={() => onSelect(item.key)} style={({ pressed }) => [s.card, index === 0 && s.firstCard, pressed && s.pressed]}>
                  <View style={[s.cardSymbol, index === 0 && s.firstSymbol]}><AppIcon name={icons[item.key]} color={index === 0 ? '#fff' : green} /></View>
                  <Text style={[s.cardTitle, index === 0 && s.white]}>{item.title}</Text>
                  <Text style={[s.cardCopy, index === 0 && s.firstCopy]}>{item.subtitle}</Text>
                  <View style={s.cardArrow}><AppIcon name="arrow" color={index === 0 ? '#fff' : green} size={17} /></View>
                </Pressable>
              ))}
            </View>
            <View style={s.guideHelp}><Text style={s.introTitle}>第一次来，可以先从地图开始</Text><Text style={s.meta}>搜索地点、确认入口，再跟着图文步骤认识校园。</Text><Pressable accessibilityRole="button" onPress={() => onMap('all')} style={s.smallAction}><AppIcon name="map" size={17} /><Text style={s.actionText}>去地图找路</Text></Pressable></View>
            <Pressable accessibilityRole="button" onPress={onContribute} style={s.settingRow}>
              <AppIcon name="groups" /><View style={s.flex}><Text style={s.introTitle}>分享发现，一起更新指南</Text><Text style={s.meta}>投稿 · 地点纠错 · 查看审核进度</Text></View><AppIcon name="chevron" size={17} />
            </Pressable>
            {data.categories.length ? <Text style={s.note}>向下拉可以刷新内容。点内容旁的书签，把常用信息留在本机。</Text> : null}
          </>
        )}
      </ScrollView>
    </>
  );
}

export function SavedScreen({ data, bookmarks, records, onOpenPlace }: { data: GuideData; bookmarks: Bookmarks; records: PlaceRecords; onOpenPlace: (place: Place) => void }) {
  const [section, setSection] = useState<'saved' | 'recent'>('saved');
  const [confirmClear, setConfirmClear] = useState(false);
  const entries = data.categories.flatMap(category => category.entries
    .filter(entry => bookmarks.saved.includes(entry.id)).map(entry => ({ entry, category: category.key })));
  return (
    <ScrollView style={s.flex} contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={data.loading} onRefresh={() => void data.reload()} tintColor={green} />}>
      <Text accessibilityRole="header" style={s.title}>熟悉的地方</Text>
      <Text style={s.subtitle}>把常去的地方，留在手边。</Text>
      <View style={s.savedTabs} accessibilityRole="tablist">{(['saved', 'recent'] as const).map(key => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: key === section }} onPress={() => { setSection(key); setConfirmClear(false); }} style={[s.savedTab, key === section && s.savedTabActive]}><Text style={[s.savedTabText, key === section && s.actionText]}>{key === 'saved' ? '我的收藏' : '最近浏览'} {key === 'saved' ? records.saved.length : records.recent.length}</Text></Pressable>)}</View>
      {(section === 'saved' ? records.saved : records.recent).map(id => <PlaceRow key={id} place={findPlace(id)} onPress={() => onOpenPlace(findPlace(id))} trailing={<Pressable accessibilityRole="button" accessibilityLabel={records.saved.includes(id) ? '取消收藏' : '收藏地点'} disabled={!records.ready} onPress={() => records.toggle(id)} style={s.iconButton}><AppIcon name="bookmark" size={19} color={records.saved.includes(id) ? green : muted} /></Pressable>} />)}
      {!(section === 'saved' ? records.saved : records.recent).length ? <View style={s.empty}><AppIcon name={section === 'saved' ? 'bookmark' : 'history'} size={28} /><Text style={s.body}>{section === 'saved' ? '还没有收藏地点。在地点旁点书签试试。' : '还没有浏览记录。打开地点详情后会出现在这里。'}</Text></View> : null}
      {section === 'recent' && records.recent.length ? <View style={s.clearHistory}>{confirmClear ? <><Text style={s.body}>清空这台设备的浏览记录？</Text><View style={s.headingRow}><Pressable accessibilityRole="button" onPress={() => setConfirmClear(false)} style={s.smallAction}><Text style={s.actionText}>取消</Text></Pressable><Pressable accessibilityRole="button" onPress={() => { records.clearRecent(); setConfirmClear(false); }} style={s.smallAction}><Text style={s.actionText}>确认清空</Text></Pressable></View></> : <Pressable accessibilityRole="button" onPress={() => setConfirmClear(true)} style={s.smallAction}><AppIcon name="trash" size={17} /><Text style={s.actionText}>清空浏览记录</Text></Pressable>}</View> : null}
      {section === 'saved' ? <><Text style={s.sectionTitle}>学生指南收藏</Text><Feedback data={data} />{entries.map(({ entry, category }) => <EntryCard key={entry.id} entry={entry} category={category} bookmarks={bookmarks} />)}{!entries.length ? <Text style={s.body}>在学生指南中点书签，把常用内容留在这里。</Text> : null}</> : null}
      <View style={s.localNotice}><AppIcon name="shield" size={15} /><Text style={[s.meta, s.flex]}>收藏和浏览记录仅保存在当前设备，无需登录。</Text></View>
    </ScrollView>
  );
}

export function MoreScreen({ data, onContribute, sampleLocation, onSampleLocation }: { data: GuideData; onContribute: () => void; sampleLocation: boolean; onSampleLocation: (value: boolean) => void }) {
  const { language, chooseLanguage } = useLanguage();
  const [help, setHelp] = useState(false);
  const [about, setAbout] = useState(false);
  const [originalMap, setOriginalMap] = useState(false);
  return (
    <ScrollView style={s.flex} contentContainerStyle={s.page}>
      <Text accessibilityRole="header" style={s.title}>更多</Text>
      <Text style={s.subtitle}>轻装出发，慢慢熟悉校园。</Text>
      <View style={s.intro}><View style={s.brandSymbol}><AppIcon name="map" color="#fff" size={28} /></View><View style={s.flex}><Text style={s.introTitle}>随时打开，直接使用</Text><Text style={s.meta}>看地图、找地点和查路线，都不需要注册账号。</Text></View></View>
      <Text style={s.sectionTitle}>使用偏好</Text>
      <View style={s.preference}><View style={s.settingLabel}><AppIcon name="globe" size={20} /><Text style={s.settingTitle}>界面语言</Text></View><View style={s.languageOptions} accessibilityRole="radiogroup">{languages.map(item => <Pressable key={item.code} testID={`language-${item.code}`} accessibilityRole="radio" accessibilityState={{ checked: language === item.code }} onPress={() => chooseLanguage(item.code)} style={[s.language, language === item.code && s.selectedLanguage]}><Text raw style={[s.languageText, language === item.code && s.white]}>{item.label}</Text></Pressable>)}</View></View>
      <View style={s.settingRow}><AppIcon name="locate" /><View style={s.flex}><Text style={s.introTitle}>显示演示位置</Text><Text style={s.meta}>仅展示蓝点效果，GPS 实时定位待接入。</Text></View><Switch accessibilityLabel={t('显示演示位置')} value={sampleLocation} onValueChange={onSampleLocation} trackColor={{ false: '#c5cec3', true: green }} thumbColor="#fff" /></View>
      <Text style={s.sectionTitle}>地图资料</Text>
      <Pressable accessibilityRole="button" onPress={() => void data.reload()} disabled={data.loading} style={s.settingRow}><AppIcon name="refresh" /><View style={s.flex}><Text style={s.introTitle}>检查资料更新</Text><Text style={s.meta}>{data.loading ? '正在更新学生指南…' : '刷新学生指南和已发布的投稿内容'}</Text></View>{data.loading ? <ActivityIndicator color={green} /> : <AppIcon name="refresh" size={17} />}</Pressable>
      <Feedback data={data} />
      <Pressable accessibilityRole="button" onPress={() => setOriginalMap(true)} style={s.settingRow}><AppIcon name="map" /><Text style={s.settingTitle}>查看校园地图原图</Text><AppIcon name="chevron" size={17} /></Pressable>
      <Text style={s.sectionTitle}>了解更多</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: help }} onPress={() => setHelp(value => !value)} style={s.settingRow}><AppIcon name="info" /><Text style={s.settingTitle}>使用说明</Text><AppIcon name="chevron" size={17} /></Pressable>
      {help ? <Text style={s.helpCopy}>从地图搜索框输入名称、英文或简称，也可以直接点击地图标记。打开地点详情后查看步行路线；起点和终点可以更换，每一步右侧都有配图位置。收藏及浏览记录保存在本机。地图、距离和路线目前为演示，暂未接入 GPS。</Text> : null}
      <Pressable accessibilityRole="button" onPress={onContribute} style={s.settingRow}>
        <AppIcon name="groups" /><Text style={s.settingTitle}>校园共建与我的投稿</Text><AppIcon name="chevron" size={17} />
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => void openLink(ADMIN_URL)} style={s.settingRow}>
        <AppIcon name="book" /><Text style={s.settingTitle}>管理员内容维护</Text><AppIcon name="external" size={17} />
      </Pressable>
      <Text style={s.note}>管理员登录后，可以编辑和发布指南内容。</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: about }} onPress={() => setAbout(value => !value)} style={s.settingRow}><AppIcon name="leaf" /><Text style={s.settingTitle}>关于港大漫游</Text><AppIcon name="chevron" size={17} /></Pressable>
      {about ? <Text style={s.helpCopy}>独立校园地图与学生指南项目，并非香港大学官方应用。校园照片来自 HKU Wallpapers；地图、入口、距离和路线资料目前仅为演示。投稿经管理员审核后发布，原文不会随界面语言改变。</Text> : null}
      <Modal visible={originalMap} animationType="slide" onRequestClose={() => setOriginalMap(false)}><SafeAreaView style={{ flex: 1, backgroundColor: colors.app }}><View style={s.topBar}><Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => setOriginalMap(false)} style={s.iconButton}><AppIcon name="back" /></Pressable><Text style={s.topTitle}>校园地图原图</Text></View><ScrollView horizontal maximumZoomScale={3} minimumZoomScale={1}><ScrollView><Image source={require('./assets/hku-campus-map.png')} style={{ width: 1080, height: 765 }} resizeMode="contain" accessibilityLabel="香港大学校园地图原图" /></ScrollView></ScrollView></SafeAreaView></Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  page: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 26 },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 25, lineHeight: 34, color: ink, fontWeight: '800', flexShrink: 1 },
  subtitle: { fontSize: 14, color: muted, lineHeight: 23, marginTop: 6, marginBottom: 20 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  topBar: { width: '100%', maxWidth: 650, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, gap: 4 },
  topTitle: { fontSize: 19, fontWeight: '800', color: ink, flex: 1 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#eaf1e8', padding: 15, borderRadius: 14, marginBottom: 20 },
  introTitle: { fontSize: 15, fontWeight: '700', color: ink, lineHeight: 23 },
  meta: { fontSize: 12, color: muted, lineHeight: 20 },
  body: { fontSize: 14, color: muted, lineHeight: 24 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { width: '47%', flexGrow: 1, minHeight: 180, padding: 16, backgroundColor: '#fff', borderRadius: 14 },
  firstCard: { backgroundColor: green },
  cardSymbol: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#eaf1e8', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  firstSymbol: { backgroundColor: '#2d6454' },
  cardTitle: { fontSize: 16, color: ink, fontWeight: '800', lineHeight: 24, marginBottom: 6 },
  cardCopy: { fontSize: 13, color: muted, lineHeight: 21 },
  firstCopy: { color: '#d3e6da' },
  white: { color: '#fff' },
  cardArrow: { alignItems: 'flex-end', marginTop: 'auto', paddingTop: 10 },
  pressed: { opacity: 0.75 },
  note: { fontSize: 12, color: muted, lineHeight: 21, marginTop: 18, marginBottom: 20 },
  feedback: { backgroundColor: '#f4e9df', borderRadius: 12, padding: 13, marginBottom: 14, gap: 8 },
  empty: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 12, gap: 15 },
  smallAction: { alignSelf: 'flex-start', minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#eaf1e8', borderRadius: 9, flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 8 },
  actionText: { color: green, fontSize: 13, fontWeight: '700' },
  entry: { backgroundColor: '#fff', borderRadius: 13, marginBottom: 12, overflow: 'hidden' },
  entryHeader: { flexDirection: 'row', alignItems: 'center', paddingRight: 2 },
  entrySummary: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, minHeight: 72 },
  entrySymbol: { width: 32, minHeight: 37, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eaf1e8', borderRadius: 9 },
  entryTitle: { color: ink, fontSize: 15, fontWeight: '700', lineHeight: 24 },
  example: { fontSize: 11, color: '#89412e', marginTop: 4, lineHeight: 18 },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  entryBody: { paddingHorizontal: 15, paddingBottom: 16 },
  contentImage: { width: '100%', height: 170, borderRadius: 10, marginTop: 12 },
  photoSlot: { minHeight: 80, backgroundColor: paper, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 },
  pending: { fontSize: 12, color: muted, backgroundColor: '#eaf1e8', padding: 12, borderRadius: 9, marginTop: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: ink, marginTop: 12, marginBottom: 9 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, padding: 13, backgroundColor: '#fff', borderRadius: 10, marginBottom: 8 },
  settingTitle: { flex: 1, fontSize: 14, color: ink },
  guideHelp: { marginTop: 25, paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.line, marginBottom: 20, gap: 5 },
  savedTabs: { flexDirection: 'row', gap: 20, marginBottom: 14 }, savedTab: { minHeight: 48, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' }, savedTabActive: { borderBottomColor: green }, savedTabText: { fontSize: 13, color: muted, lineHeight: 22 },
  clearHistory: { paddingVertical: 10 }, localNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderTopWidth: 1, borderTopColor: colors.line, marginTop: 25, paddingTop: 15 },
  brandSymbol: { width: 46, height: 48, borderRadius: 12, backgroundColor: green, alignItems: 'center', justifyContent: 'center' },
  preference: { backgroundColor: '#fff', borderRadius: 10, padding: 13, marginBottom: 8 }, settingLabel: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  languageOptions: { flexDirection: 'row', gap: 5, backgroundColor: colors.tint, padding: 4, borderRadius: 9 }, language: { flex: 1, minHeight: 44, paddingHorizontal: 3, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 7 }, selectedLanguage: { backgroundColor: green }, languageText: { fontSize: 12, color: green, lineHeight: 20 },
  helpCopy: { fontSize: 13, lineHeight: 23, color: muted, padding: 13, paddingTop: 4, marginBottom: 13 },
  foodSymbol: { backgroundColor: colors.rustLight }, foodFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }, foodFilter: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.tint, justifyContent: 'center' },
});
