import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert, Image, Pressable, Text } from './ui';
import AppIcon from './AppIcon';
import { AppModal } from './Assistant';
import { AuthorByline } from './AuthorIdentity';
import PlaceSearch from './PlaceSearch';
import MapCanvas from './MapCanvas';
import StepIllustration from './StepIllustration';
import { campusRoutes, classroomBuilding, classroomLocation, getCampusRoute, getPlace, mapPlace, Place, placeName, routeSteps } from './campus';
import { classroomDirections } from './classroomRoutes';
import { RouteRecords } from './useSavedRoutes';
import { demoRouteId, RouteBookmark } from './routeBookmarks';
import { t } from './localization';
import { useLanguage } from './LanguageProvider';
import { colors as c } from './theme';

function StepPhoto({ uri, index, label, illustration }: { uri?: string; index: number; label: string; illustration?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return <View style={s.stepPhoto}>{uri && !failed ? <Image source={{ uri }} accessibilityLabel={t('路线第 {step} 步配图', { step: index + 1 })} style={s.realPhoto} resizeMode="cover" onError={() => setFailed(true)} /> : <StepIllustration step={illustration ?? Math.min(index, 5)} />}<Text style={s.photoLabel}>{uri && !failed ? '步骤实拍' : label}</Text>{(!uri || failed) && illustration === undefined ? <Text style={s.small}>{failed ? '配图暂时无法加载' : '配图待补'}</Text> : null}</View>;
}
export default function RouteScreen({ initialOrigin, initialDestination, initialRouteId, preferDemo, publishedOnly, records, recentPlaceIds, onBack, onMap, onVisit, active, catalogVersion, routeImages }: {
  initialOrigin?: Place; initialDestination: Place; initialRouteId?: string; preferDemo?: boolean; publishedOnly?: boolean; records: RouteRecords; recentPlaceIds: readonly string[]; onBack: () => void; onMap?: (destination?: Place) => void; onVisit: (route: RouteBookmark) => void; active: boolean; catalogVersion: unknown; routeImages: ReadonlyMap<string, string>;
}) {
  useLanguage();
  const [origin, setOrigin] = useState(initialOrigin);
  const [destination, setDestination] = useState(initialDestination);
  const [routeId, setRouteId] = useState<string | null>(() => preferDemo ? null : initialRouteId || campusRoutes.find(route => route.originId === initialOrigin?.id && route.destinationId === initialDestination.id)?.id || null);
  const [selector, setSelector] = useState<'origin' | 'destination' | null>(null);
  const [allSteps, setAllSteps] = useState(false);
  const shared = routeId ? getCampusRoute(routeId) : undefined;
  const overview = shared && (shared.imageUrl ?? routeImages.get(shared.entryId));
  const choices = campusRoutes.filter(route => route.originId === origin?.id && route.destinationId === destination.id);
  const classroom = Boolean(destination.parentBuildingId);
  const building = classroomBuilding(destination);
  const classroomSteps = classroom ? classroomDirections(origin, destination) : null;
  const canShowDemo = !publishedOnly && !origin?.parentBuildingId && !classroom;
  useEffect(() => { if (routeId && !getCampusRoute(routeId)) setRouteId(null); }, [catalogVersion]);
  const bookmark: RouteBookmark | undefined = origin && (shared || classroomSteps || canShowDemo) ?
    { id: shared?.id || demoRouteId(origin.id, destination.id), originId: origin.id, destinationId: destination.id, source: shared ? 'community' : 'demo' } : undefined;
  const id = bookmark?.id, originId = bookmark?.originId, destinationId = bookmark?.destinationId, source = bookmark?.source;
  useEffect(() => { if (active && id && originId && destinationId && source) onVisit({ id, originId, destinationId, source }); }, [active, id, originId, destinationId, source, onVisit]);
  const saved = records.saved.some(item => item.id === bookmark?.id);
  const steps: { title: string; copy: string; photo: string; imageUrl?: string; illustration?: number }[] =
    shared ? shared.steps.map(step => ({ title: step.title, copy: step.body, photo: '步骤配图', imageUrl: step.imageUrl })) :
    classroomSteps ? classroomSteps.map(step => ({ ...step, photo: '步骤示意' })) :
    origin && canShowDemo ? routeSteps.map((step, index) => ({ ...step, title: index === 0 ? t('从 {place} 出发', { place: placeName(origin) }) : index === 4 ? t('找到 {place} 入口', { place: placeName(destination) }) : index === 5 ? t('到达 {place}', { place: placeName(destination) }) : t(step.title) })) : [];
  const expanded = allSteps || steps.length <= 3;
  const change = (key: 'origin' | 'destination', place: Place) => {
    const other = key === 'origin' ? destination : origin;
    if (other?.id === place.id) { Alert.alert('请选择不同地点', '起点和终点不能相同。'); return; }
    const nextOrigin = key === 'origin' ? place : origin, nextDestination = key === 'destination' ? place : destination;
    setOrigin(nextOrigin); setDestination(nextDestination); setAllSteps(false); setSelector(null);
    setRouteId(campusRoutes.find(route => route.originId === nextOrigin?.id && route.destinationId === nextDestination.id)?.id || null);
  };
  return <View style={s.flex}>
    <View style={s.topBar}><Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={onBack} style={s.iconButton}><AppIcon name="back" /></Pressable><Text accessibilityRole="header" style={s.topTitle}>步行路线</Text>{bookmark ? <Pressable testID="save-route" accessibilityRole="button" accessibilityLabel={saved ? '取消收藏路线' : '收藏路线'} accessibilityState={{ selected: saved, disabled: !records.ready }} disabled={!records.ready} onPress={() => records.toggle(bookmark)} style={s.iconButton}><AppIcon name="bookmark" color={saved ? c.rust : c.green} /></Pressable> : null}</View>
    <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
      <View style={s.endpointGroup}>
        <View style={s.endpoints}>
          {(['origin', 'destination'] as const).map(key => {
            const isOrigin = key === 'origin';
            const place = isOrigin ? origin : destination;
            const label = t(isOrigin ? '选择起点' : '选择终点');
            const name = place ? placeName(place) : t(label);
            return <Pressable key={key} testID={`route-${key}`} accessibilityRole="button" accessibilityLabel={place ? `${label}, ${name}` : label} onPress={() => setSelector(key)} style={[s.endpoint, isOrigin && s.endpointLine]}>
              <View style={[s.endpointDot, !isOrigin && s.endDot]} />
              <View style={s.flex}><Text style={s.meta}>{isOrigin ? '起点' : '终点'}</Text><Text raw style={s.endpointText}>{name}</Text>
                {!isOrigin && building ? <Text raw style={s.meta}>{classroomLocation(destination, building)}</Text> : null}</View>
              <AppIcon name="chevron" size={16} color={c.muted} />
            </Pressable>;
          })}
        </View>
        {origin && !classroom && !origin.parentBuildingId ? <Pressable testID="route-swap" accessibilityRole="button" accessibilityLabel="交换起点和终点" onPress={() => { setOrigin(destination); setDestination(origin); setAllSteps(false); setRouteId(campusRoutes.find(route => route.originId === destination.id && route.destinationId === origin.id)?.id || null); }} style={s.swap}><AppIcon name="swap" size={20} /></Pressable> : null}
      </View>
      {choices.length ? <View style={s.routeChoices}><Text style={s.sectionTitle}>选择路线</Text>{choices.map(route => <Pressable key={route.id} accessibilityRole="radio" accessibilityState={{ checked: routeId === route.id }} onPress={() => { setRouteId(route.id); setAllSteps(false); }} style={s.choice}><AppIcon name="walk" size={18} /><Text raw style={[s.rowTitle,s.flex]}>{route.title}</Text>{routeId === route.id ? <AppIcon name="check" size={18} /> : null}</Pressable>)}{classroomSteps || canShowDemo ? <Pressable accessibilityRole="radio" accessibilityState={{ checked: !shared }} onPress={() => { setRouteId(null); setAllSteps(false); }} style={s.choice}><Text style={[s.meta,s.flex]}>{classroomSteps ? '教室路线' : '演示路线'}</Text>{!shared ? <AppIcon name="check" size={18} /> : null}</Pressable> : null}</View> : null}
      <View style={s.routeMap}><MapCanvas selected={destination} origin={origin} variant={origin ? 'route' : 'mini'} /><Text style={s.mapNote}>{classroom ? '教室所在楼宇 · © OpenStreetMap' : origin ? '起点与终点 · © OpenStreetMap' : '目的地 · © OpenStreetMap'}</Text></View>
      {steps.length ? <View style={s.routeBody}>
        {shared ? <><Text raw style={s.sharedTitle}>{shared.title}</Text>{shared.authorProfile ? <AuthorByline author={shared.authorProfile} /> : null}<Text raw style={s.body}>{shared.body}</Text><Text style={s.sharedNote}>同学分享的路线 · 请按图文步骤核对。</Text></> : classroomSteps ? null : <><View style={s.heading}><View><Text style={s.body}><Text style={s.duration}>8</Text> 分钟 · 示例</Text><Text style={s.meta}>480 m · 演示步行路线</Text></View><Text style={s.badge}>步行</Text></View><Text style={s.meta}>步行途中按指引乘坐电梯或经过楼梯。</Text></>}
        {overview ? <View style={s.overview}>
          <Text accessibilityRole="header" style={s.sectionTitle}>路线总览图</Text>
          <Image source={{ uri: overview }} accessibilityLabel="路线总览图" resizeMode="contain" style={s.overviewImage} />
        </View> : null}
        <View style={[s.heading, !classroomSteps && s.stepsHeading, classroomSteps && s.classroomStepsHeading]}><Text accessibilityRole="header" style={s.sectionTitle}>{t('图文路线指引 · {count} 步', { count: steps.length })}</Text>{!shared && !classroomSteps ? <Text style={s.small}>每步配图待完善</Text> : null}</View>
        {steps.slice(0, expanded ? steps.length : 3).map((step, index) => (
          <View key={(shared?.id || destination.id) + index} style={s.step}>
            <View style={s.track}><View style={s.stepDot}><Text style={s.stepNumber}>{index + 1}</Text></View>{index < steps.length - 1 ? <View style={s.stepLine} /> : null}</View>
            <View style={s.stepCopy}>
              <Text raw={Boolean(shared)} style={s.rowTitle}>{step.title}</Text>
              {step.copy ? <Text raw={Boolean(shared)} style={s.body}>{step.copy}</Text> : null}
            </View>
            {!shared || step.imageUrl ? <StepPhoto uri={step.imageUrl} index={index} label={step.photo} illustration={step.illustration} /> : null}
          </View>
        ))}
        {!shared && !classroomSteps ? <Text style={s.note}>距离、用时与通行方式均为演示，请勿据此实际导航。</Text> : null}
      </View> : <View style={s.routeBody}>
        <Text style={s.body}>{classroom ? '请选择 A2、C1 或教室所在楼宇作为起点。' : origin ? '这两个地点之间暂时没有已发布的步行指引。' : '终点已填好。选择起点后可查看已发布的步行指引。'}</Text>
        {classroom ? <View style={s.originOptions}>{['gate', 'mtr-c1', building?.id].flatMap(id => {
          const place = id && getPlace(id);
          return place ? [<Pressable key={id} accessibilityRole="button" onPress={() => change('origin', place)} style={s.originOption}><Text raw style={s.endpointText}>{place.abbreviation || placeName(place)}</Text></Pressable>] : [];
        })}</View> : null}
      </View>}
    </ScrollView>
    {steps.length > 0 && (!expanded || onMap) ? <View style={s.footer}><Pressable testID="route-all-steps" accessibilityRole="button" onPress={() => expanded ? onMap?.(mapPlace(destination)) : setAllSteps(true)} style={s.action}><AppIcon name={expanded ? 'map' : 'walk'} size={19} color="#fff" /><Text style={s.actionText}>{expanded ? '返回地图' : t('查看全部 {count} 步', { count: steps.length })}</Text></Pressable></View> : null}
    <AppModal visible={selector !== null} animationType="slide" onRequestClose={() => setSelector(null)}><SafeAreaView style={[s.flex,{ backgroundColor: c.app }]}><PlaceSearch recentPlaceIds={recentPlaceIds} title={selector === 'origin' ? '选择起点' : '选择终点'} onBack={() => setSelector(null)} onChoose={place => { if (selector) change(selector,place); }} /></SafeAreaView></AppModal>
  </View>;
}
const s = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  topTitle: { flex: 1, fontSize: 24, lineHeight: 32, fontWeight: '600', color: c.ink },
  iconButton: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center' },
  endpointGroup: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16, gap: 8 },
  endpoints: { flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 12, overflow: 'hidden' },
  endpoint: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8 },
  endpointLine: { borderBottomWidth: 1, borderBottomColor: c.line },
  endpointDot: { width: 8, height: 8, borderWidth: 2, borderColor: c.green, borderRadius: 4 },
  endDot: { borderRadius: 2, backgroundColor: c.green },
  endpointText: { fontSize: 15, color: c.ink, lineHeight: 20, fontWeight: '500' },
  swap: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface },

  routeMap: { height: 224, marginHorizontal: 16, overflow: 'hidden', borderRadius: 12, borderWidth: 1, borderColor: c.line },
  mapNote: { position: 'absolute', bottom: 8, left: 8, maxWidth: '90%', color: c.ink, backgroundColor: c.app, fontSize: 11, lineHeight: 16, padding: 4 },
  routeBody: { padding: 16 },
  overview: { marginTop: 16, gap: 8 },
  overviewImage: { width: '100%', height: 220, borderRadius: 10, backgroundColor: c.paper },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  stepsHeading: { marginTop: 24, marginBottom: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.line },
  classroomStepsHeading: { marginBottom: 12 },
  originOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  originOption: { minHeight: 48, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderColor: c.line, borderRadius: 8, backgroundColor: c.surface },
  sectionTitle: { fontSize: 16, lineHeight: 24, fontWeight: '600', color: c.ink },
  rowTitle: { fontSize: 15, color: c.ink, fontWeight: '600', lineHeight: 20 },
  body: { fontSize: 14, color: c.muted, lineHeight: 20 },
  meta: { fontSize: 12, color: c.muted, lineHeight: 20 },
  small: { fontSize: 11, color: c.muted, lineHeight: 16, textAlign: 'center' },
  duration: { fontSize: 28, fontWeight: '600', color: c.ink, lineHeight: 36, fontVariant: ['tabular-nums'] },
  badge: { fontSize: 12, color: c.green, lineHeight: 16 },
  step: { flexDirection: 'row', gap: 12, minHeight: 112 },
  track: { alignItems: 'center', width: 28 },
  stepDot: { minWidth: 28, minHeight: 28, paddingHorizontal: 4, borderRadius: 14, borderWidth: 1, borderColor: c.green, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  stepNumber: { color: c.green, fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  stepLine: { width: 1, flex: 1, backgroundColor: c.green },
  stepCopy: { flex: 1, gap: 4, paddingBottom: 16 },
  stepPhoto: { width: 88, alignSelf: 'flex-start', marginBottom: 12, backgroundColor: c.paper, borderRadius: 8, alignItems: 'center', paddingBottom: 4, overflow: 'hidden' },
  realPhoto: { width: '100%', height: 80 },
  photoLabel: { fontSize: 11, color: c.ink, lineHeight: 16, textAlign: 'center', paddingHorizontal: 4 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.app },
  action: { minHeight: 48, padding: 12, borderRadius: 8, backgroundColor: c.green, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: c.surface, textAlign: 'center', flexShrink: 1 },
  note: { fontSize: 12, lineHeight: 20, color: c.muted, marginTop: 12 },
  sharedTitle: { fontSize: 20, lineHeight: 28, fontWeight: '600', color: c.ink, marginBottom: 8 },
  sharedNote: { fontSize: 12, lineHeight: 20, color: c.muted, marginTop: 8 },
  routeChoices: { marginHorizontal: 16, marginBottom: 16, paddingHorizontal: 12, paddingTop: 12, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface },
  choice: { minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center', borderTopWidth: 1, borderTopColor: c.line, paddingVertical: 8 },
});
