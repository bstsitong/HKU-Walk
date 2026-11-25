import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BackHandler, Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import { Image, Pressable, Text, TextInput } from './ui';
import type { GuideArticle } from './guideApi';
import { API_BASE } from './guideApi';
import AppIcon from './AppIcon';
import { useLanguage } from './LanguageProvider';
import { localizedGuideArticle } from './guideLocalization';
import { t } from './localization';
import { colors as c } from './theme';
import { KeyboardLayout } from './KeyboardLayout';
import GuideMarkdown from './GuideMarkdown';
import { openLink } from './GuideScreens';
import RoutePhotoViewer from './RoutePhotoViewer';
import { cleanGuideText, foodEntries, foodRegionLabels, groupEntries, handbookEntries, matchesGuideQuery, orderedGuideSteps,
  quickLinkGroups, readerKind, tableGuideSteps, type FoodRegion, type HandbookEntry } from './guideReaderData';

type Selection = { type: 'section'; id: string } | { type: 'page'; key: string } | { type: 'food'; id: string };
const groupOrder = ['入学注册', '证件与通行', '校园生活', '入学准备'];
const julacTitles = ['完成反诈课程', '打开申请页面', '找到表格填写链接', '登录并提交', '填写表格并提交', '确认申请完成', '查看领取说明'];
const julacCopy = ['等待图书馆权限开通。', '进入 HKUL JULAC Card 页面。', '对照下方原帖截图。', '按照页面提示完成登录。', '对照申请页面填写。', '', ''];
const uriFor = (url: string) => url.startsWith('/static/guide-originals/') ? API_BASE + url : '';

function Search({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <View style={s.search}><AppIcon name="search" size={20} color={c.muted} /><TextInput testID="reader-search" accessibilityLabel={placeholder} placeholder={placeholder}
    value={value} onChangeText={onChange} autoCorrect={false} maxLength={120} returnKeyType="search" onSubmitEditing={Keyboard.dismiss} style={s.input} />
    {value ? <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" onPress={() => onChange('')} style={s.clear}><AppIcon name="close" size={16} color={c.muted} /></Pressable> : null}</View>;
}
function Row({ title, detail, onPress, external, selected, testID }: { title: string; detail?: string; onPress: () => void; external?: boolean; selected?: boolean; testID?: string }) {
  return <Pressable testID={testID} accessibilityRole={external ? 'link' : 'button'} onPress={onPress} style={({ pressed }) => [s.row, external && s.linkRow, detail && s.twoLineRow, pressed && s.pressed]}>
    <View style={s.flex}><Text raw style={[s.rowTitle, selected && s.selected]}>{title}</Text>{detail ? <Text raw style={s.rowDetail}>{detail}</Text> : null}</View>
    <AppIcon name={external ? 'external' : 'chevron'} size={18} color={selected ? c.green : c.muted} />
  </Pressable>;
}
function Filters({ items, selected, onChange }: { items: { id: string; label: string }[]; selected: string; onChange: (id: string) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters} keyboardShouldPersistTaps="handled">
    {items.map(item => <Pressable key={item.id} testID={`reader-filter-${item.id}`} accessibilityRole="radio" accessibilityState={{ checked: selected === item.id }}
      onPress={() => { Keyboard.dismiss(); onChange(item.id); }} style={[s.filter, selected === item.id && s.filterActive]}><Text style={[s.filterText, selected === item.id && s.filterWhite]}>{item.label}</Text></Pressable>)}
  </ScrollView>;
}

export default function BuiltinGuideReader({ source, initialSourcePage, onBack, footer, active = true }: {
  source: GuideArticle; initialSourcePage?: string; onBack: () => void; footer?: ReactNode; active?: boolean;
}) {
  const { language } = useLanguage();
  const article = useMemo(() => localizedGuideArticle(source, language), [source, language]);
  const kind = readerKind(source);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(kind === 'food' ? 'b1' : 'all');
  const [expanded, setExpanded] = useState<string>();
  const [stack, setStack] = useState<Selection[]>(() => initialSourcePage && source.sourcePages?.[initialSourcePage] ? [{ type: 'page', key: initialSourcePage }] : []);
  const [photo, setPhoto] = useState<{ uri: string; title: string }>();
  const selected = stack[stack.length - 1];
  const links = useMemo(() => quickLinkGroups(source, article), [source, article]);
  const sections = useMemo(() => handbookEntries(source, article), [source, article]);
  const foods = useMemo(() => foodEntries(source, article), [source, article]);
  const groups = useMemo(() => groupEntries(source, article), [source, article]);
  const go = (selection: Selection) => { Keyboard.dismiss(); setStack(current => [...current, selection]); };
  const openPage = (key: string) => { if (article.sourcePages?.[key]) go({ type: 'page', key }); };
  const directory = () => { Keyboard.dismiss(); setStack([]); };
  const back = () => { Keyboard.dismiss(); if (photo) setPhoto(undefined); else if (selected) setStack(current => current.slice(0, -1)); else onBack(); };
  useEffect(() => {
    if (!active) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => listener.remove();
  }, [active, selected, photo, onBack]);
  const openPhoto = (uri: string, title: string) => setPhoto({ uri, title: title || article.title });
  const markdown = (body: string, compact = false) => <GuideMarkdown body={body} onOpenPage={openPage} onImagePress={openPhoto} style={compact ? compactMarkdown : readerMarkdown} />;
  const openEntry = (entry: HandbookEntry) => entry.pageKey ? openPage(entry.pageKey) : go({ type: 'section', id: entry.id });
  const entryTitle = (entry: HandbookEntry) => /portal/i.test(entry.sourceTitle) ? t('HKU 系统注册') : entry.pageKey === '八校通申请' ? t('八校通申请') : ({ '办理香港身份证HKID': t('香港身份证 HKID'), '办理学生八达通': t('学生八达通'), '打印机': t('打印机使用'), 'HKU体育课': t('HKU 体育课') } as Record<string,string>)[entry.sourceTitle] ?? entry.title;
  const titleBlock = (title: string, subtitle?: string) => <View style={s.titleBlock}><Text raw accessibilityRole="header" style={s.title}>{title}</Text>{subtitle ? <Text raw style={s.subtitle}>{subtitle}</Text> : null}</View>;
  const empty = <Text style={s.empty}>没有找到相关内容</Text>;
  const image = (url: string, title: string) => <Pressable accessibilityRole="button" accessibilityLabel="查看原帖图片" onPress={() => openPhoto(uriFor(url), title)} style={s.imageFrame}>
    <Image source={{ uri: uriFor(url) }} resizeMode="contain" style={{ width: '100%', aspectRatio: Number(new URL(uriFor(url)).searchParams.get('w')) / Number(new URL(uriFor(url)).searchParams.get('h')) || 1 }} />
    <View style={s.expandIcon}><AppIcon name="expand" size={19} /></View></Pressable>;

  function pageBody(key: string) {
    const page = article.sourcePages[key];
    if (!page) return null;
    const ordered = orderedGuideSteps(page.body);
    const table = tableGuideSteps(page.body);
    if (key === '八校通申请' && ordered.steps.length) return <>
      {ordered.introduction ? markdown(ordered.introduction) : null}
      <View style={s.steps}>{ordered.steps.map((step, index) => <View key={index} testID={`guide-step-${index + 1}`} style={s.step}>
        <View style={s.number}><Text raw style={s.numberText}>{index + 1}</Text></View><View style={s.flex}>
          <Text style={s.stepTitle}>{julacTitles[index] ?? cleanGuideText(step.body)}</Text>
          {index === 0 ? markdown(step.body.replace(/^.*?[，,]\s*/, ''), true) : index === 6 ? markdown(step.body.replace(/^如步骤6图中所示，/, ''), true) : julacCopy[index] ? <Text style={s.stepBody}>{julacCopy[index]}</Text> : null}
          {index === 1 ? <Pressable accessibilityRole="link" onPress={() => void openLink('https://lib.hku.hk/cdd/ils-jla.html')} style={s.primary}><Text style={s.primaryText}>打开申请页面</Text></Pressable> : null}
          {step.images.map(item => <View key={item.url}>{image(item.url, page.title)}</View>)}
        </View></View>)}</View>
    </>;
    if (table) return <>{markdown(table.introduction)}<View style={s.steps}>{table.steps.map((step, index) => <View key={index} style={s.step}>
      <View style={s.number}><Text raw style={s.numberText}>{index + 1}</Text></View><View style={s.flex}><Text raw style={s.stepTitle}>{step.title}</Text>{markdown(step.body, true)}</View>
    </View>)}</View></>;
    return markdown(page.body);
  }
  function detail() {
    if (!selected) return null;
    if (selected.type === 'section') {
      const entry = sections.find(item => item.id === selected.id);
      return entry ? <>{titleBlock(entry.title, t('HKU 指南'))}{markdown(entry.body)}</> : null;
    }
    if (selected.type === 'page') {
      const page = article.sourcePages[selected.key];
      return page ? <>{titleBlock(page.title, kind === 'food' ? t('HKU美食分享') : [t('HKU 指南'), t(sections.find(item => item.pageKey === selected.key)?.group ?? '证件与通行')].join(' / '))}{pageBody(selected.key)}</> : null;
    }
    const food = foods.find(item => item.id === selected.id);
    if (!food) return null;
    const body = food.pageKey ? article.sourcePages[food.pageKey]?.body ?? food.body : food.body;
    const prose = body.replace(/!\[[^\]]*\]\([^\n]+\)/g, '').trim();
    const paragraphs = prose.split(/\n\s*\n/);
    return <>{titleBlock(food.title, [article.title, t(foodRegionLabels[food.region])].join(' / '))}
      {food.image ? <Pressable accessibilityRole="button" accessibilityLabel="查看原帖图片" onPress={() => openPhoto(uriFor(food.image!.url), food.title)} style={s.foodPhotoFrame}>
        <Image source={{ uri: uriFor(food.image.url) }} resizeMode="cover" style={s.foodPhoto} /><View style={s.expandIcon}><AppIcon name="expand" size={19} /></View>
      </Pressable> : null}
      {food.pageKey === 'b1口烧味家族' ? <><Text style={s.detailLabel}>位置</Text><Text raw style={s.prose}>{paragraphs.slice(1).join('\n\n').replace(/，可以.*$/, '')}</Text>
        <View style={s.divider} /><Text raw style={s.prose}>{paragraphs[0]}</Text><Text raw style={s.prose}>{paragraphs.slice(1).join('\n\n').match(/可以(.+)$/)?.[1] ?? ''}</Text></> : prose ? <>{markdown(prose)}</> : null}
    </>;
  }
  const visibleSections = sections.filter(item => matchesGuideQuery(query, item.title, item.sourceTitle, item.body, item.sourceBody, item.pageKey ?? '', item.pageKey ? article.sourcePages[item.pageKey]?.body ?? '' : ''));
  const visibleFoods = foods.filter(item => (filter === 'all' || item.region === filter) && matchesGuideQuery(query, item.title, item.sourceTitle, item.body));
  const visibleGroups = groups.filter(item => (filter === 'all' || item.group === filter) && matchesGuideQuery(query, item.title, item.sourceTitle, item.group));

  if (photo) return <RoutePhotoViewer key={photo.uri} uri={photo.uri} title={t('原帖配图')} subtitle={(kind === 'groups' ? groups.find(item => uriFor(item.image.url) === photo.uri)?.title : kind === 'food' ? foods.find(item => item.image && uriFor(item.image.url) === photo.uri)?.title : Object.values(article.sourcePages).find(page => page.body.includes(photo.uri.replace(API_BASE, '')))?.title) ?? t(photo.title)} onClose={() => setPhoto(undefined)} inline dark />;
  return <KeyboardLayout><View testID={`builtin-guide-${kind}`} style={s.flex}>
    <View style={s.topBar}><Pressable testID="article-back" accessibilityRole="button" accessibilityLabel="返回" onPress={back} style={s.back}><AppIcon name="back" size={24} color={c.ink} /></Pressable><Text style={s.barTitle}>学生指南</Text>
      {selected && kind === 'handbook' ? <Pressable testID="guide-directory" accessibilityRole="button" onPress={directory} style={s.directory}><Text style={s.directoryText}>目录</Text></Pressable> : null}
    </View>
    <ScrollView style={[s.flex, selected && s.hidden]} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      {titleBlock(article.title, kind === 'handbook' ? t('先选主题，再查看办理步骤') : kind === 'food' ? t('先选区域，再找想吃的店') : kind === 'groups' ? t('按兴趣查看同学分享的群资料') : undefined)}
      <Search value={query} onChange={setQuery} placeholder={kind === 'links' ? '搜索 Moodle、打印、图书馆' : kind === 'handbook' ? '搜索注册、八校通、打印' : kind === 'food' ? '搜索店名或餐饮类型' : '搜索运动、摄影或同城群'} />
      {kind === 'links' ? <View style={s.groups}>{links.map(group => {
        const found = group.links.filter(item => matchesGuideQuery(query, item.title, item.sourceTitle, item.alias ?? '', item.url));
        return found.length ? <View key={group.id} style={s.section}><Text raw style={s.sectionTitle}>{group.title}</Text>{found.map(item => <Row key={item.id} testID={`guide-link-${item.id}`} title={item.alias ? t(item.alias) : item.title} external onPress={() => void openLink(item.url)} />)}</View> : null;
      })}{!links.some(group => group.links.some(item => matchesGuideQuery(query, item.title, item.sourceTitle, item.alias ?? '', item.url))) ? empty : null}</View> : null}
      {kind === 'handbook' ? <View style={s.groups}>{query.trim() ? <>
        <Text style={s.resultCount}>{t('找到 {count} 个相关位置', { count: visibleSections.length })}</Text>
        {visibleSections.map(item => <Row key={item.id} testID={`guide-section-${item.id}`} title={entryTitle(item)} detail={[t('HKU 指南'), t(item.group)].join(' / ')} selected onPress={() => openEntry(item)} />)}
        {!visibleSections.length ? empty : null}
      </> : groupOrder.map(group => <View key={group} style={s.section}><Text style={s.sectionTitle}>{group}</Text>{sections.filter(item => item.group === group).sort((a,b) => Number(a.sourceTitle.includes('港深通勤')) - Number(b.sourceTitle.includes('港深通勤'))).map(item => <Row key={item.id} testID={`guide-section-${item.id}`} title={entryTitle(item)} selected={item.pageKey === '八校通申请'} onPress={() => openEntry(item)} />)}</View>)}</View> : null}
      {kind === 'food' ? <><Filters items={Object.entries(foodRegionLabels).map(([id, label]) => ({ id, label }))} selected={filter} onChange={setFilter} /><View style={s.groups}>
        {(['b1', 'b2', 'water', 'c2', 'high', 'ktown', 'belcher', 'other'] as FoodRegion[]).map(region => {
          const items = visibleFoods.filter(item => item.region === region);
          return items.length ? <View key={region} style={s.section}><Text style={s.sectionTitle}>{foodRegionLabels[region]}</Text>{items.map(item => <Row key={item.id} testID={`guide-food-${item.id}`} title={item.title} selected={item.pageKey === 'b1口烧味家族'} onPress={() => go({ type: 'food', id: item.id })} />)}</View> : null;
        })}{!visibleFoods.length ? empty : null}
      </View></> : null}
      {kind === 'groups' ? <><Filters items={['全部', '运动', '同城', '兴趣'].map((label, index) => ({ id: index ? label : 'all', label }))} selected={filter} onChange={setFilter} /><View style={s.groups}>
        {visibleGroups.map(item => <View key={item.id} style={s.groupEntry}><Pressable testID={`guide-group-${item.id}`} accessibilityRole="button" accessibilityState={{ expanded: expanded === item.id }}
          onPress={() => { Keyboard.dismiss(); setExpanded(value => value === item.id ? undefined : item.id); }} style={s.groupSummary}>
          <View style={s.flex}><Text raw style={[s.rowTitle, expanded === item.id && s.selected]}>{item.title}</Text></View>
          <View style={expanded === item.id ? s.chevronOpen : undefined}><AppIcon name="chevron" size={18} color={expanded === item.id ? c.green : c.muted} /></View></Pressable>
          {expanded === item.id ? <View style={s.groupBody}>{image(item.image.url, item.title)}</View> : null}
        </View>)}{!visibleGroups.length ? empty : null}
      </View></> : null}
      <View testID="reader-post-end" style={s.postEnd}>{footer}</View>
    </ScrollView>
    {selected ? <ScrollView key={JSON.stringify(selected)} testID="guide-reader-detail" style={s.flex} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">{detail()}<View testID="reader-post-end" style={s.postEnd}>{footer}</View></ScrollView> : null}
  </View></KeyboardLayout>;
}

const readerMarkdown = {
  body: { color: c.ink, fontSize: 16, lineHeight: 26 }, paragraph: { marginTop: 8, marginBottom: 12 },
  heading1: { color: c.ink, fontSize: 20, lineHeight: 28, fontWeight: '600' as const, marginTop: 24, marginBottom: 10 },
  heading2: { color: c.ink, fontSize: 18, lineHeight: 26, fontWeight: '600' as const, marginTop: 22, marginBottom: 8 },
  heading3: { color: c.ink, fontSize: 16, lineHeight: 24, fontWeight: '600' as const, marginTop: 20, marginBottom: 8 },
};
const compactMarkdown = { ...readerMarkdown, body: { color: c.muted, fontSize: 14, lineHeight: 22 }, paragraph: { marginTop: 6, marginBottom: 0 } };
const s = StyleSheet.create({
  flex: { flex: 1 }, hidden: { display: 'none' }, topBar: { width: '100%', maxWidth: 650, alignSelf: 'center', minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  back: { width: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' }, barTitle: { flex: 1, fontSize: 17, lineHeight: 24, color: c.ink, fontWeight: '600' },
  directory: { paddingHorizontal: 14, minHeight: 48, justifyContent: 'center' }, directoryText: { color: c.green, fontSize: 13, lineHeight: 20 },
  page: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingHorizontal: 18, paddingBottom: 24 }, titleBlock: { paddingTop: 20 },
  title: { fontSize: 25, lineHeight: 32, color: c.ink, fontWeight: '600' }, subtitle: { fontSize: 13, lineHeight: 20, color: c.muted, marginTop: 8 },
  search: { flexDirection: 'row', alignItems: 'center', minHeight: 46, marginTop: 22, paddingLeft: 12, borderWidth: 1, borderColor: c.line, borderRadius: 9, backgroundColor: c.surface },
  input: { flex: 1, color: c.ink, fontSize: 15, minHeight: 46, paddingVertical: 10, paddingHorizontal: 10 }, clear: { minWidth: 40, minHeight: 46, justifyContent: 'center', alignItems: 'center' },
  groups: { paddingTop: 24 }, section: { marginBottom: 26 }, sectionTitle: { color: c.muted, fontSize: 14, lineHeight: 21, fontWeight: '600', marginBottom: 8 },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 10, paddingHorizontal: 2 },
  linkRow: { minHeight: 64 }, twoLineRow: { minHeight: 76 }, rowTitle: { color: c.ink, fontSize: 16, lineHeight: 24 }, rowDetail: { color: c.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  selected: { color: c.green, fontWeight: '600' }, pressed: { backgroundColor: c.tint }, empty: { color: c.muted, fontSize: 14, lineHeight: 22, paddingVertical: 20 },
  filters: { gap: 7, paddingTop: 18, paddingBottom: 2, paddingRight: 4 }, filter: { minHeight: 32, paddingHorizontal: 13, paddingVertical: 6, borderWidth: 1, borderColor: c.line, borderRadius: 16, justifyContent: 'center' },
  filterActive: { borderColor: c.green, backgroundColor: c.green }, filterText: { fontSize: 13, lineHeight: 19, color: c.muted }, filterWhite: { color: c.surface },
  resultCount: { fontSize: 13, lineHeight: 20, color: c.muted, marginBottom: 12 }, groupEntry: { borderBottomWidth: 1, borderBottomColor: c.line }, groupSummary: { minHeight: 52, paddingHorizontal: 2, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  chevronOpen: { transform: [{ rotate: '-90deg' }] }, groupBody: { paddingBottom: 18 }, imageFrame: { marginTop: 16, padding: 12, borderRadius: 8, backgroundColor: c.surface, overflow: 'hidden', borderWidth: 1, borderColor: c.line },
  expandIcon: { position: 'absolute', bottom: 8, right: 8, backgroundColor: c.surface, padding: 2, borderRadius: 3 },
  foodPhotoFrame: { marginTop: 26, borderRadius: 9, overflow: 'hidden' }, foodPhoto: { width: '100%', aspectRatio: 354 / 251 },
  detailLabel: { color: c.muted, fontSize: 14, lineHeight: 21, fontWeight: '600', marginTop: 26, marginBottom: 10 }, prose: { color: c.ink, fontSize: 16, lineHeight: 26 }, divider: { height: 1, backgroundColor: c.line, marginTop: 24, marginBottom: 24 },
  steps: { paddingTop: 28 }, step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 22 }, number: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.tint, justifyContent: 'center', alignItems: 'center', marginTop: 1 },
  numberText: { color: c.green, fontSize: 13, lineHeight: 20, fontWeight: '600' }, stepTitle: { color: c.ink, fontSize: 16, lineHeight: 24, fontWeight: '600' }, stepBody: { color: c.muted, fontSize: 14, lineHeight: 22, marginTop: 8 },
  primary: { backgroundColor: c.green, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, minHeight: 42, borderRadius: 8, marginTop: 12, justifyContent: 'center' }, primaryText: { color: c.surface, fontSize: 14, lineHeight: 21, fontWeight: '600' },
  postEnd: { marginTop: 30 },
});
