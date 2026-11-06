import { useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import { Pressable, Text, TextInput } from './ui';
import AppIcon from './AppIcon';
import { Category, Place, categories, categoryIcon, categoryLabel, filterPlaces, placeIcon, placeName, places } from './campus';
import { useLanguage } from './LanguageProvider';
import { t } from './localization';
import { colors as c } from './theme';

export function PlaceRow({ place, onPress, trailing }: { place: Place; onPress: () => void; trailing?: React.ReactNode }) {
  const { language } = useLanguage();
  return <View style={s.placeRow}><Pressable testID={`place-${place.id}`} accessibilityRole="button" onPress={onPress} style={s.placeMain}>
    <View style={s.placeSymbol}><AppIcon name={placeIcon(place)} /></View><View style={s.flex}>
      <Text raw={place.isCommunity} style={s.rowTitle}>{placeName(place)}</Text>
      <Text raw style={s.meta}>{language === 'en' && !place.isCommunity ? place.name : place.english}</Text><Text style={s.meta}>{categoryLabel(place.category)}</Text>
    </View>{!trailing ? <AppIcon name="chevron" size={17} color={c.muted} /> : null}</Pressable>{trailing}</View>;
}
export default function PlaceSearch({ onBack, onChoose, title, recentPlaceIds }: {
  onBack: () => void; onChoose: (place: Place) => void; title?: string; recentPlaceIds?: readonly string[];
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const results = filterPlaces(category, query, recentPlaceIds);
  return <View style={s.flex}><View style={s.searchHeader}>
    <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={onBack} style={s.iconButton}><AppIcon name="back" /></Pressable>
    <View style={s.searchInput}><AppIcon name="search" size={18} color={c.muted} /><TextInput testID="place-search" accessibilityLabel={title || '搜索校园地点'} placeholder={title || '搜索名称、英文或简称'} value={query} onChangeText={setQuery} maxLength={120} returnKeyType="search" autoCorrect={false} style={s.input} onSubmitEditing={Keyboard.dismiss} />
      {query ? <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" onPress={() => setQuery('')} style={s.iconButton}><AppIcon name="close" /></Pressable> : null}</View></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
      {title ? <Text accessibilityRole="header" style={s.sectionTitle}>{title}</Text> : null}
      {!query && category === 'all' ? <><Text style={s.sectionTitle}>常用搜索</Text><View style={s.chips}>{places.slice(0, 3).map(place => <Pressable accessibilityRole="button" key={place.id} onPress={() => setQuery(place.name)} style={s.chip}><Text style={s.chipText}>{placeName(place)}</Text></Pressable>)}</View>
        <Text style={s.sectionTitle}>按类别探索</Text><View style={s.explore}>{categories.filter(item => ['building','food','toilet','access'].includes(item.id)).map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => setCategory(item.id)} style={s.exploreItem}><View style={s.exploreIcon}><AppIcon name={categoryIcon(item.id)} /></View><Text style={s.meta}>{item.label}</Text></Pressable>)}</View></> :
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filters}>{categories.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: category === item.id }} onPress={() => setCategory(item.id)} style={[s.chip, category === item.id && s.selectedChip]}><Text style={[s.chipText, category === item.id && s.white]}>{item.label}</Text></Pressable>)}</ScrollView>}
      <View style={s.heading}><Text style={s.sectionTitle}>{query || category !== 'all' ? '搜索结果' : '校园地点'}</Text><Text style={s.meta}>{t('{count} 个地点', { count: results.length })}</Text></View>
      {results.map(place => <PlaceRow key={place.id} place={place} onPress={() => { Keyboard.dismiss(); onChoose(place); }} />)}
      {!results.length ? <View style={s.empty}><AppIcon name="search" size={32} /><Text style={s.rowTitle}>没有找到相关地点</Text><Text style={s.body}>试试建筑的英文名称、简称，或者换一个关键词。</Text><Pressable accessibilityRole="button" style={s.chip} onPress={() => { setQuery(''); setCategory('all'); }}><Text>查看全部地点</Text></Pressable></View> : null}
      <Text style={s.note}>包含内置示意地点和已审核的新地点。</Text>
    </ScrollView></View>;
}
const s = StyleSheet.create({
  flex: { flex: 1 }, white: { color: '#fff' }, page: { padding: 18, paddingTop: 8, paddingBottom: 28, maxWidth: 650, width: '100%', alignSelf: 'center' },
  sectionTitle: { fontSize: 14, lineHeight: 22, fontWeight: '700', color: c.ink, marginVertical: 12 }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  body: { fontSize: 13, color: c.muted, lineHeight: 22 }, meta: { fontSize: 11, color: c.muted, lineHeight: 18 }, rowTitle: { fontSize: 14, color: c.ink, fontWeight: '700', lineHeight: 22 }, note: { fontSize: 11, lineHeight: 20, color: c.muted, marginTop: 18 },
  iconButton: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }, searchHeader: { flexDirection: 'row', alignItems: 'center', paddingRight: 18, paddingVertical: 8 }, searchInput: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: c.tint, borderRadius: 10, paddingLeft: 12 }, input: { flex: 1, minHeight: 48, paddingVertical: 10, paddingHorizontal: 9, fontSize: 14, color: c.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 44, paddingHorizontal: 11, paddingVertical: 12, borderRadius: 8, backgroundColor: c.tint, marginRight: 6, justifyContent: 'center' }, chipText: { fontSize: 11, color: c.ink, lineHeight: 18 }, selectedChip: { backgroundColor: c.green },
  explore: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 12 }, exploreItem: { alignItems: 'center', gap: 8, padding: 5, minWidth: 60 }, exploreIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }, filters: { marginVertical: 8 },
  placeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: c.line }, placeMain: { flex: 1, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }, placeSymbol: { width: 43, height: 48, borderRadius: 10, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }, empty: { paddingVertical: 38, alignItems: 'center', gap: 14 },
});
