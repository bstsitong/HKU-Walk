import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { campusMapSvg, MAP_BACKGROUND, MAP_HEIGHT, MAP_WIDTH, MAP_Y_MAX } from './MapArtwork';
import AppIcon from './AppIcon';
import { Category, Place, filterPlaces, getPlace, mapPlace, placeName } from './campus';
import { Pressable, Text } from './ui';
import { useLanguage } from './LanguageProvider';
import { colors as c } from './theme';
import { translate } from './localization';
import type { CampusLocation, MapPoint } from './campusLocation';
import { mapBand, mapCandidates, MAX_MAP_ZOOM, MIN_MAP_ZOOM, toMapView } from './mapCamera';
import useMapCamera from './useMapCamera';
import { facilityMarkerInput, layoutMapMarkers, placeMarkerInput, type MapItem } from './mapMarkers';
import { campusFacilities, CampusFacility, facilityName, facilityStyles } from './campusFacilities';
import { mapPinSizes, mapPlaceSymbol, placeDisplayLevel, visibleMapLevel, type MapDisplayLevel } from './mapDisplay';

const pinTouchSize = 48;
const labelTextPadding = 8;
const layoutZoom = { 1: 1.4, 2: 2, 3: 2.9, 4: MAX_MAP_ZOOM } as const;
const levelStartZoom = { 1: MIN_MAP_ZOOM, 2: 1.4, 3: 2, 4: 2.9 } as const;
type ScreenMarker = MapPoint & { diameter: number; item: MapItem };

export default function MapCanvas({ selected, category = 'all', zoom = MIN_MAP_ZOOM, onZoomChange, onSelect, catalogVersion, variant = 'home', origin, sampleLocation = false, livePosition, centerTick = 0, facilitiesOnly = false, facilities = campusFacilities, onFacilitySelect }: {
  selected: Place; category?: Category; zoom?: number; onZoomChange?: (zoom: number) => void; onSelect?: (place: Place) => void;
  catalogVersion?: object;
  variant?: 'home' | 'route' | 'mini'; origin?: Place; sampleLocation?: boolean; livePosition?: CampusLocation; centerTick?: number;
  facilitiesOnly?: boolean; facilities?: readonly CampusFacility[]; onFacilitySelect?: (facilities: readonly CampusFacility[]) => void;
}) {
  const { language } = useLanguage();
  const [viewport, setViewport] = useState({ width: 360, height: 540 });
  const home = variant === 'home';
  const campusGate = getPlace('gate') ?? selected;
  const samplePoint = { x: campusGate.x + 14, y: campusGate.y + 28, radius: 10 };
  const position = home ? livePosition ?? (sampleLocation ? samplePoint : undefined) : undefined;
  const target = mapPlace(selected);
  const { camera, surface, handlers } = useMapCamera(viewport, zoom, centerTick, position ?? target, onZoomChange);
  const start = origin && mapPlace(origin);
  const endpoints = start && start.id !== target.id && variant === 'route' ? [start, target] : [target];
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
  const displayLevel = visibleMapLevel(camera.zoom);
  const showPassages = facilitiesOnly || (home ? camera.zoom >= 1.4 : frame.scale >= 1.4);
  const showFacilityMarkers = home && !!onFacilitySelect && (facilitiesOnly || category === 'all');
  const referenceZoom = layoutZoom[displayLevel];
  const referenceScale = viewport.width * referenceZoom / MAP_WIDTH;
  const layout = useMemo(() => {
    if (!home) return null;
    const items = facilitiesOnly ? [] :
      mapCandidates(filterPlaces(category), '', category, levelStartZoom[displayLevel]).map(placeMarkerInput);
    if (showFacilityMarkers) {
      for (const facility of facilities) {
        if (!facilitiesOnly && (facility.kind === 'gate' || facility.displayLevel > displayLevel)) continue;
        if (facilitiesOnly && !facility.overview && displayLevel === 1) continue;
        items.push(facilityMarkerInput(facility));
      }
    }
    return layoutMapMarkers(items, referenceScale);
  }, [home, category, catalogVersion, facilitiesOnly, facilities, showFacilityMarkers, displayLevel, referenceScale]);
  const sizeFactor = layout ? layout.factor * camera.zoom / referenceZoom : 1;
  const markers: ScreenMarker[] = layout
    ? layout.pins.map(({ item, point }) => {
        const level = 'place' in item ? placeDisplayLevel(item.place) : item.facility.displayLevel;
        return { ...toScreen({ x: point.x, y: point.y / MAP_HEIGHT * MAP_Y_MAX }),
          diameter: mapPinSizes[level].diameter * sizeFactor, item };
      }).filter(onMap)
    : endpoints.filter(place => !place.mapPositionPending && !place.parentBuildingId).map(place => ({
        ...toScreen(place), diameter: mapPinSizes[placeDisplayLevel(place)].diameter, item: { place },
      }));
  const svg = useMemo(() => campusMapSvg(label => translate(label, language), showPassages), [language, showPassages]);
  const mapWidth = MAP_WIDTH * frame.scale;
  const mapHeight = MAP_HEIGHT * frame.scale;
  const touchSize = (point: ScreenMarker) => Math.max(point.diameter, Math.min(pinTouchSize,
    ...markers.filter(other => other !== point).map(other => Math.max(Math.abs(other.x - point.x), Math.abs(other.y - point.y)) - 2),
  ));
  const occupiedLabels: LabelBounds[] = [];
  const labelFor = (point: ScreenMarker, hitSize: number, level: MapDisplayLevel, name: string, abbreviation?: string) => {
    const size = mapPinSizes[level];
    const left = Math.max(4, Math.min(point.x - size.labelWidth / 2, viewport.width - size.labelWidth - 4));
    const labelTop = point.y + point.diameter / 2 + 3;
    for (const label of abbreviation && abbreviation !== name ? [name, abbreviation] : [name]) {
      // Approximate glyph widths to reserve room before native text has measured.
      const width = Math.min(size.labelWidth, Math.ceil([...label].reduce((width, character) =>
        width + (/^[\x00-\x7F]$/.test(character) ? 0.63 : 1) * size.text, labelTextPadding)));
      const center = left + size.labelWidth / 2;
      const bounds = { x: center - width / 2 - 2, y: labelTop, width: width + 4, height: size.text + 6 };
      if (home && (bounds.y + bounds.height > band.top + band.height ||
          occupiedLabels.some(other => boundsOverlap(bounds, other)) ||
          markers.some(marker => boundsOverlap(bounds, {
            x: marker.x - marker.diameter / 2, y: marker.y - marker.diameter / 2,
            width: marker.diameter, height: marker.diameter,
          })))) continue;
      occupiedLabels.push(bounds);
      return <View pointerEvents="none" style={[s.label, {
        left: left - point.x + hitSize / 2, top: labelTop - point.y + hitSize / 2, width: size.labelWidth,
      }]}><Text raw numberOfLines={1} style={[s.labelText, { fontSize: size.text, lineHeight: size.text + 4 }]}>{label}</Text></View>;
    }
    return null;
  };

  return <View ref={surface} collapsable={false} {...(home ? handlers : undefined)}
    onLayout={({ nativeEvent: { layout } }) => setViewport({ width: Math.max(1, layout.width), height: Math.max(1, layout.height) })} style={s.frame}>
    <View pointerEvents="none" style={[s.backdrop, { left: frame.x, top: frame.y, width: mapWidth, height: mapHeight }]}>
      <SvgXml xml={svg} width="100%" height="100%" accessible={false} />
      {marker && radius > 0 ? <View style={[s.accuracy, { left: marker.x - frame.x - radius, top: marker.y - frame.y - radius, width: radius * 2, height: radius * 2, borderRadius: radius }]} /> : null}
    </View>
    {markers.map(pin => {
      const { item, x, y, diameter } = pin;
      const hit = home ? touchSize(pin) : pinTouchSize;
      const placement = { left: x - hit / 2, top: y - hit / 2, width: hit, height: hit };
      if ('place' in item) {
        const { place } = item;
        const active = place.id === target.id;
        const level = placeDisplayLevel(place);
        const iconSize = mapPinSizes[level].icon * sizeFactor;
        const { color, icon } = mapPlaceSymbol(place);
        const name = placeName(place, language);
        return <Pressable key={place.id} testID={`pin-${place.id}`} accessibilityRole="button"
          accessibilityLabel={name} accessibilityState={{ selected: active }} disabled={!onSelect}
          onPress={() => onSelect?.(place)} style={[s.hit, placement, active && s.activeHit]}>
          <View style={[s.pin, { backgroundColor: color, width: diameter, height: diameter, borderRadius: diameter / 2,
            borderWidth: (active ? 2.5 : 1.5) * sizeFactor, borderColor: active ? '#fff8de' : '#fff' }]}>
            <AppIcon name={icon} size={iconSize} color="#fff" />
          </View>
          {labelFor(pin, hit, level, name, place.abbreviation)}
        </Pressable>;
      }
      const { facility } = item;
      const { icon, color } = facilityStyles[facility.kind];
      const { icon: iconSize } = mapPinSizes[facility.displayLevel];
      const name = facilityName(facility, language);
      return <Pressable key={`facility-${facility.id}`} testID={`facility-${facility.id}`} accessibilityRole="button"
        accessibilityLabel={name} onPress={() => onFacilitySelect?.([facility])}
        style={({ pressed }) => [s.hit, placement, pressed && { opacity: 0.7 }]}>
        <View style={[s.facilityPin, { borderColor: color, width: diameter, height: diameter, borderRadius: 6 * sizeFactor, borderWidth: sizeFactor }]}>
          <AppIcon name={icon} color={color} size={iconSize * sizeFactor} />
        </View>
        {labelFor(pin, hit, facility.displayLevel, name)}
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

type LabelBounds = { x: number; y: number; width: number; height: number };
function boundsOverlap(a: LabelBounds, b: LabelBounds) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
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
  frame: { flex: 1, overflow: 'hidden', backgroundColor: MAP_BACKGROUND },
  backdrop: { position: 'absolute', overflow: 'hidden' },
  hit: { position: 'absolute', width: pinTouchSize, height: pinTouchSize, justifyContent: 'center', alignItems: 'center' },
  activeHit: { zIndex: 1 },
  pin: { borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  facilityPin: { borderRadius: 6, borderWidth: 1, backgroundColor: '#fffdf6', alignItems: 'center', justifyContent: 'center' },
  accuracy: { position: 'absolute', backgroundColor: '#367fc626', borderColor: '#367fc680', borderWidth: 1 },
  sampleDot: { opacity: 0.7 },
  liveDot: { position: 'absolute', zIndex: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: '#256cb1', borderWidth: 2, borderColor: '#fff' },
  label: { position: 'absolute', alignItems: 'center' },
  labelText: { color: c.ink, backgroundColor: '#fffdf6', borderRadius: 3, paddingHorizontal: 3, fontSize: 10, lineHeight: 14, fontWeight: '600', textAlign: 'center' },
  attribution: { position: 'absolute', bottom: 4, left: 6, fontSize: 10, color: c.ink, backgroundColor: '#fffdf6' },
  pending: { position: 'absolute', bottom: 8, alignSelf: 'center', backgroundColor: '#fffdf6', padding: 6, borderRadius: 6 },
});
