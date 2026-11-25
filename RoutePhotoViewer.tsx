import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, type GestureResponderEvent, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppIcon from './AppIcon';
import { Image, Pressable, Text } from './ui';
import { colors as c } from './theme';

type Position = { zoom: number; x: number; y: number };
type Touch = GestureResponderEvent['nativeEvent']['touches'][number];
const initial: Position = { zoom: 1, x: 0, y: 0 };
const MAX_ZOOM = 5;
function sample(touches: readonly Touch[]) {
  const [a, b] = touches;
  if (!a) return null;
  return b
    ? { key: [a.identifier, b.identifier].sort().join(':'), x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2, span: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) }
    : { key: String(a.identifier), x: a.pageX, y: a.pageY, span: 0 };
}

export default function RoutePhotoViewer({ uri, title, subtitle, onClose, inline = false, dark = false }: {
  uri: string; title: string; subtitle?: string; onClose: () => void; inline?: boolean; dark?: boolean;
}) {
  const [position, setPosition] = useState(initial);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [source, setSource] = useState({ width: 1, height: 1 });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(position);
  const stage = useRef<ComponentRef<typeof View>>(null);
  const center = useRef({ x: 0, y: 0 });
  const baseline = useRef<{ position: Position; touch: NonNullable<ReturnType<typeof sample>> } | null>(null);
  const scale = Math.min(frame.width / source.width, frame.height / source.height);
  const width = source.width * scale, height = source.height * scale;
  function update(next: Position) {
    const zoom = Math.max(1, Math.min(MAX_ZOOM, next.zoom));
    const limitX = Math.max(0, (width * zoom - frame.width) / 2);
    const limitY = Math.max(0, (height * zoom - frame.height) / 2);
    const value = { zoom, x: Math.max(-limitX, Math.min(limitX, next.x)), y: Math.max(-limitY, Math.min(limitY, next.y)) };
    latest.current = value;
    setPosition(value);
  }
  useEffect(() => { latest.current = initial; setPosition(initial); baseline.current = null; }, [frame.width, frame.height]);
  function start(touches: readonly Touch[]) {
    const touch = sample(touches);
    baseline.current = touch && { position: latest.current, touch };
  }
  function move(touches: readonly Touch[]) {
    const touch = sample(touches), before = baseline.current;
    if (!touch || status !== 'ready') return;
    if (!before || before.touch.key !== touch.key) { start(touches); return; }
    const zoom = Math.max(1, Math.min(MAX_ZOOM, before.position.zoom * (before.touch.span ? touch.span / before.touch.span : 1)));
    const ratio = zoom / before.position.zoom;
    update({ zoom,
      x: touch.x - center.current.x - (before.touch.x - center.current.x - before.position.x) * ratio,
      y: touch.y - center.current.y - (before.touch.y - center.current.y - before.position.y) * ratio,
    });
  }
  const content = <View style={[s.screen, dark && s.dark]}>
      <View style={[s.header, inline && s.inlineHeader]}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" onPress={onClose} style={s.control}><AppIcon name="back" color={dark ? c.surface : c.green} /></Pressable>
        <Text raw accessibilityRole="header" numberOfLines={2} style={[s.title, dark && s.white]}>{title}</Text>
      </View>
      {subtitle ? <Text raw style={[s.subtitle, dark && s.white]}>{subtitle}</Text> : null}
      <View ref={stage} style={[s.stage, dark && s.dark]} onLayout={event => {
        setFrame(event.nativeEvent.layout);
        stage.current?.measureInWindow((x, y, w, h) => { center.current = { x: x + w / 2, y: y + h / 2 }; });
      }} onStartShouldSetResponder={() => status === 'ready'} onMoveShouldSetResponder={() => status === 'ready'}
        onResponderGrant={event => {
          stage.current?.measureInWindow((x, y, w, h) => { center.current = { x: x + w / 2, y: y + h / 2 }; });
          start(event.nativeEvent.touches);
        }} onResponderMove={event => move(event.nativeEvent.touches)}
        onResponderRelease={() => { baseline.current = null; }} onResponderTerminate={() => { baseline.current = null; }}
        onResponderTerminationRequest={() => false}>
        <Image key={attempt} source={{ uri }} accessibilityLabel={title} resizeMode="contain" pointerEvents="none"
          onLoad={event => { setSource(event.nativeEvent.source); setStatus('ready'); }} onError={() => setStatus('error')}
          style={{ width, height, opacity: status === 'ready' ? 1 : 0, transform: [{ translateX: position.x }, { translateY: position.y }, { scale: position.zoom }] }} />
        {status === 'loading' ? <ActivityIndicator style={s.feedback} color={c.surface} accessibilityLabel="正在加载图片" /> : null}
        {status === 'error' ? <View style={s.feedback}><Text style={s.error}>图片暂时无法加载</Text><Pressable accessibilityRole="button" onPress={() => { setStatus('loading'); setAttempt(value => value + 1); }} style={s.retry}><Text style={s.error}>重新加载图片</Text></Pressable></View> : null}
      </View>
      {!dark ? <Text style={s.hint}>双指缩放，放大后可拖动查看</Text> : null}
      <View style={[s.toolbar, dark && s.darkToolbar]}>
        <Pressable accessibilityRole="button" accessibilityLabel="缩小图片" disabled={status !== 'ready' || position.zoom <= 1} onPress={() => update({ ...latest.current, zoom: latest.current.zoom / 1.5 })} style={[s.control, (status !== 'ready' || position.zoom <= 1) && s.disabled]}><AppIcon name="minus" color={dark ? c.surface : c.green} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="复原图片" disabled={status !== 'ready'} onPress={() => update(initial)}><Text raw accessibilityLiveRegion="polite" style={[s.percent, dark && s.white]}>{Math.round(position.zoom * 100)}%</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="放大图片" disabled={status !== 'ready' || position.zoom >= MAX_ZOOM} onPress={() => update({ ...latest.current, zoom: latest.current.zoom * 1.5 })} style={[s.control, (status !== 'ready' || position.zoom >= MAX_ZOOM) && s.disabled]}><AppIcon name="plus" color={dark ? c.surface : c.green} /></Pressable>
        {!dark ? <Pressable accessibilityRole="button" disabled={status !== 'ready'} onPress={() => update(initial)} style={s.control}><Text style={s.reset}>复原</Text></Pressable> : null}
      </View>
      {dark ? <Text style={[s.hint, s.darkHint]}>拖动查看 · 双指缩放</Text> : null}
    </View>;
  return inline ? content : <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}><SafeAreaView style={s.screen}>{content}</SafeAreaView></Modal>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.app },
  inlineHeader: { minHeight: 56 }, header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 16 },
  title: { flex: 1, fontSize: 17, lineHeight: 24, fontWeight: '600', color: c.ink },
  control: { minWidth: 48, minHeight: 48, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, backgroundColor: c.ink, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  feedback: { position: 'absolute', alignItems: 'center', gap: 12 },
  error: { fontSize: 14, lineHeight: 22, color: c.surface },
  retry: { minHeight: 48, paddingHorizontal: 16, justifyContent: 'center', borderWidth: 1, borderColor: c.surface, borderRadius: 8 },
  hint: { fontSize: 12, lineHeight: 20, color: c.muted, textAlign: 'center', paddingTop: 12, paddingHorizontal: 16 },
  toolbar: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, paddingVertical: 8 },
  percent: { minWidth: 52, textAlign: 'center', color: c.ink, fontVariant: ['tabular-nums'] },
  reset: { fontSize: 14, lineHeight: 20, color: c.green, fontWeight: '600' },
  disabled: { opacity: 0.35 },
  dark: { backgroundColor: '#17221e' }, white: { color: c.surface }, subtitle: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: c.ink, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24 },
  darkToolbar: { alignSelf: 'center', backgroundColor: '#293b33', borderRadius: 24, marginTop: 22, paddingVertical: 0, gap: 10 }, darkHint: { color: '#e1e9e3', paddingBottom: 20 },
});
