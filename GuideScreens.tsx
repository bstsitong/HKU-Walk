import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, BackHandler, Image, Linking, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import AppIcon, { IconName } from './AppIcon';
import { ADMIN_URL, GuideCategory, GuideEntry, GuideKey } from './guideApi';
import useGuide from './useGuide';

type GuideData = ReturnType<typeof useGuide>;
type Bookmarks = { saved: string[]; ready: boolean; toggle: (id: string) => void };
const green = '#184d3e';
const ink = '#203a31';
const muted = '#526258';
const paper = '#f7f8f3';
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

function EntryCard({ entry, category, bookmarks }: { entry: GuideEntry; category: GuideKey; bookmarks: Bookmarks }) {
  const [expanded, setExpanded] = useState(category === 'links');
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
          <View style={s.entrySymbol}><AppIcon name={icons[category]} size={20} /></View>
          <View style={s.flex}>
            <Text style={s.entryTitle}>{entry.title}</Text>
            {isLink ? <Text style={s.meta}>{entry.body}</Text> : null}
            {entry.isExample ? <Text style={s.example}>内容示例</Text> : null}
          </View>
          <View style={!isLink && expanded ? s.chevronOpen : undefined}><AppIcon name={isLink ? 'external' : 'chevron'} size={16} /></View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${saved ? '取消收藏' : '收藏'}${entry.title}`}
          accessibilityState={{ selected: saved, disabled: !bookmarks.ready }}
          disabled={!bookmarks.ready} onPress={() => bookmarks.toggle(entry.id)} style={s.iconButton}>
          <AppIcon name="saved" color={saved ? '#a14630' : muted} size={19} />
        </Pressable>
      </View>
      {expanded && !isLink ? (
        <View style={s.entryBody}>
          <Text style={s.body}>{entry.body}</Text>
          {entry.imageUrl && !imageFailed ? (
            <Image source={{ uri: entry.imageUrl }} accessibilityLabel={entry.title + '配图'} style={s.contentImage}
              resizeMode="cover" onError={() => setImageFailed(true)} />
          ) : category === 'food' ? (
            <View style={s.photoSlot}><AppIcon name="food" /><Text style={s.meta}>{imageFailed ? '配图暂时无法加载' : '店铺与餐点实拍待补充'}</Text></View>
          ) : null}
          {entry.externalUrl ? (
            <Pressable accessibilityRole="link" onPress={() => void openLink(entry.externalUrl)} style={s.smallAction}>
              <Text style={s.actionText}>{category === 'groups' ? '打开入群链接' : '查看相关链接'}</Text><AppIcon name="external" size={16} />
            </Pressable>
          ) : category === 'groups' ? <Text style={s.pending}>邀请入口待群主补充</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

export function GuideScreen({ data, bookmarks, selected, onSelect, onContribute }: {
  data: GuideData; bookmarks: Bookmarks; selected: GuideKey | null; onSelect: (key: GuideKey | null) => void; onContribute: () => void;
}) {
  const category = data.categories.find(item => item.key === selected);
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
            {category.entries.length ? category.entries.map(entry => (
              <EntryCard key={entry.id} entry={entry} category={category.key} bookmarks={bookmarks} />
            )) : <Text style={s.body}>这个分类还没有发布内容。</Text>}
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

export function SavedScreen({ data, bookmarks }: { data: GuideData; bookmarks: Bookmarks }) {
  const entries = data.categories.flatMap(category => category.entries
    .filter(entry => bookmarks.saved.includes(entry.id)).map(entry => ({ entry, category: category.key })));
  return (
    <ScrollView style={s.flex} contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={data.loading} onRefresh={() => void data.reload()} tintColor={green} />}>
      <Text accessibilityRole="header" style={s.title}>我的收藏</Text>
      <Text style={s.subtitle}>把常用的学生指南留在手边。</Text>
      <Feedback data={data} />
      {entries.map(({ entry, category }) => <EntryCard key={entry.id} entry={entry} category={category} bookmarks={bookmarks} />)}
      {!entries.length && !data.loading ? <View style={s.empty}><AppIcon name="saved" size={30} /><Text style={s.body}>还没有收藏内容。在学生指南中点书签试试。</Text></View> : null}
      <Text style={s.note}>收藏保存在当前设备。已下线的内容会从列表中隐藏。</Text>
    </ScrollView>
  );
}

export function MoreScreen({ data, onContribute }: { data: GuideData; onContribute: () => void }) {
  return (
    <ScrollView style={s.flex} contentContainerStyle={s.page}>
      <Text accessibilityRole="header" style={s.title}>更多</Text>
      <Text style={s.subtitle}>轻装出发，慢慢熟悉校园。</Text>
      <View style={s.intro}><AppIcon name="map" size={28} /><View style={s.flex}><Text style={s.introTitle}>打开就能用</Text><Text style={s.body}>地图和学生指南随时可看。</Text></View></View>
      <Text style={s.sectionTitle}>内容与维护</Text>
      <Pressable accessibilityRole="button" onPress={onContribute} style={s.settingRow}>
        <AppIcon name="groups" /><Text style={s.settingTitle}>校园共建与我的投稿</Text><AppIcon name="chevron" size={17} />
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => void data.reload()} disabled={data.loading} style={s.settingRow}>
        <AppIcon name="refresh" /><Text style={s.settingTitle}>{data.loading ? '正在更新学生指南…' : '刷新学生指南'}</Text><AppIcon name="chevron" size={17} />
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => void openLink(ADMIN_URL)} style={s.settingRow}>
        <AppIcon name="book" /><Text style={s.settingTitle}>管理员内容维护</Text><AppIcon name="external" size={17} />
      </Pressable>
      <Text style={s.note}>管理员登录后，可以编辑和发布指南内容。</Text>
      <Text style={s.sectionTitle}>关于港大漫游</Text>
      <Text style={s.body}>独立校园地图与学生指南项目。地图标点和步行指引目前为演示资料，GPS 留待后续接入。</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  page: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 26 },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 30, color: ink, fontWeight: '800', flexShrink: 1 },
  subtitle: { fontSize: 14, color: muted, lineHeight: 23, marginTop: 6, marginBottom: 20 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  topBar: { width: '100%', maxWidth: 650, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, gap: 4 },
  topTitle: { fontSize: 19, fontWeight: '800', color: ink, flex: 1 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#eaf1e8', padding: 15, borderRadius: 14, marginBottom: 20 },
  introTitle: { fontSize: 15, fontWeight: '700', color: ink, lineHeight: 23 },
  meta: { fontSize: 12, color: muted, lineHeight: 20 },
  body: { fontSize: 14, color: muted, lineHeight: 24 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { width: '47%', flexGrow: 1, minHeight: 184, padding: 16, backgroundColor: '#fff', borderRadius: 14 },
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
});
