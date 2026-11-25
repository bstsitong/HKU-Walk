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
import RoutePhotoViewer from './RoutePhotoViewer';
import useRouteTranslation from './useRouteTranslation';
import { campusRoutes, classroomBuilding, classroomLocation, getCampusRoute, getPlace, mapPlace, Place, placeName } from './campus';
import { RouteRecords } from './useSavedRoutes';
import { RouteBookmark } from './routeBookmarks';
import { t } from './localization';
import { useLanguage } from './LanguageProvider';
import { colors as c } from './theme';

function StepPhoto({ uri, index, label, illustration, onPreview }: { uri?: string; index: number; label: string; illustration?: number; onPreview: () => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return <View style={s.stepPhoto}>{uri && !failed ? <Pressable testID={`route-step-photo-${index + 1}`} accessibilityRole="button" accessibilityLabel={t('查看路线第 {step} 步大图', { step: index + 1 })} onPress={onPreview} style={s.photoButton}><Image source={{ uri }} accessibilityLabel={t('路线第 {step} 步配图', { step: index + 1 })} style={s.realPhoto} resizeMode="cover" onError={() => setFailed(true)} /></Pressable> : <><StepIllustration step={illustration ?? Math.min(index, 5)} /><Text style={s.photoLabel}>{label}</Text></>}{(!uri || failed) && illustration === undefined ? <Text style={s.small}>{failed ? '配图暂时无法加载' : '配图待补'}</Text> : null}</View>;
}
export default function RouteScreen({ initialOrigin, initialDestination, initialRouteId, records, recentPlaceIds, onBack, onMap, onVisit, active, catalogVersion, routeImages }: {
  initialOrigin?: Place; initialDestination: Place; initialRouteId?: string; preferDemo?: boolean; publishedOnly?: boolean; records: RouteRecords; recentPlaceIds: readonly string[]; onBack: () => void; onMap?: (destination?: Place) => void; onVisit: (route: RouteBookmark) => void; active: boolean; catalogVersion: unknown; routeImages: ReadonlyMap<string, string>;
}) {
  const { language } = useLanguage();
  const suggested = !initialOrigin ? (initialRouteId ? getCampusRoute(initialRouteId) : undefined) ?? campusRoutes.find(route => route.destinationId === initialDestination.id) : undefined;
  const [origin, setOrigin] = useState(initialOrigin ?? (suggested && getPlace(suggested.originId)));
  const [destination, setDestination] = useState(initialDestination);
  const [routeId, setRouteId] = useState<string | null>(() => initialRouteId || suggested?.id || campusRoutes.find(route => route.originId === initialOrigin?.id && route.destinationId === initialDestination.id)?.id || null);
  const [selector, setSelector] = useState<'origin' | 'destination' | null>(null);
  const [preview, setPreview] = useState<{ uri: string; step?: number; title?: string } | null>(null);
  useEffect(() => { if (!active) setPreview(null); }, [active]);
  const shared = (routeId ? getCampusRoute(routeId) : undefined) ?? campusRoutes.find(route => route.originId === origin?.id && route.destinationId === destination.id);
  const translation = useRouteTranslation(shared, language, active);
  const localized = translation.route;
  const overview = shared && (shared.imageUrl ?? routeImages.get(shared.entryId));
  const classroom = Boolean(destination.parentBuildingId);
  const building = classroomBuilding(destination);
  useEffect(() => { if (routeId && !getCampusRoute(routeId)) setRouteId(null); }, [catalogVersion]);
  const bookmark: RouteBookmark | undefined = origin && shared ?
    { id: shared.id, originId: origin.id, destinationId: destination.id, source: 'community' } : undefined;
  const id = bookmark?.id, originId = bookmark?.originId, destinationId = bookmark?.destinationId, source = bookmark?.source;
  useEffect(() => { if (active && id && originId && destinationId && source) onVisit({ id, originId, destinationId, source }); }, [active, id, originId, destinationId, source, onVisit]);
  const saved = records.saved.some(item => item.id === bookmark?.id);
  const steps: { title: string; copy: string; photo: string; imageUrl?: string; illustration?: number }[] =
    shared ? shared.steps.map((step, index) => ({ title: localized?.steps[index].title ?? '', copy: localized?.steps[index].body ?? '', photo: '步骤配图', imageUrl: step.imageUrl })) :
    [];
  const change = (key: 'origin' | 'destination', place: Place) => {
    const other = key === 'origin' ? destination : origin;
    if (other?.id === place.id) { Alert.alert('请选择不同地点', '起点和终点不能相同。'); return; }
    const nextOrigin = key === 'origin' ? place : origin, nextDestination = key === 'destination' ? place : destination;
    setOrigin(nextOrigin); setDestination(nextDestination); setSelector(null);
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
        {origin && !classroom && !origin.parentBuildingId ? <Pressable testID="route-swap" accessibilityRole="button" accessibilityLabel="交换起点和终点" onPress={() => { setOrigin(destination); setDestination(origin); setRouteId(campusRoutes.find(route => route.originId === destination.id && route.destinationId === origin.id)?.id || null); }} style={s.swap}><AppIcon name="swap" size={20} /></Pressable> : null}
      </View>
      <View style={s.overview}>
        <Text accessibilityRole="header" style={s.sectionTitle}>路线总览图</Text>
        {overview ?
        <Pressable testID="route-overview-photo" accessibilityRole="button" accessibilityLabel="查看路线总览大图" onPress={() => setPreview({ uri: overview })}>
          <Image source={{ uri: overview }} accessibilityLabel="路线总览图" resizeMode="contain" style={s.overviewImage} />
        </Pressable>
        : <View style={s.routeMap}><MapCanvas selected={destination} origin={origin} variant={origin ? 'route' : 'mini'} /><Text style={s.mapNote}>{classroom ? '教室所在楼宇 · © OpenStreetMap' : origin ? '起点与终点 · © OpenStreetMap' : '目的地 · © OpenStreetMap'}</Text></View>}
      </View>
      <View style={s.routeBody}>
        <View style={s.guidanceHeading}><Text accessibilityRole="header" style={s.sectionTitle}>路线指引</Text></View>
        {shared ? <>
          {localized ? <><Text raw style={s.sharedTitle}>{localized.title}</Text>{shared.authorProfile ? <AuthorByline author={shared.authorProfile} /> : null}{localized.body ? <Text raw style={s.body}>{localized.body}</Text> : null}</> : null}
          {translation.loading ? <Text accessibilityLiveRegion="polite" style={s.body}>正在翻译路线指引…</Text> : null}
          {translation.error ? <View><Text accessibilityLiveRegion="polite" style={s.body}>路线翻译暂时不可用，请重试。</Text><Pressable testID="retry-route-translation" accessibilityRole="button" onPress={translation.retry} style={s.retry}><Text style={s.retryText}>重新翻译</Text></Pressable></View> : null}
        </> : null}
        {steps.length ? <>
        {steps.map((step, index) => (
          <View key={(shared?.id || destination.id) + index} style={s.step}>
            <View style={s.track}><View style={s.stepDot}><Text style={s.stepNumber}>{index + 1}</Text></View>{index < steps.length - 1 ? <View style={s.stepLine} /> : null}</View>
            <View style={s.stepCopy}>
              <Text raw={Boolean(shared)} style={s.rowTitle}>{step.title}</Text>
              {step.copy ? <Text raw={Boolean(shared)} style={s.body}>{step.copy}</Text> : null}
            </View>
            {!shared || step.imageUrl ? <StepPhoto uri={step.imageUrl} index={index} label={step.photo} illustration={step.illustration} onPreview={() => { if (step.imageUrl) setPreview({ uri: step.imageUrl, step: index + 1, title: step.title }); }} /> : null}
          </View>
        ))}
        </> :
        <Text style={s.body}>地点线路待添加</Text>
        }
      </View>
    </ScrollView>
    {steps.length > 0 && onMap ? <View style={s.footer}><Pressable testID="route-return-map" accessibilityRole="button" onPress={() => onMap(mapPlace(destination))} style={s.action}><AppIcon name="map" size={19} color="#fff" /><Text style={s.actionText}>返回地图</Text></Pressable></View> : null}
    <AppModal visible={selector !== null} animationType="slide" onRequestClose={() => setSelector(null)}><SafeAreaView style={[s.flex,{ backgroundColor: c.app }]}><PlaceSearch recentPlaceIds={recentPlaceIds} title={selector === 'origin' ? '选择起点' : '选择终点'} onBack={() => setSelector(null)} onChoose={place => { if (selector) change(selector,place); }} /></SafeAreaView></AppModal>
    {preview ? <RoutePhotoViewer uri={preview.uri} title={preview.step === undefined ? t('路线总览图') : t('路线第 {step} 步配图', { step: preview.step }) + (steps[preview.step - 1]?.title ? ' · ' + steps[preview.step - 1].title : '')} onClose={() => setPreview(null)} /> : null}
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

  routeMap: { height: 224, overflow: 'hidden', borderRadius: 12, borderWidth: 1, borderColor: c.line },
  mapNote: { position: 'absolute', bottom: 8, left: 8, maxWidth: '90%', color: c.ink, backgroundColor: c.app, fontSize: 11, lineHeight: 16, padding: 4 },
  routeBody: { padding: 16 },
  overview: { marginHorizontal: 16, gap: 8 },
  overviewImage: { width: '100%', height: 220, borderRadius: 10, backgroundColor: c.paper },
  guidanceHeading: { marginBottom: 12 },
  retry: { minHeight: 48, alignSelf: 'flex-start', justifyContent: 'center' },
  retryText: { color: c.green, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  sectionTitle: { fontSize: 16, lineHeight: 24, fontWeight: '600', color: c.ink },
  rowTitle: { fontSize: 15, color: c.ink, fontWeight: '600', lineHeight: 20 },
  body: { fontSize: 14, color: c.muted, lineHeight: 20 },
  meta: { fontSize: 12, color: c.muted, lineHeight: 20 },
  small: { fontSize: 11, color: c.muted, lineHeight: 16, textAlign: 'center' },
  step: { flexDirection: 'row', gap: 12, minHeight: 112 },
  track: { alignItems: 'center', width: 28 },
  stepDot: { minWidth: 28, minHeight: 28, paddingHorizontal: 4, borderRadius: 14, borderWidth: 1, borderColor: c.green, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  stepNumber: { color: c.green, fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  stepLine: { width: 1, flex: 1, backgroundColor: c.green },
  stepCopy: { flex: 1, gap: 4, paddingBottom: 16 },
  stepPhoto: { width: 88, alignSelf: 'flex-start', marginBottom: 12, backgroundColor: c.paper, borderRadius: 8, alignItems: 'center', paddingBottom: 4, overflow: 'hidden' },
  realPhoto: { width: '100%', height: 80 },
  photoButton: { width: '100%', minHeight: 80 },
  photoLabel: { fontSize: 11, color: c.ink, lineHeight: 16, textAlign: 'center', paddingHorizontal: 4 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.app },
  action: { minHeight: 48, padding: 12, borderRadius: 8, backgroundColor: c.green, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: c.surface, textAlign: 'center', flexShrink: 1 },
  sharedTitle: { fontSize: 20, lineHeight: 28, fontWeight: '600', color: c.ink, marginBottom: 8 },
});
