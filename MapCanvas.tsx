import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { campusMapSvg, MAP_HEIGHT, MAP_WIDTH } from './MapArtwork';
import AppIcon from './AppIcon';
import { Category, Place, filterPlaces, getPlace, placeIcon, placeName } from './campus';
import { Pressable, Text } from './ui';
import { useLanguage } from './LanguageProvider';
import { colors as c } from './theme';
import { translate } from './localization';
import type { CampusLocation, MapPoint } from './campusLocation';
import { mapBand, mapCandidates, MIN_MAP_ZOOM, toMapView } from './mapCamera';
import useMapCamera from './useMapCamera';

const background = '#edf0e5';

export default function MapCanvas({ selected, category = 'all', zoom = MIN_MAP_ZOOM, onZoomChange, onSelect, variant = 'home', origin, sampleLocation = false, livePosition, centerTick = 0 }: {
  selected: Place; category?: Category; zoom?: number; onZoomChange?: (zoom: number) => void; onSelect?: (place: Place) => void;
  variant?: 'home' | 'route' | 'mini'; origin?: Place; sampleLocation?: boolean; livePosition?: CampusLocation; centerTick?: number;
}) {
  const { language } = useLanguage();
  const [viewport, setViewport] = useState({ width: 360, height: 540 });
  const home = variant === 'home';
  const campusGate = getPlace('gate') ?? selected;
  const samplePoint = { x: campusGate.x + 14, y: campusGate.y + 28, radius: 10 };
  const position = home ? livePosition ?? (sampleLocation ? samplePoint : undefined) : undefined;
  const { camera, surface, handlers } = useMapCamera(viewport, zoom, centerTick, position ?? selected, onZoomChange);
  const endpoints = origin && variant === 'route' ? [origin, selected] : [selected];
  const frame = home
    ? { x: camera.x, y: camera.y, scale: viewport.width * camera.zoom / MAP_WIDTH }
    : detailFrame(endpoints, viewport.width, viewport.height);

  const toScreen = (point: MapPoint) => {
    const map = toMapView(point);
    return { x: frame.x + map.x * frame.scale, y: frame.y + map.y * frame.scale };
  };
  const band = mapBand(viewport);
  const onMap = ({ x, y }: MapPoint) =>
    x >= 0 && x <= viewport.width && y >= band.top && y <= band.top + band.height;
  const positionOnScreen = position ? toScreen(position) : null;
  const marker = positionOnScreen && onMap(positionOnScreen) ? positionOnScreen : null;
  const radius = (position?.radius ?? 0) * frame.scale;
  const pins: (MapPoint & { place: Place })[] = [];
  const candidates = home
    ? mapCandidates(filterPlaces(category), selected.id, category, camera.zoom)
    : endpoints.filter(place => !place.mapPositionPending);
  for (const place of candidates) {
    const point = toScreen(place);
    if (!home || (onMap(point) && pins.every(pin => Math.hypot(pin.x - point.x, pin.y - point.y) >= 46))) {
      pins.push({ ...point, place });
    }
  }
  const svg = useMemo(() => campusMapSvg(label => translate(label, language)), [language]);
  const mapWidth = MAP_WIDTH * frame.scale;
  const mapHeight = MAP_HEIGHT * frame.scale;

  return <View ref={surface} collapsable={false} {...(home ? handlers : undefined)}
    onLayout={({ nativeEvent: { layout } }) => setViewport({ width: Math.max(1, layout.width), height: Math.max(1, layout.height) })} style={s.frame}>
    <View pointerEvents="none" style={[s.backdrop, { left: frame.x, top: frame.y, width: mapWidth, height: mapHeight }]}>
      <SvgXml xml={svg} width="100%" height="100%" accessible={false} />
      {marker && radius > 0 ? <View style={[s.accuracy, { left: marker.x - frame.x - radius, top: marker.y - frame.y - radius, width: radius * 2, height: radius * 2, borderRadius: radius }]} /> : null}
    </View>
    {pins.map(({ place, x, y }) => {
      const active = place.id === selected.id;
      const showName = active || !home || (camera.zoom >= 2.15 && !place.abbreviation);
      const label = showName ? placeName(place, language) : place.abbreviation;
      return <Pressable key={place.id} testID={`pin-${place.id}`} accessibilityRole="button" accessibilityLabel={placeName(place, language)}
        accessibilityState={{ selected: active }} disabled={!onSelect} onPress={() => onSelect?.(place)}
        style={[s.hit, { left: x - 24, top: y - 24 }, active && s.activeHit]}>
        <View style={[s.pin, active && s.selected]}><AppIcon name={placeIcon(place)} size={active ? 17 : 12} color="#fff" /></View>
        {label ? <View pointerEvents="none" style={[s.label, showName && s.fullLabel]}><Text raw numberOfLines={2} style={s.labelText}>{label}</Text></View> : null}
      </Pressable>;
    })}
    {marker ? <View pointerEvents="none" accessible accessibilityLabel={translate(livePosition ? '我的位置' : '演示位置', language)}
      testID={livePosition ? 'live-location-dot' : 'sample-location-dot'}
      style={[s.liveDot, !livePosition && s.sampleDot, { left: marker.x - 8, top: marker.y - 8 }]} /> : null}
    {variant === 'mini' ? <Text raw style={s.attribution}>© OpenStreetMap</Text> : null}
    {!home && endpoints.some(place => place.mapPositionPending)
      ? <View style={s.pending}><Text style={s.labelText}>旧版点位待重新标记</Text></View> : null}
  </View>;
}

function detailFrame(places: Place[], width: number, height: number) {
  const points = places.filter(place => !place.mapPositionPending).map(toMapView);
  const xs = points.length ? points.map(p => p.x) : [0, MAP_WIDTH];
  const ys = points.length ? points.map(p => p.y) : [0, MAP_HEIGHT];
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(width / Math.max(104, maxX - minX + 56), height / Math.max(66, maxY - minY + 48));
  return { x: (width - (minX + maxX) * scale) / 2, y: (height - (minY + maxY) * scale) / 2, scale };
}

const s = StyleSheet.create({
  frame: { flex: 1, overflow: 'hidden', backgroundColor: background },
  backdrop: { position: 'absolute', overflow: 'hidden' },
  hit: { position: 'absolute', width: 48, height: 48, justifyContent: 'center', alignItems: 'center' },
  activeHit: { zIndex: 1 },
  pin: { width: 23, height: 23, borderRadius: 12, borderWidth: 2, borderColor: '#fff', backgroundColor: c.green, alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: c.rust, width: 32, height: 32, borderRadius: 16 },
  accuracy: { position: 'absolute', backgroundColor: '#367fc626', borderColor: '#367fc680', borderWidth: 1 },
  sampleDot: { opacity: 0.7 },
  liveDot: { position: 'absolute', zIndex: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: '#256cb1', borderWidth: 2, borderColor: '#fff' },
  label: { position: 'absolute', top: 34, width: 43, alignItems: 'center' },
  fullLabel: { width: 138, top: 40 },
  labelText: { color: c.ink, backgroundColor: '#fffdf6', borderRadius: 3, paddingHorizontal: 3, fontSize: 10, lineHeight: 14, fontWeight: '600', textAlign: 'center' },
  attribution: { position: 'absolute', bottom: 4, left: 6, fontSize: 10, color: c.ink, backgroundColor: '#fffdf6' },
  pending: { position: 'absolute', bottom: 8, alignSelf: 'center', backgroundColor: '#fffdf6', padding: 6, borderRadius: 6 },
});
