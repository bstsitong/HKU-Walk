import { useEffect, useState } from 'react';
import {
  BackHandler, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { filterPlaces, places, routeSteps } from './campus';
import StepIllustration from './StepIllustration';

type Place = (typeof places)[number];
type Endpoint = 'start' | 'end';
type Endpoints = Record<Endpoint, Place | null>;

const green = '#184d3e';
const ink = '#203a31';
const muted = '#526258';
const rust = '#a14630';
const tint = '#eaf1e8';
const line = '#dbe3d9';
const paper = '#f7f8f3';
const mapImage = require('./assets/hku-campus-map.png');
const crop = { left: 146, top: 352, width: 560, height: 222 };

// The points are approximate image anchors, measured on the source PDF.
const anchors = [
  { id: 'gate', x: 573, y: 541 },
  { id: 'chiwah', x: 534, y: 440 },
  { id: 'garden', x: 623, y: 383 },
  { id: 'knowles', x: 215, y: 407 },
  { id: 'library', x: 279, y: 434 },
  { id: 'main', x: 275, y: 493 },
];
const mapPlaces = anchors.flatMap((anchor, index) => {
  const place = places.find(item => item.id === anchor.id);
  return place ? [{ ...anchor, place, number: index + 1 }] : [];
});
const fieldLabels = { start: '起点', end: '终点' };

function Arrow({ back = false, color = green }: { back?: boolean; color?: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}>
      <Path d={back ? 'm14 6-6 6 6 6' : 'M4 12h15m-6-6 6 6-6 6'} fill="none" stroke={color}
        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function Badge({ role }: { role: Endpoint }) {
  return (
    <View style={[s.badge, role === 'end' && s.badgeEnd]}>
      <Text style={s.badgeText}>{role === 'start' ? 'A' : 'B'}</Text>
    </View>
  );
}

function WalkingSteps({ start, end, onBack }: { start: Place; end: Place; onBack: () => void }) {
  return (
    <>
      <View style={s.routeHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回校园地图" onPress={onBack} style={s.back}>
          <Arrow back />
        </Pressable>
        <Text accessibilityRole="header" style={s.routeTitle}>步行路线演示</Text>
      </View>
      <ScrollView style={s.flex} contentContainerStyle={s.page}>
        <View style={s.summary}>
          <View style={s.summaryRow}><Badge role="start" /><Text style={s.name}>{start.name}</Text></View>
          <View style={s.divider} />
          <View style={s.summaryRow}><Badge role="end" /><Text style={s.name}>{end.name}</Text></View>
        </View>
        <View style={s.notice}>
          <Text style={s.noticeTitle}>演示路线 · 仅供体验</Text>
          <Text style={s.noticeCopy}>步骤与插图均为示例，请勿按此路线实际导航。</Text>
        </View>
        <View style={s.sectionHeader}>
          <Text accessibilityRole="header" style={s.sectionTitle}>图文指引</Text>
          <Text style={s.caption}>共 {routeSteps.length} 步</Text>
        </View>
        {routeSteps.map((step, index) => {
          let title: string = step.title;
          if (index === 0) title = `从${start.name}出发`;
          if (index === 4) title = '辨认目的地入口';
          if (index === routeSteps.length - 1) title = `到达${end.name}`;
          return (
            <View key={step.icon + index} style={s.step} testID={`route-step-${index + 1}`}>
              <View style={s.stepNumber}><Text style={s.stepNumberText}>{index + 1}</Text></View>
              <View style={s.stepText}>
                <Text accessibilityRole="header" style={s.stepTitle}>{title}</Text>
                <Text style={s.stepCopy}>{step.copy}</Text>
              </View>
              <View accessible accessibilityRole="image" accessibilityLabel={`${step.photo}，示意配图`} style={s.illustration}>
                <StepIllustration step={index} />
                <Text style={s.artCaption}>示意配图</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </>
  );
}

export default function CampusMap({ active: visible }: { active: boolean }) {
  const { width } = useWindowDimensions();
  const [selected, setSelected] = useState<Endpoints>({ start: null, end: null });
  const [draft, setDraft] = useState({ start: '', end: '' });
  const [active, setActive] = useState<Endpoint>('start');
  const [editing, setEditing] = useState<Endpoint | null>(null);
  const [message, setMessage] = useState('');
  const [showRoute, setShowRoute] = useState(false);
  const ready = Boolean(selected.start && selected.end);
  const scale = Math.max(440, Math.min(width, 650) - 36) / crop.width;
  const results = editing && draft[editing].trim()
    ? filterPlaces('all', draft[editing]).filter(place => mapPlaces.some(item => item.id === place.id))
    : [];

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!visible || !showRoute) return false;
      setShowRoute(false);
      return true;
    });
    return () => handler.remove();
  }, [showRoute, visible]);

  function edit(endpoint: Endpoint, text: string) {
    setActive(endpoint);
    setEditing(endpoint);
    setSelected(previous => ({ ...previous, [endpoint]: null }));
    setDraft(previous => ({ ...previous, [endpoint]: text }));
    setMessage('');
  }

  function choose(place: Place, endpoint: Endpoint = active) {
    const other = endpoint === 'start' ? selected.end : selected.start;
    if (other?.id === place.id) {
      setMessage('起点和终点请选择不同地点。');
      return;
    }
    setSelected(previous => ({ ...previous, [endpoint]: place }));
    setDraft(previous => ({ ...previous, [endpoint]: place.name }));
    setEditing(null);
    setMessage('');
    if (endpoint === 'start' && !selected.end) setActive('end');
    Keyboard.dismiss();
  }

  function roleOf(place: Place): Endpoint | null {
    if (selected.start?.id === place.id) return 'start';
    if (selected.end?.id === place.id) return 'end';
    return null;
  }

  if (showRoute && selected.start && selected.end) {
    return <WalkingSteps start={selected.start} end={selected.end} onBack={() => setShowRoute(false)} />;
  }

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={s.flex} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={s.titleRow}>
          <Text accessibilityRole="header" style={s.title}>港大漫游</Text>
          <Text style={s.tag}>地图演示</Text>
        </View>
        <Text style={s.subtitle}>输入地点名称，或在地图上点选起点和终点。</Text>
        <View style={s.fields}>
          {(['start', 'end'] as const).map(endpoint => (
            <View key={endpoint}>
              <View style={[s.field, active === endpoint && s.fieldActive]}>
                <Badge role={endpoint} />
                <TextInput
                  accessibilityLabel={`搜索${fieldLabels[endpoint]}`}
                  testID={`search-${endpoint}`}
                  value={draft[endpoint]}
                  placeholder={`搜索${fieldLabels[endpoint]}`}
                  placeholderTextColor={muted}
                  selectTextOnFocus
                  returnKeyType="search"
                  autoCorrect={false}
                  style={s.input}
                  onFocus={() => { setActive(endpoint); setEditing(endpoint); setMessage(''); }}
                  onChangeText={text => edit(endpoint, text)}
                  onSubmitEditing={() => { if (results.length === 1) choose(results[0], endpoint); }}
                />
                {draft[endpoint] ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`清除${fieldLabels[endpoint]}`} onPress={() => edit(endpoint, '')} style={s.clear}>
                    <Text style={s.clearText}>清除</Text>
                  </Pressable>
                ) : null}
              </View>
              {editing === endpoint && draft[endpoint].trim() && !selected[endpoint] ? (
                <View style={s.results}>
                  {results.length ? results.map(place => (
                    <Pressable key={place.id} accessibilityRole="button" testID={`result-${endpoint}-${place.id}`}
                      onPress={() => choose(place, endpoint)} style={({ pressed }) => [s.result, pressed && s.pressed]}>
                      <View style={s.flex}><Text style={s.name}>{place.name}</Text><Text style={s.caption}>{place.english}</Text></View>
                      <Arrow />
                    </Pressable>
                  )) : <Text style={s.noResults}>没找到这个地点，试试中文、英文或简称。</Text>}
                </View>
              ) : null}
            </View>
          ))}
        </View>
        <View style={s.sectionHeader}>
          <Text accessibilityRole="header" style={s.sectionTitle}>校园地图</Text>
          <Text style={s.activeLabel}>正在选{fieldLabels[active]}</Text>
        </View>
        <View style={s.mapFrame}>
          <ScrollView horizontal style={{ height: crop.height * scale }} keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false} accessibilityLabel="港大校园地图，左右拖动查看">
            <View style={{ width: crop.width * scale, height: crop.height * scale }}>
              <Image source={mapImage} style={s.mapImage} resizeMode="stretch" accessible={false} />
              {mapPlaces.map(item => {
                const role = roleOf(item.place);
                const left = (item.x - crop.left) * scale - 24;
                const top = (item.y - crop.top) * scale - 24;
                return (
                  <Pressable key={item.id} testID={`pin-${item.id}`} accessibilityRole="button"
                    accessibilityLabel={`地图标点，${item.place.name}${role ? `，已选为${fieldLabels[role]}` : ''}`}
                    onPress={() => choose(item.place)} style={[s.pinTarget, { left, top }, role && s.pinOnTop]}>
                    <View style={[s.pin, role === 'start' && s.pinStart, role === 'end' && s.pinEnd]}>
                      <Text style={[s.pinText, role && s.badgeText]}>{role ? (role === 'start' ? 'A' : 'B') : item.number}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          <View style={s.mapCaption}>
            <Text style={s.caption}>左右拖动 · 点标记选地点</Text>
            <Text style={s.caption}>标点仅供演示</Text>
          </View>
        </View>
        <Text style={s.credit}>底图：香港大学 Estates Office · 本部及百周年校园局部</Text>
        <Text accessibilityRole="header" style={s.listTitle}>可选地点</Text>
        <View style={s.placeGrid}>
          {mapPlaces.map(item => {
            const role = roleOf(item.place);
            return (
              <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`选择${item.place.name}`}
                testID={`place-${item.id}`} onPress={() => choose(item.place)}
                style={({ pressed }) => [s.placeButton, pressed && s.pressed]}>
                {role ? <Badge role={role} /> : <Text style={s.placeNumber}>{item.number}</Text>}
                <Text style={s.placeName}>{item.place.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={s.footer}>
        <Text accessibilityLiveRegion="polite" style={[s.hint, message ? s.error : undefined]}>
          {message || (ready ? '路线仅供演示，包含 6 个图文步骤。' : '选好两个地点后，即可预览步行步骤。')}
        </Text>
        <Pressable testID="open-route" accessibilityRole="button" accessibilityState={{ disabled: !ready }}
          disabled={!ready} onPress={() => { Keyboard.dismiss(); setShowRoute(true); }}
          style={({ pressed }) => [s.action, !ready && s.actionDisabled, pressed && s.actionPressed]}>
          <Text style={[s.actionText, !ready && s.actionTextDisabled]}>查看步行示例</Text>
          <Arrow color={ready ? '#fff' : muted} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: paper },
  flex: { flex: 1 },
  page: { alignSelf: 'center', width: '100%', maxWidth: 650, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 32, fontWeight: '800', color: ink, letterSpacing: -0.5, flexShrink: 1 },
  tag: { fontSize: 12, fontWeight: '700', color: green, backgroundColor: tint, paddingVertical: 5, paddingHorizontal: 9, borderRadius: 7 },
  subtitle: { color: muted, fontSize: 14, lineHeight: 22, marginTop: 5, marginBottom: 16 },
  fields: { gap: 8, marginBottom: 17 },
  field: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: line, flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingLeft: 11, gap: 9 },
  fieldActive: { borderColor: green, backgroundColor: '#f8fcf7' },
  badge: { minWidth: 24, minHeight: 24, borderRadius: 7, backgroundColor: green, justifyContent: 'center', alignItems: 'center', padding: 3 },
  badgeEnd: { backgroundColor: rust },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  input: { flex: 1, minHeight: 50, fontSize: 15, color: ink, paddingVertical: 7, paddingRight: 8 },
  clear: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  clearText: { color: green, fontSize: 12, fontWeight: '600' },
  results: { backgroundColor: '#fff', borderWidth: 1, borderColor: line, borderRadius: 12, marginTop: 5, overflow: 'hidden' },
  result: { minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 12 },
  pressed: { backgroundColor: tint },
  name: { fontSize: 15, fontWeight: '700', color: ink },
  noResults: { fontSize: 13, color: muted, padding: 12 },
  sectionHeader: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 9 },
  sectionTitle: { color: ink, fontSize: 18, fontWeight: '800' },
  activeLabel: { color: green, fontSize: 12, fontWeight: '700' },
  mapFrame: { borderRadius: 14, borderWidth: 1, borderColor: line, overflow: 'hidden', backgroundColor: '#e3e5d1' },
  mapImage: { width: '100%', height: '100%' },
  pinTarget: { position: 'absolute', width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  pinOnTop: { zIndex: 1 },
  pin: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', borderColor: green, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  pinStart: { backgroundColor: green, borderColor: '#fff' },
  pinEnd: { backgroundColor: rust, borderColor: '#fff' },
  pinText: { color: green, fontSize: 12, fontWeight: '800' },
  mapCaption: { backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 8, gap: 4, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  caption: { color: muted, fontSize: 12, lineHeight: 18 },
  credit: { fontSize: 11, color: muted, marginTop: 7 },
  listTitle: { fontSize: 14, color: ink, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  placeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  placeButton: { width: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, minHeight: 48, borderRadius: 10, backgroundColor: '#fff' },
  placeNumber: { minWidth: 24, textAlign: 'center', color: green, fontSize: 12, fontWeight: '800' },
  placeName: { color: ink, fontSize: 13, fontWeight: '600', flex: 1 },
  footer: { alignSelf: 'center', width: '100%', maxWidth: 650, paddingHorizontal: 18, paddingTop: 9, paddingBottom: 8, borderTopWidth: 1, borderTopColor: line, backgroundColor: paper },
  hint: { textAlign: 'center', color: muted, fontSize: 12, lineHeight: 18, marginBottom: 7 },
  error: { color: rust },
  action: { minHeight: 51, padding: 9, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 9, borderRadius: 13, backgroundColor: green },
  actionDisabled: { backgroundColor: '#e6ece2' },
  actionPressed: { backgroundColor: '#103b2f' },
  actionText: { color: '#fff', fontWeight: '800', fontSize: 15, flexShrink: 1 },
  actionTextDisabled: { color: muted },
  routeHeader: { alignSelf: 'center', width: '100%', maxWidth: 650, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 5, minHeight: 54 },
  back: { width: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  routeTitle: { color: ink, fontSize: 21, fontWeight: '800', flexShrink: 1 },
  summary: { borderColor: line, borderWidth: 1, borderRadius: 14, backgroundColor: '#fff', paddingHorizontal: 13 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingVertical: 8, gap: 10 },
  divider: { height: 1, backgroundColor: line },
  notice: { backgroundColor: '#f4e9df', padding: 12, borderRadius: 12, gap: 3, marginTop: 11, marginBottom: 18 },
  noticeTitle: { color: '#773f30', fontSize: 13, fontWeight: '800' },
  noticeCopy: { color: '#714b3e', fontSize: 12, lineHeight: 18 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 12, borderTopWidth: 1, borderTopColor: line, minHeight: 105 },
  stepNumber: { width: 25, minHeight: 25, borderRadius: 7, justifyContent: 'center', alignItems: 'center', backgroundColor: tint },
  stepNumberText: { color: green, fontSize: 12, fontWeight: '800' },
  stepText: { flex: 1, paddingTop: 2, gap: 5 },
  stepTitle: { color: ink, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  stepCopy: { color: muted, fontSize: 13, lineHeight: 20 },
  illustration: { width: 88, paddingBottom: 6, backgroundColor: tint, borderRadius: 11, alignItems: 'center', flexShrink: 0 },
  artCaption: { fontSize: 11, color: green, textAlign: 'center' },
});
