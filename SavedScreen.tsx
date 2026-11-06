import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Pressable, Text } from './ui';
import AppIcon from './AppIcon';
import { getCampusRoute, getPlace, Place, placeName } from './campus';
import { PlaceRow } from './PlaceSearch';
import { PlaceRecords } from './usePlaces';
import { RouteRecords } from './useSavedRoutes';
import { RouteBookmark } from './routeBookmarks';
import { EntryCard } from './GuideScreens';
import { GuideEntry } from './guideApi';
import useGuide from './useGuide';
import useCampus from './useCampus';
import { colors as c } from './theme';
type Bookmarks = { saved: string[]; ready: boolean; toggle: (id: string) => void };
export default function SavedScreen({ data, campus, bookmarks, records, routes, onOpenPlace, onOpenRoute, onOpenContent }: {
  data: ReturnType<typeof useGuide>; campus: ReturnType<typeof useCampus>; bookmarks: Bookmarks; records: PlaceRecords; routes: RouteRecords;
  onOpenPlace: (place: Place) => void; onOpenRoute: (route: RouteBookmark) => void; onOpenContent: (entry: GuideEntry) => void;
}) {
  const [section, setSection] = useState<'posts' | 'routes' | 'places'>('posts');
  const [recent, setRecent] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const entries = data.categories.flatMap(category => category.entries.filter(entry => bookmarks.saved.includes(entry.id)).map(entry => ({ entry, category: category.key })));
  const counts = { posts: bookmarks.saved.length, routes: routes.saved.length, places: records.saved.length };
  const ids = recent ? records.recent : records.saved;
  const savePlaceButton = (id: string) => <Pressable accessibilityRole="button" accessibilityLabel={records.saved.includes(id) ? '取消收藏' : '收藏地点'} disabled={!records.ready} onPress={() => records.toggle(id)} style={s.iconButton}><AppIcon name="bookmark" size={20} color={records.saved.includes(id) ? c.green : c.muted} /></Pressable>;
  return <ScrollView style={s.flex} contentContainerStyle={s.page} refreshControl={<RefreshControl refreshing={data.loading || campus.loading} onRefresh={() => { void data.reload(); void campus.reload(); }} tintColor={c.green} />}>
    <Text accessibilityRole="header" style={s.title}>我的收藏</Text><Text style={s.subtitle}>帖子、路线和地点，分开收好，随时找到。</Text>
    <View accessibilityRole="tablist" style={s.tabs}>{(['posts','routes','places'] as const).map(key => <Pressable testID={`saved-tab-${key}`} key={key} accessibilityRole="tab" accessibilityState={{ selected: section === key }} onPress={() => setSection(key)} style={[s.tab, section === key && s.tabActive]}><Text style={[s.tabText, section === key && s.active]}>{key === 'posts' ? '帖子' : key === 'routes' ? '路线' : '地点'} {counts[key]}</Text></Pressable>)}</View>
    {section === 'posts' ? <>
      {data.error ? <Text style={s.notice}>{data.error}</Text> : null}
      {entries.map(({ entry, category }, index) => <EntryCard key={entry.id} entry={entry} category={category} bookmarks={bookmarks} first={index === 0} onOpenContent={onOpenContent} />)}
      {!entries.length ? <View style={s.empty}><AppIcon name="book" size={30} /><Text style={s.body}>还没有收藏帖子。在指南帖子旁点书签即可收藏。</Text></View> : null}
      {bookmarks.saved.filter(id => !entries.some(item => item.entry.id === id)).map(id => <View key={id} style={s.unavailable}><Text style={[s.body,s.flex]}>帖子已下线或暂时无法读取</Text><Pressable accessibilityRole="button" accessibilityLabel="取消收藏" disabled={!bookmarks.ready} onPress={() => bookmarks.toggle(id)} style={s.iconButton}><AppIcon name="bookmark" /></Pressable></View>)}
    </> : section === 'routes' ? <>
      {campus.error ? <Text style={s.notice}>{campus.error}</Text> : null}
      {routes.saved.map(route => {
        const shared = route.source === 'community' ? getCampusRoute(route.id) : undefined;
        const origin = getPlace(shared?.originId || route.originId), destination = getPlace(shared?.destinationId || route.destinationId);
        const available = Boolean(origin && destination && (route.source === 'demo' || shared));
        return <View key={route.id} style={s.routeRow}><Pressable testID={`saved-route-${route.id}`} disabled={!available} accessibilityRole="button" onPress={() => onOpenRoute(route)} style={s.routeMain}><View style={s.symbol}><AppIcon name="walk" /></View><View style={s.flex}>
          {shared ? <Text raw style={s.rowTitle}>{shared.title}</Text> : <Text raw style={s.rowTitle}>{origin && destination ? `${placeName(origin)} → ${placeName(destination)}` : ''}</Text>}
          <Text style={s.meta}>{!available ? '路线已下线或暂时无法读取' : route.source === 'demo' ? '演示路线' : '同学分享的路线'}</Text>
          {shared && origin && destination ? <Text raw style={s.meta}>{placeName(origin)} → {placeName(destination)}</Text> : null}
        </View>{available ? <AppIcon name="chevron" size={17} /> : null}</Pressable><Pressable accessibilityRole="button" accessibilityLabel="取消收藏路线" disabled={!routes.ready} onPress={() => routes.toggle(route)} style={s.iconButton}><AppIcon name="bookmark" /></Pressable></View>;
      })}
      {!routes.saved.length ? <View style={s.empty}><AppIcon name="walk" size={30} /><Text style={s.body}>还没有收藏路线。打开步行路线后，点右上角书签。</Text></View> : null}
    </> : <>
      <View style={s.subTabs}>{[false,true].map(value => <Pressable key={String(value)} accessibilityRole="button" accessibilityState={{ selected: recent === value }} onPress={() => { setRecent(value); setConfirm(false); }} style={[s.subTab, recent === value && s.subActive]}><Text style={s.meta}>{value ? '最近浏览' : '收藏地点'}</Text></Pressable>)}</View>
      {ids.map(id => { const place = getPlace(id); return place ? <PlaceRow key={id} place={place} onPress={() => onOpenPlace(place)} trailing={savePlaceButton(id)} /> : <View key={id} style={s.unavailable}><Text style={[s.body,s.flex]}>地点已下线或暂时无法读取</Text>{savePlaceButton(id)}</View>; })}
      {!ids.length ? <View style={s.empty}><AppIcon name={recent ? 'history' : 'pin'} size={30} /><Text style={s.body}>{recent ? '还没有浏览记录。打开地点详情后会出现在这里。' : '还没有收藏地点。在地点旁点书签试试。'}</Text></View> : null}
      {recent && records.recent.length ? confirm ? <View style={s.confirm}><Text style={s.body}>清空这台设备的浏览记录？</Text><Pressable accessibilityRole="button" onPress={() => { records.clearRecent(); setConfirm(false); }} style={s.subTab}><Text style={s.active}>确认清空</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setConfirm(false)} style={s.subTab}><Text style={s.active}>取消</Text></Pressable></View> : <Pressable accessibilityRole="button" onPress={() => setConfirm(true)} style={s.clear}><AppIcon name="trash" size={17} /><Text style={s.active}>清空浏览记录</Text></Pressable> : null}
    </>}
    <View style={s.local}><AppIcon name="shield" size={16} /><Text style={[s.meta,s.flex]}>收藏保存在当前设备，浏览和收藏无需登录。</Text></View>
  </ScrollView>;
}
const s = StyleSheet.create({ flex: { flex: 1 }, page: { width: '100%', maxWidth: 650, alignSelf: 'center', padding: 20, paddingBottom: 30 }, title: { fontSize: 25, lineHeight: 34, color: c.ink, fontWeight: '800' }, subtitle: { fontSize: 13, lineHeight: 22, color: c.muted, marginTop: 6, marginBottom: 16 }, tabs: { flexDirection: 'row', gap: 22, borderBottomWidth: 1, borderBottomColor: c.line, marginBottom: 18 }, tab: { minHeight: 48, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' }, tabActive: { borderBottomColor: c.green }, tabText: { fontSize: 14, color: c.muted, lineHeight: 22 }, active: { color: c.green, fontSize: 13, fontWeight: '700' }, body: { fontSize: 13, lineHeight: 23, color: c.muted }, meta: { fontSize: 11, lineHeight: 19, color: c.muted }, rowTitle: { fontSize: 14, lineHeight: 23, color: c.ink, fontWeight: '700' }, iconButton: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }, empty: { alignItems: 'center', gap: 15, paddingVertical: 36 }, local: { flexDirection: 'row', gap: 8, marginTop: 24, paddingTop: 18, borderTopWidth: 1, borderTopColor: c.line }, routeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: c.line }, routeMain: { flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 16 }, symbol: { width: 43, height: 48, borderRadius: 10, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }, subTabs: { flexDirection: 'row', gap: 8, marginBottom: 14 }, subTab: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, backgroundColor: c.paper }, subActive: { backgroundColor: c.tint }, unavailable: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: c.paper, borderRadius: 10, marginBottom: 10 }, notice: { fontSize: 12, lineHeight: 21, color: c.rust, padding: 12, backgroundColor: c.rustLight, marginBottom: 12, borderRadius: 10 }, clear: { flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 48, marginTop: 10 }, confirm: { marginTop: 16, gap: 8 } });
