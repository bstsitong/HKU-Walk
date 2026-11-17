import { useState } from 'react';
import { KeyboardLayout } from './KeyboardLayout';
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import { Pressable, Text, TextInput } from './ui';
import AppIcon from './AppIcon';
import { Category, Place, categories, categoryIcon, categoryLabel, classroomBuilding, classroomLocation, filterPlaces, placeIcon, placeName, places } from './campus';
import { useLanguage } from './LanguageProvider';
import { t } from './localization';
import { colors as c } from './theme';

export function PlaceRow({ place, onPress, trailing }: { place: Place; onPress: () => void; trailing?: React.ReactNode }) {
  const { language } = useLanguage();
  const building = classroomBuilding(place);
  return <View style={s.placeRow}><Pressable testID={`place-${place.id}`} accessibilityRole="button" onPress={onPress} style={s.placeMain}>
    <View style={s.placeSymbol}><AppIcon name={placeIcon(place)} size={18} color={c.muted} /></View><View style={s.flex}>
      <Text raw={place.isCommunity} style={s.rowTitle}>{placeName(place)}</Text>
      {building ? <Text raw style={s.meta}>{classroomLocation(place, building)}</Text> : <>
        {language !== 'en' && place.english ? <Text raw style={s.meta}>{place.english}</Text> : null}
        <Text style={s.meta}>{categoryLabel(place)}</Text>
      </>}
    </View>{!trailing ? <AppIcon name="chevron" size={16} color={c.muted} /> : null}</Pressable>{trailing}</View>;
}
export default function PlaceSearch({ onBack, onChoose, title, recentPlaceIds, includePlace }: {
  onBack: () => void; onChoose: (place: Place) => void; title?: string; recentPlaceIds?: readonly string[];
  includePlace?: (place: Place) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [focused, setFocused] = useState(false);
  const matches = filterPlaces(category, query, recentPlaceIds);
  const results = includePlace ? matches.filter(includePlace) : matches;
  return <KeyboardLayout><View style={s.searchHeader}>
    <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={onBack} style={s.iconButton}><AppIcon name="back" /></Pressable>
    <View style={[s.searchInput, focused && s.inputFocused]}><AppIcon name="search" size={18} color={c.muted} /><TextInput testID="place-search" accessibilityLabel={title || '搜索校园地点'} placeholder={title || '搜索名称、英文或简称'} value={query} onChangeText={setQuery} maxLength={120} returnKeyType="search" autoCorrect={false} style={s.input} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onSubmitEditing={Keyboard.dismiss} />
      {query ? <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" onPress={() => setQuery('')} style={s.iconButton}><AppIcon name="close" /></Pressable> : null}</View></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
      {title ? <Text accessibilityRole="header" style={s.sectionTitle}>{title}</Text> : null}
      {!query && category === 'all' ? <><Text style={s.sectionTitle}>常用搜索</Text><View style={s.chips}>{(includePlace ? places.filter(includePlace) : places).slice(0, 3).map(place => <Pressable accessibilityRole="button" key={place.id} onPress={() => setQuery(placeName(place))} style={s.chip}><Text style={s.chipText}>{placeName(place)}</Text></Pressable>)}</View>
        <Text style={s.sectionTitle}>按类别探索</Text><View style={s.explore}>{categories.filter(item => ['building','food','souvenir','toilet','access'].includes(item.id)).map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => setCategory(item.id)} style={s.exploreItem}><AppIcon name={categoryIcon(item.id)} size={18} color={c.muted} /><Text style={s.exploreLabel}>{item.label}</Text></Pressable>)}</View></> :
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>{categories.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: category === item.id }} onPress={() => setCategory(item.id)} style={[s.chip, category === item.id && s.selectedChip]}><Text style={[s.chipText, category === item.id && s.selectedText]}>{item.label}</Text></Pressable>)}</ScrollView>}
      <View style={s.heading}><Text accessibilityRole="header" style={s.resultsTitle}>{query || category !== 'all' ? '搜索结果' : '校园地点'}</Text><Text style={s.count}>{t('{count} 个地点', { count: results.length })}</Text></View>
      {results.map(place => <PlaceRow key={place.id} place={place} onPress={() => { Keyboard.dismiss(); onChoose(place); }} />)}
      {!results.length ? <View style={s.empty}><Text style={s.rowTitle}>没有找到相关地点</Text><Text style={s.body}>试试建筑的英文名称、简称，或者换一个关键词。</Text><Pressable accessibilityRole="button" style={s.chip} onPress={() => { setQuery(''); setCategory('all'); }}><Text style={s.selectedText}>查看全部地点</Text></Pressable></View> : null}
      <Text style={s.note}>包含内置示意地点和已审核的新地点。</Text>
    </ScrollView></KeyboardLayout>;
}
const s = StyleSheet.create({
  flex: { flex: 1 },
  page: { paddingHorizontal: 20, paddingBottom: 28, maxWidth: 650, width: '100%', alignSelf: 'center' },
  sectionTitle: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: c.ink, marginTop: 20, marginBottom: 8 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.line },
  resultsTitle: { fontSize: 20, lineHeight: 28, fontWeight: '600', color: c.ink },
  body: { fontSize: 14, color: c.muted, lineHeight: 20 },
  meta: { fontSize: 12, color: c.muted, lineHeight: 16 },
  count: { fontSize: 12, color: c.muted, lineHeight: 16, fontVariant: ['tabular-nums'] },
  rowTitle: { fontSize: 15, color: c.ink, fontWeight: '600', lineHeight: 20 },
  note: { fontSize: 12, lineHeight: 20, color: c.muted, marginTop: 16 },
  iconButton: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  searchHeader: { flexDirection: 'row', alignItems: 'center', paddingRight: 20, paddingVertical: 8, maxWidth: 650, width: '100%', alignSelf: 'center' },
  searchInput: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, paddingLeft: 12 },
  inputFocused: { borderColor: c.green },
  input: { flex: 1, minHeight: 48, paddingVertical: 8, paddingHorizontal: 8, fontSize: 15, color: c.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, justifyContent: 'center' },
  chipText: { fontSize: 13, color: c.ink, lineHeight: 20 },
  selectedChip: { backgroundColor: c.tint, borderColor: c.green },
  selectedText: { fontSize: 13, lineHeight: 20, color: c.green, fontWeight: '600' },
  explore: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line },
  exploreItem: { flexBasis: '50%', minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 },
  exploreLabel: { flexShrink: 1, color: c.ink, fontSize: 13, lineHeight: 20 },
  filters: { gap: 8 },
  placeRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: c.line },
  placeMain: { flex: 1, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  placeSymbol: { width: 40, height: 40, borderRadius: 8, backgroundColor: c.paper, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingVertical: 32, alignItems: 'flex-start', gap: 8 },
});
