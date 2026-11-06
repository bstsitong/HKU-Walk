import { ComponentRef, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { MAP_ART, MAP_HEIGHT, MAP_WIDTH, MAP_Y_MAX } from './MapArtwork';
import AppIcon from './AppIcon';
import { Category, Place, filterPlaces, getPlace, placeIcon, placeName } from './campus';
import { Pressable, Text } from './ui';
import { useLanguage } from './LanguageProvider';
import { colors as c } from './theme';
import { translate } from './localization';
import type { CampusLocation, MapPoint } from './campusLocation';

const background = '#edf0e5';
const mapY = (point: { y: number }) => point.y / MAP_Y_MAX * MAP_HEIGHT;
const labels = [
  { x: 59, y: 129, name: '百周年校园', size: 8 },
  { x: 246, y: 163, name: '本部校园', size: 8 },
  { x: 157, y: 117, name: '大学街', size: 6, color: '#885619' },
  { x: 101, y: 45, name: '薄扶林道', size: 5.5 },
  { x: 282, y: 35, name: '般咸道', size: 5.5 },
  { x: 267, y: 176, name: '大学道', size: 5.5 },
];
const svgText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const priority = ['main', 'library', 'gate', 'mtr-c1', 'garden', 'university-street', 'knowles', 'chiwah', 'meng-wah', 'graduate-house'];

export default function MapCanvas({ selected, category = 'all', zoom = 1, onSelect, variant = 'home', origin, sampleLocation = false, livePosition, centerTick = 0 }: {
  selected: Place; category?: Category; zoom?: number; onSelect?: (place: Place) => void;
  variant?: 'home' | 'route' | 'mini'; origin?: Place; sampleLocation?: boolean; livePosition?: CampusLocation; centerTick?: number;
}) {
  const { language } = useLanguage();
  const [viewport, setViewport] = useState({ width: 360, height: 540 });
  const horizontal = useRef<ComponentRef<typeof ScrollView>>(null);
  const vertical = useRef<ComponentRef<typeof ScrollView>>(null);
  const lastCenterTick = useRef(0);
  const home = variant === 'home';
  const campusGate = getPlace('gate') ?? selected;
  const samplePoint = { ...campusGate, x: campusGate.x + 14, y: campusGate.y + 28 };
  const endpoints = origin && variant === 'route' ? [origin, selected] : [selected];
  const width = viewport.width * (home ? zoom : 1);
  const topInset = Math.max(140, (viewport.height - viewport.width * MAP_HEIGHT / MAP_WIDTH) / 2 - 4);
  const height = home ? Math.max(viewport.height, topInset + width * MAP_HEIGHT / MAP_WIDTH + 160) : viewport.height;
  const box = home
    ? { x: 0, y: -topInset * MAP_WIDTH / width, width: MAP_WIDTH, height: height * MAP_WIDTH / width }
    : detailBox(endpoints, width, height);

  const toScreen = (p: MapPoint) => ({
    x: (p.x - box.x) / box.width * width,
    y: (mapY(p) - box.y) / box.height * height,
  });
  const liveScreen = home && livePosition ? toScreen(livePosition) : null;
  const liveRadius = (livePosition?.radius ?? 0) / box.width * width;
  const pins: { x: number; y: number; place: Place }[] = [];
  const visible = home ? filterPlaces(category) : endpoints;
  const ordered = home
    ? [selected.id, ...priority, ...visible.map(p => p.id)].map(id => visible.find(p => p.id === id))
    : visible;
  const seen = new Set<string>();
  for (const place of ordered) {
    if (!place || place.mapPositionPending || seen.has(place.id)) continue;
    seen.add(place.id);
    const point = toScreen(place);
    if (!home || pins.every(pin => Math.hypot(pin.x - point.x, pin.y - point.y) >= 43)) {
      pins.push({ ...point, place });
    }
  }
  const location = home && sampleLocation
    ? `<circle cx="${samplePoint.x}" cy="${mapY(samplePoint)}" r="10" fill="#6799ba" opacity=".23"/><circle cx="${samplePoint.x}" cy="${mapY(samplePoint)}" r="3.5" fill="#4384b0" stroke="white" stroke-width="1.2"/>`
    : '';
  const mapLabels = labels.map(({ x, y, name, size, color }) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color ?? '#50664c'}" font-weight="600" text-anchor="middle">${svgText(translate(name, language))}</text>`).join('');
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.width} ${box.height}"><defs><clipPath id="campus-extent"><rect width="${MAP_WIDTH}" height="${MAP_HEIGHT}"/></clipPath></defs><g clip-path="url(#campus-extent)">${MAP_ART}${mapLabels}</g>${location}</svg>`;

  useEffect(() => {
    const locating = lastCenterTick.current !== centerTick;
    lastCenterTick.current = centerTick;
    if (!home || (zoom === 1 && !locating)) {
      horizontal.current?.scrollTo({ x: 0, animated: true });
      vertical.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    const fallback = selected.mapPositionPending ? samplePoint : selected;
    const focus = locating ? livePosition ?? (sampleLocation ? samplePoint : fallback) : fallback;
    const point = toScreen(focus);
    horizontal.current?.scrollTo({ x: Math.max(0, point.x - viewport.width / 2), animated: true });
    vertical.current?.scrollTo({ y: Math.max(0, point.y - viewport.height / 2), animated: true });
  }, [zoom, centerTick, viewport.width, viewport.height]);

  const artwork = <View style={{ width, height }}>
    <SvgXml xml={xml} width={width} height={height} accessible={false} />
    {liveScreen && liveRadius > 0 ? <View pointerEvents="none" style={{ position: 'absolute', top: topInset, width, height: width * MAP_HEIGHT / MAP_WIDTH, overflow: 'hidden' }}>
      <View style={[s.accuracy, { left: liveScreen.x - liveRadius, top: liveScreen.y - topInset - liveRadius, width: liveRadius * 2, height: liveRadius * 2, borderRadius: liveRadius }]} />
    </View> : null}
    {pins.map(({ place, x, y }) => {
      const active = place.id === selected.id;
      const label = active || !home ? placeName(place, language) : place.abbreviation;
      return <Pressable key={place.id} testID={`pin-${place.id}`} accessibilityRole="button" accessibilityLabel={placeName(place, language)}
        accessibilityState={{ selected: active }} disabled={!onSelect} onPress={() => onSelect?.(place)}
        style={[s.hit, { left: x - 24, top: y - 24 }, active && s.activeHit]}>
        <View style={[s.pin, active && s.selected]}><AppIcon name={placeIcon(place)} size={active ? 17 : 12} color="#fff" /></View>
        {label ? <View pointerEvents="none" style={[s.label, (active || !home) && s.fullLabel]}><Text raw numberOfLines={2} style={s.labelText}>{label}</Text></View> : null}
      </Pressable>;
    })}
    {liveScreen ? <View pointerEvents="none" accessible accessibilityLabel={translate('我的位置', language)} testID="live-location-dot"
      style={[s.liveDot, { left: liveScreen.x - 8, top: liveScreen.y - 8 }]} /> : null}
  </View>;
  return <View onLayout={({ nativeEvent: { layout } }) => setViewport({ width: Math.max(1, layout.width), height: Math.max(1, layout.height) })} style={s.frame}>
    {home ? <ScrollView ref={horizontal} horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} bounces={false}>
      <ScrollView ref={vertical} nestedScrollEnabled showsVerticalScrollIndicator={false} bounces={false}>{artwork}</ScrollView>
    </ScrollView> : artwork}
    {variant === 'mini' ? <Text raw style={s.attribution}>© OpenStreetMap</Text> : null}
    {!home && endpoints.some(place => place.mapPositionPending)
      ? <View style={s.pending}><Text style={s.labelText}>旧版点位待重新标记</Text></View>
      : null}
  </View>;
}

function detailBox(places: Place[], width: number, height: number) {
  const points = places.filter(place => !place.mapPositionPending);
  if (!points.length) return { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT };
  const xs = points.map(p => p.x), ys = points.map(mapY);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.max(Math.max(104, maxX - minX + 56) / width, Math.max(66, maxY - minY + 48) / height);
  return { x: (minX + maxX - width * scale) / 2, y: (minY + maxY - height * scale) / 2, width: width * scale, height: height * scale };
}

const s = StyleSheet.create({
  frame: { flex: 1, overflow: 'hidden', backgroundColor: background },
  hit: { position: 'absolute', width: 48, height: 48, justifyContent: 'center', alignItems: 'center' },
  activeHit: { zIndex: 1 },
  pin: { width: 23, height: 23, borderRadius: 12, borderWidth: 2, borderColor: '#fff', backgroundColor: c.green, alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: c.rust, width: 32, height: 32, borderRadius: 16 },
  accuracy: { position: 'absolute', backgroundColor: '#367fc626', borderColor: '#367fc680', borderWidth: 1 },
  liveDot: { position: 'absolute', zIndex: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: '#256cb1', borderWidth: 2, borderColor: '#fff' },
  label: { position: 'absolute', top: 34, width: 43, alignItems: 'center' },
  fullLabel: { width: 138, top: 40 },
  labelText: { color: c.ink, backgroundColor: '#fffdf6', borderRadius: 3, paddingHorizontal: 3, fontSize: 10, lineHeight: 14, fontWeight: '600', textAlign: 'center' },
  attribution: { position: 'absolute', bottom: 4, left: 6, fontSize: 10, color: c.ink, backgroundColor: '#fffdf6' },
  pending: { position: 'absolute', bottom: 8, alignSelf: 'center', backgroundColor: '#fffdf6', padding: 6, borderRadius: 6 },
});
