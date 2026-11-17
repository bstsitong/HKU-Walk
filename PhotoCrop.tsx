import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, type GestureResponderEvent, Keyboard, Modal, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { PickedImage } from './communityApi';
import { centeredCrop, cropPixels, cropScale, MAX_CROP_ZOOM, moveCrop, type CropPosition, type Point } from './cropGeometry';
import { colors as c } from './theme';
import { Image, Pressable, Text } from './ui';

type CropOptions = { aspect?: number; circle?: boolean };
type CropSource = { uri: string; width: number; height: number };
type CropJob = { source: CropSource; options: CropOptions; finish: (image: PickedImage | null) => void };
type ImageRef = Awaited<ReturnType<ReturnType<typeof ImageManipulator.manipulate>['renderAsync']>>;
export function usePhotoPicker() {
  const [job, setJob] = useState<CropJob | null>(null);
  const active = useRef(false);
  const finishPending = useRef<CropJob['finish'] | null>(null);
  useEffect(() => () => finishPending.current?.(null), []);

  async function pick(options: CropOptions = {}) {
    if (active.current) return null;
    active.current = true;
    Keyboard.dismiss();
    let source: ImageRef | undefined;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (result.canceled || !result.assets[0]) return null;
      const context = ImageManipulator.manipulate(result.assets[0].uri, { maxWidth: 3072, maxHeight: 3072 });
      try { source = await context.renderAsync(); } finally { context.release(); }
      const preview = await source.saveAsync({ format: SaveFormat.JPEG, compress: .96 });
      return await new Promise<PickedImage | null>(resolve => {
        finishPending.current = resolve;
        setJob({ source: preview, options, finish: resolve });
      });
    } catch {
      throw new Error('暂时无法选择图片，请重试。');
    } finally {
      source?.release();
      finishPending.current = null;
      active.current = false;
    }
  }
  function finish(image: PickedImage | null) {
    setJob(null);
    job?.finish(image);
  }
  return { pickPhoto: pick, cropEditor: job ? <CropScreen job={job} finish={finish} /> : null };
}

type Touch = GestureResponderEvent['nativeEvent']['touches'][number];
function sample(touches: readonly Touch[]) {
  const [first, second] = touches;
  if (!first) return null;
  if (!second) return { key: String(first.identifier), point: { x: first.pageX, y: first.pageY }, span: 0 };
  return {
    key: [first.identifier, second.identifier].sort().join(':'),
    point: { x: (first.pageX + second.pageX) / 2, y: (first.pageY + second.pageY) / 2 },
    span: Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY),
  };
}

function CropScreen({ job, finish }: { job: CropJob; finish: (image: PickedImage | null) => void }) {
  const { source, options } = job;
  const window = useWindowDimensions();
  const aspect = options.aspect ?? source.width / source.height;
  const width = Math.min(540, window.width - 44, Math.max(120, window.height - 266) * aspect);
  const frame = { width, height: width / aspect };
  const [position, setPosition] = useState(centeredCrop);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(false);
  const latest = useRef(position);
  const busy = useRef(false);
  const view = useRef<ComponentRef<typeof View>>(null);
  const frameCenter = useRef<Point>({ x: 0, y: 0 });
  const baseline = useRef<{ position: CropPosition; sample: NonNullable<ReturnType<typeof sample>> } | null>(null);
  const update = (next: CropPosition) => { latest.current = next; setPosition(next); };
  const measure = () => view.current?.measure((_x, _y, w, h, px, py) => {
    frameCenter.current = { x: px + w / 2, y: py + h / 2 };
  });
  useEffect(() => { update(centeredCrop); }, [frame.width, frame.height]);
  function start(touches: readonly Touch[]) {
    const next = sample(touches);
    baseline.current = next && { position: latest.current, sample: next };
  }

  function move(touches: readonly Touch[]) {
    const next = sample(touches), before = baseline.current;
    if (!next || busy.current) return;
    if (!before || before.sample.key !== next.key) { start(touches); return; }
    const from = before.sample;
    const local = (point: Point) => ({ x: point.x - frameCenter.current.x, y: point.y - frameCenter.current.y });
    update(moveCrop(before.position, source, frame, before.position.zoom * (from.span ? next.span / from.span : 1),
      local(from.point), local(next.point)));
  }
  const origin = { x: 0, y: 0 };
  const zoomBy = (factor: number) => update(moveCrop(latest.current, source, frame, latest.current.zoom * factor, origin, origin));
  const scale = cropScale(source, frame, position.zoom);
  const imageWidth = source.width * scale, imageHeight = source.height * scale;
  const cancel = () => { if (!busy.current) finish(null); };
  async function confirm() {
    if (busy.current) return;
    busy.current = true; setWorking(true); setError(false);
    const crop = cropPixels(latest.current, source, frame);
    let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
    let output: ImageRef | undefined;
    try {
      context = ImageManipulator.manipulate(source.uri);
      context.crop(crop);
      if (Math.max(crop.width, crop.height) > 1600) {
        context.resize(crop.width >= crop.height ? { width: 1600 } : { height: 1600 });
      }
      output = await context.renderAsync();
      const image = await output.saveAsync({ format: SaveFormat.JPEG, compress: .92 });
      const blob = Platform.OS === 'web' ? await fetch(image.uri).then(response => response.blob()) : undefined;
      finish({ uri: image.uri, name: 'photo.jpg', type: 'image/jpeg', blob });
    } catch {
      setError(true);
    } finally {
      output?.release(); context?.release();
      busy.current = false; setWorking(false);
    }
  }
  return <Modal animationType="fade" presentationStyle="fullScreen" onRequestClose={cancel}>
    <SafeAreaProvider><SafeAreaView style={s.page}>
      <View style={s.header}>
        <Pressable accessibilityRole="button" disabled={working} onPress={cancel} style={s.action}><Text style={s.link}>取消</Text></Pressable>
        <Text accessibilityRole="header" style={s.title}>裁剪图片</Text>
        <View style={s.action} />
      </View>
      <View style={s.workspace}>
        <View ref={view} collapsable={false} onLayout={measure} testID="photo-crop-frame"
          style={[s.frame, frame, options.circle && { borderRadius: width / 2 }]}
          onTouchStart={({ nativeEvent: { touches } }) => { measure(); start(touches); }}
          onTouchMove={({ nativeEvent: { touches } }) => move(touches)}
          onTouchEnd={({ nativeEvent: { touches, changedTouches } }) => {
            const finalTouches = new Map([...touches, ...changedTouches].map(touch => [touch.identifier, touch]));
            move([...finalTouches.values()]);
            start(touches);
          }}
          onTouchCancel={() => { baseline.current = null; }}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Image source={{ uri: source.uri }} resizeMode="stretch" accessible={false} style={{
              position: 'absolute', width: imageWidth, height: imageHeight,
              left: (width - imageWidth) / 2 + position.x, top: (frame.height - imageHeight) / 2 + position.y,
            }} />
          </View>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.outline, options.circle && { borderRadius: width / 2 }]} />
          <View pointerEvents="none" style={[s.verticalLine, { left: '33.333%' }]} />
          <View pointerEvents="none" style={[s.verticalLine, { left: '66.667%' }]} />
          <View pointerEvents="none" style={[s.horizontalLine, { top: '33.333%' }]} />
          <View pointerEvents="none" style={[s.horizontalLine, { top: '66.667%' }]} />
        </View>
        <Text style={s.help}>拖动调整位置，双指缩放。</Text>
        <View style={s.tools}>
          <Pressable testID="photo-crop-out" accessibilityRole="button" accessibilityLabel="缩小图片" disabled={working || position.zoom <= 1} onPress={() => zoomBy(1 / 1.3)} style={[s.control, position.zoom <= 1 && s.disabled]}><Text raw style={s.symbol}>−</Text></Pressable>
          <Pressable testID="photo-crop-in" accessibilityRole="button" accessibilityLabel="放大图片" disabled={working || position.zoom >= MAX_CROP_ZOOM} onPress={() => zoomBy(1.3)} style={[s.control, position.zoom >= MAX_CROP_ZOOM && s.disabled]}><Text raw style={s.symbol}>+</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={working} onPress={() => update(centeredCrop)} style={s.control}><Text style={s.link}>重置</Text></Pressable>
        </View>
      </View>
      <View style={s.footer}>
        {error ? <Text accessibilityRole="alert" style={s.error}>裁剪失败，请重试。</Text> : null}
        <Pressable testID="photo-crop-confirm" accessibilityRole="button" disabled={working} onPress={() => void confirm()} style={s.confirm}>
          {working ? <ActivityIndicator color="#fff" /> : <Text style={s.confirmText}>确认裁剪</Text>}
        </Pressable>
      </View>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.app },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 54 },
  action: { minHeight: 48, width: 64, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: c.ink, fontSize: 19, fontWeight: '700' },
  workspace: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  frame: { overflow: 'hidden', backgroundColor: c.paper, borderRadius: 3 },
  outline: { borderWidth: 1, borderColor: '#fff' },
  verticalLine: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: '#ffffffb0' },
  horizontalLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: '#ffffffb0' },
  help: { marginTop: 12, color: c.muted, fontSize: 13, textAlign: 'center' },
  tools: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  control: { minHeight: 44, minWidth: 48, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.line, borderRadius: 8, backgroundColor: c.surface },
  disabled: { opacity: .4 },
  symbol: { fontSize: 21, color: c.green },
  link: { color: c.green, fontSize: 14, fontWeight: '600' },
  footer: { paddingHorizontal: 16, paddingBottom: 12, width: '100%', maxWidth: 572, alignSelf: 'center' },
  confirm: { minHeight: 48, backgroundColor: c.green, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  error: { color: c.rust, marginBottom: 8, textAlign: 'center' },
});
