import { ComponentRef, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { MAP_ART } from './MapArtwork';
import AppIcon from './AppIcon';
import { Category, Place, filterPlaces, placeIcon, placeName } from './campus';
import { Pressable, Text } from './ui';
import { useLanguage } from './LanguageProvider';
import { colors as c } from './theme';
import { translate } from './localization';

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const samplePoint = { x: 104, y: 468 };
export default function MapCanvas({ selected, category = 'all', zoom = 1, onSelect, variant = 'home', origin, sampleLocation = false, centerTick = 0 }: {
  selected: Place; category?: Category; zoom?: number; onSelect?: (place: Place) => void;
  variant?: 'home' | 'route' | 'mini'; origin?: Place; sampleLocation?: boolean; centerTick?: number;
}) {
  const { language } = useLanguage();
  const [viewport, setViewport] = useState({ width: 360, height: 540 });
  const horizontal = useRef<ComponentRef<typeof ScrollView>>(null);
  const vertical = useRef<ComponentRef<typeof ScrollView>>(null);
  const home = variant === 'home';
  const markers = variant === 'route' && origin ? [origin, selected] : home ? filterPlaces(category) : [selected];
  const width = home ? Math.max(360, viewport.width) * zoom : viewport.width;
  // Leave room to pan the southern entrance above the floating place card.
  const height = home ? width * 580 / 360 + viewport.height / 2 : viewport.height;
  let box = { x: 0, y: 0, width: 360, height: home ? height * 360 / width : 580 };
  if (!home) {
    const points = origin && variant === 'route' ? [origin, selected, { x: 129, y: 416 }, { x: 244, y: 296 }] : [selected];
    const minX = Math.min(...points.map(p => p.x)) - 45, minY = Math.min(...points.map(p => p.y)) - 42;
    const wantedWidth = Math.max(170, Math.max(...points.map(p => p.x)) - minX + 45);
    const wantedHeight = Math.max(125, Math.max(...points.map(p => p.y)) - minY + 42);
    const scale = Math.max(wantedWidth / width, wantedHeight / height);
    box = { x: minX + wantedWidth / 2 - width * scale / 2, y: minY + wantedHeight / 2 - height * scale / 2, width: width * scale, height: height * scale };
  }
  const route = origin && variant === 'route' ? `<path d="M${origin.x} ${origin.y}L${origin.x} 416H129V296H244V${selected.y}H${selected.x}" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M${origin.x} ${origin.y}L${origin.x} 416H129V296H244V${selected.y}H${selected.x}" fill="none" stroke="#28735c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  const location = home && sampleLocation ? `<circle cx="${samplePoint.x}" cy="${samplePoint.y}" r="23" fill="#6799ba" opacity=".16"/><circle cx="${samplePoint.x}" cy="${samplePoint.y}" r="7" fill="#4384b0" stroke="white" stroke-width="3"/>` : '';
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.width} ${box.height}">${MAP_ART.replace('MAIN CAMPUS', esc(translate('本部校园', language)))}${route}${location}</svg>`;
  useEffect(() => {
    if (!home) return;
    const scale = width / 360;
    const focus = centerTick ? samplePoint : selected;
    const timer = setTimeout(() => {
      horizontal.current?.scrollTo({ x: Math.max(0, focus.x * scale - viewport.width / 2), animated: true });
      vertical.current?.scrollTo({ y: Math.max(0, focus.y * scale - viewport.height / 2), animated: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [zoom, centerTick]);
  const artwork = <View style={{ width, height }}>
    <SvgXml key={language} xml={xml} width={width} height={height} accessible={false} />
    {markers.map((p, index) => <Pressable key={p.id + index} testID={`pin-${p.id}`} accessibilityRole="button" accessibilityLabel={placeName(p)}
      accessibilityState={{ selected: p.id === selected.id }} disabled={!onSelect}
      onPress={() => onSelect?.(p)} style={[s.hit, { left: (p.x - box.x) / box.width * width - 24, top: (p.y - box.y) / box.height * height - 24 }]}>
      <View style={[s.pin, p.id === selected.id && s.selected]}><AppIcon name={placeIcon(p)} size={16} color="#fff" /></View>
      <View pointerEvents="none" style={{ position: 'absolute', top: 43, left: -44, width: 136 }}><Text raw style={{ fontSize: 10, lineHeight: 14, color: c.muted, textAlign: 'center' }}>{p.isCommunity ? p.name : translate(p.name, language)}</Text></View>
    </Pressable>)}
  </View>;
  return <View onLayout={event => setViewport(event.nativeEvent.layout)} style={s.frame}>
    {home ? <ScrollView ref={horizontal} horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} bounces={false}>
      <ScrollView ref={vertical} nestedScrollEnabled showsVerticalScrollIndicator={false} bounces={false}>{artwork}</ScrollView>
    </ScrollView> : artwork}
  </View>;
}
const s = StyleSheet.create({ frame: { flex: 1, overflow: 'hidden', backgroundColor: '#e9eee1' }, hit: { position: 'absolute', width: 48, height: 48, justifyContent: 'center', alignItems: 'center' }, pin: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#fff', backgroundColor: '#66865b', alignItems: 'center', justifyContent: 'center' }, selected: { backgroundColor: c.rust, width: 34, height: 34, borderRadius: 17 } });
