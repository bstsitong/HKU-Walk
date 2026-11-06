import { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert, Image, Pressable, Text } from './ui';
import AppIcon from './AppIcon';
import PlaceSearch from './PlaceSearch';
import MapCanvas from './MapCanvas';
import StepIllustration from './StepIllustration';
import { campusRoutes, getCampusRoute, getPlace, Place, placeName, routeSteps } from './campus';
import { RouteRecords } from './useSavedRoutes';
import { demoRouteId, RouteBookmark } from './routeBookmarks';
import { t } from './localization';
import { useLanguage } from './LanguageProvider';
import { colors as c } from './theme';

function StepPhoto({ uri, index, label }: { uri?: string; index: number; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return <View style={s.stepPhoto}>{uri && !failed ? <Image source={{ uri }} accessibilityLabel={t('路线第 {step} 步配图', { step: index + 1 })} style={s.realPhoto} resizeMode="cover" onError={() => setFailed(true)} /> : <StepIllustration step={Math.min(index, 5)} />}<Text style={s.photoLabel}>{uri && !failed ? '步骤实拍' : label}</Text>{!uri || failed ? <Text style={s.small}>{failed ? '配图暂时无法加载' : '配图待补'}</Text> : null}</View>;
}
export default function RouteScreen({ initialOrigin, initialDestination, initialRouteId, preferDemo, records, onBack, onMap, catalogVersion }: {
  initialOrigin: Place; initialDestination: Place; initialRouteId?: string; preferDemo?: boolean; records: RouteRecords; onBack: () => void; onMap: (destination?: Place) => void; catalogVersion: unknown;
}) {
  useLanguage();
  const [origin, setOrigin] = useState(initialOrigin);
  const [destination, setDestination] = useState(initialDestination);
  const [routeId, setRouteId] = useState<string | null>(() => preferDemo ? null : initialRouteId || campusRoutes.find(route => route.originId === initialOrigin.id && route.destinationId === initialDestination.id)?.id || null);
  const [selector, setSelector] = useState<'origin' | 'destination' | null>(null);
  const [allSteps, setAllSteps] = useState(false);
  const shared = routeId ? getCampusRoute(routeId) : undefined;
  const choices = campusRoutes.filter(route => route.originId === origin.id && route.destinationId === destination.id);
  useEffect(() => { if (routeId && !getCampusRoute(routeId)) setRouteId(null); }, [catalogVersion]);
  const bookmark: RouteBookmark = { id: shared?.id || demoRouteId(origin.id, destination.id), originId: origin.id, destinationId: destination.id, source: shared ? 'community' : 'demo' };
  const saved = records.saved.some(item => item.id === bookmark.id);
  const steps = shared ? shared.steps.map(step => ({ title: step.title, copy: step.body, photo: '步骤配图', imageUrl: step.imageUrl })) : routeSteps.map((step, index) => ({ ...step, imageUrl: '', title: index === 0 ? t('从 {place} 出发', { place: placeName(origin) }) : index === 4 ? t('找到 {place} 入口', { place: placeName(destination) }) : index === 5 ? t('到达 {place}', { place: placeName(destination) }) : t(step.title) }));
  const expanded = allSteps || steps.length <= 3;
  const change = (key: 'origin' | 'destination', place: Place) => {
    const other = key === 'origin' ? destination : origin;
    if (other.id === place.id) { Alert.alert('请选择不同地点', '起点和终点不能相同。'); return; }
    const nextOrigin = key === 'origin' ? place : origin, nextDestination = key === 'destination' ? place : destination;
    setOrigin(nextOrigin); setDestination(nextDestination); setAllSteps(false); setSelector(null);
    setRouteId(campusRoutes.find(route => route.originId === nextOrigin.id && route.destinationId === nextDestination.id)?.id || null);
  };
  return <View style={s.flex}>
    <View style={s.topBar}><Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={onBack} style={s.iconButton}><AppIcon name="back" /></Pressable><Text accessibilityRole="header" style={s.topTitle}>步行路线</Text><Pressable testID="save-route" accessibilityRole="button" accessibilityLabel={saved ? '取消收藏路线' : '收藏路线'} accessibilityState={{ selected: saved, disabled: !records.ready }} disabled={!records.ready} onPress={() => records.toggle(bookmark)} style={s.iconButton}><AppIcon name="bookmark" color={saved ? c.rust : c.green} /></Pressable></View>
    <ScrollView contentContainerStyle={{ paddingBottom: 10 }}>
      <View style={s.endpointGroup}><View style={s.endpoints}>{(['origin','destination'] as const).map((key, index) => <Pressable key={key} testID={`route-${key}`} accessibilityRole="button" accessibilityLabel={index ? '选择终点' : '选择起点'} onPress={() => setSelector(key)} style={[s.endpoint, index === 0 && s.endpointLine]}><View style={[s.endpointDot,index === 1 && s.endDot]} /><Text raw style={[s.endpointText,s.flex]}>{placeName(key === 'origin' ? origin : destination)}</Text><AppIcon name="chevron" size={16} /></Pressable>)}</View><Pressable testID="route-swap" accessibilityRole="button" accessibilityLabel="交换起点和终点" onPress={() => { setOrigin(destination); setDestination(origin); setAllSteps(false); setRouteId(campusRoutes.find(route => route.originId === destination.id && route.destinationId === origin.id)?.id || null); }} style={s.iconButton}><AppIcon name="swap" /></Pressable></View>
      {choices.length ? <View style={s.routeChoices}><Text style={s.sectionTitle}>选择路线</Text>{choices.map(route => <Pressable key={route.id} accessibilityRole="radio" accessibilityState={{ checked: routeId === route.id }} onPress={() => { setRouteId(route.id); setAllSteps(false); }} style={s.choice}><AppIcon name="walk" size={18} /><Text raw style={[s.rowTitle,s.flex]}>{route.title}</Text>{routeId === route.id ? <AppIcon name="check" size={18} /> : null}</Pressable>)}<Pressable accessibilityRole="radio" accessibilityState={{ checked: !shared }} onPress={() => { setRouteId(null); setAllSteps(false); }} style={s.choice}><Text style={[s.meta,s.flex]}>演示路线</Text>{!shared ? <AppIcon name="check" size={18} /> : null}</Pressable></View> : null}
      <View style={s.routeMap}><MapCanvas selected={destination} origin={origin} variant="route" /><Text style={s.mapNote}>示意地图 · 非实际导航</Text></View>
      <View style={s.routeBody}>
        {shared ? <><Text raw style={s.sharedTitle}>{shared.title}</Text><Text raw style={s.body}>{shared.body}</Text><Text style={s.sharedNote}>同学分享的路线 · 地图连线仅为位置示意，请按图文步骤核对。</Text></> : <><View style={s.heading}><View><Text style={s.body}><Text style={s.duration}>8</Text> 分钟 · 示例</Text><Text style={s.meta}>480 m · 演示步行路线</Text></View><Text style={s.badge}>步行</Text></View><Text style={s.meta}>步行途中按指引乘坐电梯或经过楼梯。</Text></>}
        <View style={s.heading}><Text style={s.sectionTitle}>{t('图文路线指引 · {count} 步', { count: steps.length })}</Text>{!shared ? <Text style={s.small}>每步配图待完善</Text> : null}</View>
        {steps.slice(0, expanded ? steps.length : 3).map((step, index) => <View key={(shared?.id || 'demo') + index} style={s.step}><View style={s.track}><View style={s.stepDot}><Text style={s.stepNumber}>{index + 1}</Text></View>{index < steps.length - 1 ? <View style={s.stepLine} /> : null}</View><View style={s.stepCopy}><Text raw style={s.rowTitle}>{step.title}</Text><Text raw={Boolean(shared)} style={s.body}>{step.copy}</Text></View><StepPhoto uri={step.imageUrl} index={index} label={step.photo} /></View>)}
        {!shared ? <Text style={s.note}>距离、用时与通行方式均为演示，请勿据此实际导航。</Text> : null}
      </View>
    </ScrollView>
    <View style={s.footer}><Pressable testID="route-all-steps" accessibilityRole="button" onPress={() => expanded ? onMap(destination) : setAllSteps(true)} style={s.action}><AppIcon name={expanded ? 'map' : 'walk'} size={19} color="#fff" /><Text style={s.actionText}>{expanded ? '返回地图' : t('查看全部 {count} 步', { count: steps.length })}</Text></Pressable></View>
    <Modal visible={selector !== null} animationType="slide" onRequestClose={() => setSelector(null)}><SafeAreaView style={[s.flex,{ backgroundColor: c.app }]}><PlaceSearch title={selector === 'origin' ? '选择起点' : '选择终点'} onBack={() => setSelector(null)} onChoose={place => { if (selector) change(selector,place); }} /></SafeAreaView></Modal>
  </View>;
}
const s = StyleSheet.create({ flex: { flex: 1 }, topBar: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9 }, topTitle: { flex: 1, fontSize: 20, fontWeight: '800', color: c.ink }, iconButton: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center' }, endpointGroup: { flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 8, marginBottom: 17, gap: 6 }, endpoints: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: c.line, borderRadius: 13, overflow: 'hidden' }, endpoint: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 55, padding: 13 }, endpointLine: { borderBottomWidth: 1, borderBottomColor: c.line }, endpointDot: { width: 8, height: 8, borderWidth: 2, borderColor: c.green, borderRadius: 4 }, endDot: { borderRadius: 2, backgroundColor: c.rust, borderColor: c.rust }, endpointText: { fontSize: 13, color: c.ink, lineHeight: 20 }, routeMap: { height: 245, marginHorizontal: 8, overflow: 'hidden' }, mapNote: { position: 'absolute', bottom: 7, left: 8, color: c.muted, backgroundColor: '#fbfcf8dd', fontSize: 10, padding: 3 }, routeBody: { padding: 18 }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, sectionTitle: { fontSize: 14, lineHeight: 22, fontWeight: '700', color: c.ink, marginVertical: 14 }, rowTitle: { fontSize: 14, color: c.ink, fontWeight: '700', lineHeight: 22 }, body: { fontSize: 13, color: c.muted, lineHeight: 22 }, meta: { fontSize: 11, color: c.muted, lineHeight: 18 }, small: { fontSize: 10, color: c.muted, lineHeight: 16 }, duration: { fontSize: 28, fontWeight: '800', color: c.ink, lineHeight: 36 }, badge: { fontSize: 10, color: c.green, backgroundColor: c.tint, padding: 6, borderRadius: 5 }, step: { flexDirection: 'row', gap: 10, minHeight: 120 }, track: { alignItems: 'center', width: 26 }, stepDot: { width: 26, height: 28, borderRadius: 9, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }, stepNumber: { color: c.green, fontSize: 12, fontWeight: '700' }, stepLine: { width: 1, flex: 1, backgroundColor: '#b6c8b1' }, stepCopy: { flex: 1, paddingTop: 2, paddingBottom: 20 }, stepPhoto: { width: 92, marginBottom: 15, minHeight: 100, backgroundColor: c.tint, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#c6d1bc', alignItems: 'center', paddingBottom: 6, overflow: 'hidden' }, realPhoto: { width: 90, height: 78 }, photoLabel: { fontSize: 10, color: c.muted, lineHeight: 17, textAlign: 'center', paddingHorizontal: 3 }, footer: { padding: 15, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.app }, action: { minHeight: 48, padding: 12, borderRadius: 11, backgroundColor: c.green, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }, actionText: { fontSize: 14, lineHeight: 22, fontWeight: '700', color: '#fff', textAlign: 'center', flexShrink: 1 }, note: { fontSize: 11, lineHeight: 20, color: c.muted, marginTop: 14 }, sharedTitle: { fontSize: 20, lineHeight: 29, fontWeight: '800', color: c.ink, marginBottom: 8 }, sharedNote: { fontSize: 11, lineHeight: 20, color: c.green, marginTop: 10 }, routeChoices: { margin: 18, marginTop: 0, paddingHorizontal: 13, paddingBottom: 4, borderRadius: 12, backgroundColor: c.tint }, choice: { minHeight: 48, flexDirection: 'row', gap: 9, alignItems: 'center', borderTopWidth: 1, borderTopColor: c.line, paddingVertical: 9 } });
