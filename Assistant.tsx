import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, Linking, Modal, PanResponder, ScrollView, StyleSheet, View } from 'react-native';
import type { ModalProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from './AppIcon';
import { askAssistant, assistantErrors } from './assistantApi';
import type { AssistantAnswer, AssistantHistory, AssistantSource } from './assistantApi';
import { getPlace, placeName } from './campus';
import { useLanguage } from './LanguageProvider';
import { translate } from './localization';
import { colors as c } from './theme';
import { Alert, Pressable, Text, TextInput } from './ui';
import { KeyboardLayout } from './KeyboardLayout';

export type AssistantTarget = { kind: 'route'; id: string } | { kind: 'guide'; id: string; pageKey?: string };
type Turn = { id: number; question: string; result?: AssistantAnswer; error?: string };
type Host = symbol;
type Point = { x: number; y: number };
type RenderTarget = (target: AssistantTarget, onBack: () => void, active: boolean) => ReactNode;
type AssistantContextValue = {
  turns: Turn[];
  draft: string;
  setDraft: (draft: string) => void;
  busy: boolean;
  send: (question: string, retryId?: number) => Promise<void>;
  chatHost: Host | null;
  openChat: (host: Host) => void;
  closeChat: (host: Host) => void;
  renderTarget: RenderTarget;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);
const prompts = ['哪些教学楼有插座？', '如何申请 JULAC 卡？', '主图书馆今天几点关门？'];

export function AssistantProvider({ children, renderTarget }: { children: ReactNode; renderTarget: RenderTarget }) {
  const { language } = useLanguage();
  const [chatHost, setChatHost] = useState<Host | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const closeChat = useCallback((host: Host) => setChatHost(current => current === host ? null : current), []);

  async function send(value: string, retryId?: number) {
    const question = value.trim();
    if (!question || inFlight.current) return;
    const turn = { id: retryId ?? ++sequence.current, question };
    const prior = retryId === undefined ? turns : turns.filter(item => item.id < retryId);
    const history = prior.filter(item => item.result).slice(-3).flatMap((item): AssistantHistory[] => [
      { role: 'user', content: item.question }, { role: 'assistant', content: item.result!.answer.slice(0, 800) },
    ]);
    inFlight.current = true;
    setBusy(true);
    if (retryId === undefined) setDraft('');
    setTurns(current => retryId === undefined ? [...current.slice(-19), turn] : current.map(item => item.id === retryId ? turn : item));
    try {
      const result = await askAssistant(question, language, history);
      setTurns(current => current.map(item => item.id === turn.id ? { ...turn, result } : item));
    } catch (error) {
      const message = error instanceof Error ? error.message : assistantErrors.assistant_unavailable;
      setTurns(current => current.map(item => item.id === turn.id ? { ...turn, error: message } : item));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <AssistantContext.Provider value={{ turns, draft, setDraft, busy, send, chatHost, openChat: setChatHost, closeChat, renderTarget }}>
    {children}
  </AssistantContext.Provider>;
}

function useAssistant() {
  const context = useContext(AssistantContext);
  if (!context) throw new Error('AssistantProvider is missing');
  return context;
}

async function openOfficialSource(value?: string) {
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    const permitted = url.hostname === 'hku.hk' || url.hostname.endsWith('.hku.hk');
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !permitted) throw new Error();
    await Linking.openURL(url.href);
  } catch {
    Alert.alert('暂时无法打开来源');
  }
}

function SourceRow({ source, onOpen }: { source: AssistantSource; onOpen: (target: AssistantTarget) => void }) {
  const type = source.kind;
  const action = type === 'place' ? '去这里' : type === 'guide' ? '打开指南' : '查看官网';
  const icon = type === 'place' ? 'walk' : type === 'guide' ? 'book' : 'external';
  const place = type === 'place' ? getPlace(source.id) : undefined;
  return <Pressable accessibilityRole="button" onPress={() => {
    if (type === 'web') void openOfficialSource(source.url);
    else if (type === 'place') onOpen({ kind: 'route', id: source.id });
    else onOpen({ kind: 'guide', id: source.id, pageKey: source.pageKey });
  }} style={({ pressed }) => [s.source, pressed && s.pressed]}>
    <View style={s.sourceIcon}><AppIcon name={icon} size={18} /></View>
    <View style={s.grow}><Text raw style={s.sourceTitle}>{place ? placeName(place) : source.title}</Text>
      {source.detail ? <Text raw numberOfLines={3} style={s.caption}>{source.detail}</Text> : null}
      <Text style={s.sourceAction}>{action}</Text>
    </View>
    <AppIcon name="chevron" size={16} color={c.muted} />
  </Pressable>;
}

function AssistantPanel({ close, onOpen }: { close: () => void; onOpen: (target: AssistantTarget) => void }) {
  const { turns, draft, setDraft, busy, send } = useAssistant();
  const { language } = useLanguage();
  const list = useRef<ComponentRef<typeof ScrollView>>(null);
  const last = turns.at(-1);
  return <KeyboardLayout>
    <View style={s.header}>
      <View style={s.headerMark}><AppIcon name="comment" size={22} /></View>
      <Text accessibilityRole="header" style={s.title}>问港大</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭校园助手" style={s.iconButton} onPress={close}><AppIcon name="close" /></Pressable>
    </View>
    <ScrollView ref={list} style={s.grow} contentContainerStyle={s.thread} keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}>
      {turns.length === 0 ? <View style={s.empty}>
        <Text style={s.intro}>找校园地点、查学生指南，或查看港大官网资料。</Text>
        {prompts.map(prompt => <Pressable key={prompt} accessibilityRole="button" style={({ pressed }) => [s.prompt, pressed && s.pressed]}
          onPress={() => setDraft(translate(prompt, language))}><Text style={s.promptText}>{prompt}</Text><AppIcon name="arrow" size={16} /></Pressable>)}
      </View> : null}
      {turns.map(turn => <View key={turn.id} style={s.turn}>
        <View style={s.question}><Text raw style={s.text}>{turn.question}</Text></View>
        {turn.result ? <View style={s.answer}>
          <Text raw selectable style={s.text}>{turn.result.answer}</Text>
          {turn.result.sources.length ? <View style={s.sources}>
            <Text style={s.sourceHeading}>来源与地点</Text>
            {turn.result.sources.map(source => <SourceRow key={`${source.kind}:${source.id}`} source={source} onOpen={onOpen} />)}
          </View> : null}
        </View> : turn.error ? <View style={s.feedback} accessibilityLiveRegion="polite">
          <Text style={s.text}>{turn.error}</Text>
          {turn === last && !busy ? <Pressable accessibilityRole="button" onPress={() => void send(turn.question, turn.id)} style={s.retry}>
            <AppIcon name="refresh" size={17} /><Text style={s.sourceAction}>重试</Text></Pressable> : null}
        </View> : <View style={s.loading} accessibilityLiveRegion="polite"><ActivityIndicator color={c.green} /><Text style={s.caption}>正在查找校园资料…</Text></View>}
      </View>)}
    </ScrollView>
    <View style={s.composer}>
      <TextInput accessibilityLabel="输入校园问题" placeholder="输入校园问题" value={draft} onChangeText={setDraft} maxLength={500} multiline style={s.input} />
      <Pressable accessibilityRole="button" accessibilityLabel="发送问题" accessibilityState={{ disabled: busy || !draft.trim() }}
        disabled={busy || !draft.trim()} style={({ pressed }) => [s.send, (busy || !draft.trim()) && s.disabled, pressed && s.pressed]}
        onPress={() => { Keyboard.dismiss(); void send(draft); }}><AppIcon name="arrow" color={c.surface} size={22} /></Pressable>
    </View>
  </KeyboardLayout>;
}

function FloatingLauncher({ open, modal, restingBottom }: { open: () => void; modal: boolean; restingBottom: number }) {
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [launcher, setLauncher] = useState({ width: 0, height: 0 });
  const [position, setPosition] = useState<Point | null>(null);
  const right = modal ? insets.right : 0;
  const left = modal ? insets.left : 0;
  const top = modal ? insets.top : 0;
  const bottom = modal ? insets.bottom : 0;
  const bounds = useMemo(() => ({
    minX: 12 + left, minY: 12 + top,
    maxX: Math.max(12 + left, size.width - launcher.width - 12 - right),
    maxY: Math.max(12 + top, size.height - launcher.height - 12 - bottom),
  }), [size, launcher, left, right, top, bottom]);
  const constrain = useCallback(({ x, y }: Point) => ({
    x: Math.max(bounds.minX, Math.min(bounds.maxX, x)), y: Math.max(bounds.minY, Math.min(bounds.maxY, y)),
  }), [bounds]);
  const anchor = constrain(position ?? { x: bounds.maxX, y: size.height - launcher.height - restingBottom - bottom });
  const latest = useRef(anchor);
  latest.current = anchor;
  const dragBounds = useRef({ bounds, constrain });
  dragBounds.current = { bounds, constrain };
  const dragStart = useRef(anchor);
  const drag = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, move) => Math.abs(move.dx) + Math.abs(move.dy) > 8,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { dragStart.current = latest.current; },
    onPanResponderMove: (_, move) => setPosition(dragBounds.current.constrain({ x: dragStart.current.x + move.dx, y: dragStart.current.y + move.dy })),
    onPanResponderRelease: (_, move) => {
      const { bounds, constrain } = dragBounds.current;
      const end = constrain({ x: dragStart.current.x + move.dx, y: dragStart.current.y + move.dy });
      setPosition({ x: end.x < (bounds.minX + bounds.maxX) / 2 ? bounds.minX : bounds.maxX, y: end.y });
    },
  }), []);
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={({ nativeEvent: { layout } }) => {
    setSize(current => current.width === layout.width && current.height === layout.height ? current : { width: layout.width, height: layout.height });
  }}>
    <View collapsable={false} style={[s.launcherPosition, size.width > 0 && launcher.width > 0
      ? { left: 0, top: 0, transform: [{ translateX: anchor.x }, { translateY: anchor.y }] }
      : { right: 12 + right, bottom: restingBottom + bottom }]} {...drag.panHandlers}>
      <Pressable testID="assistant-launcher" accessibilityRole="button" accessibilityLabel="AI Ask HKU" onPress={open}
        onLayout={({ nativeEvent: { layout: { width, height } } }) => {
          setLauncher(current => current.width === width && current.height === height ? current : { width, height });
        }}
        style={({ pressed }) => [s.launcher, pressed && s.pressed]}>
        <View style={s.launcherBadge}><Text raw style={s.launcherBadgeText}>AI</Text></View>
        <Text raw style={s.launcherLabel}>Ask HKU</Text>
      </Pressable>
    </View>
  </View>;
}

type LayerHandle = { back: () => boolean };

export const AssistantHost = forwardRef<LayerHandle, { children: ReactNode; modal?: boolean; restingBottom?: number }>(function AssistantHost({ children, modal = false, restingBottom = 86 }, ref) {
  const { chatHost, openChat, closeChat, renderTarget } = useAssistant();
  const [host] = useState<Host>(() => Symbol());
  const [target, setTarget] = useState<AssistantTarget | null>(null);
  const showingChat = chatHost === host;
  const covered = showingChat || target !== null;
  const close = useCallback(() => { Keyboard.dismiss(); closeChat(host); }, [closeChat, host]);
  const closeTarget = useCallback(() => { setTarget(null); openChat(host); }, [host, openChat]);
  const back = useCallback(() => {
    if (showingChat) { close(); return true; }
    if (target) { closeTarget(); return true; }
    return false;
  }, [showingChat, target, close, closeTarget]);
  useImperativeHandle(ref, () => ({ back }), [back]);
  useEffect(() => () => closeChat(host), [closeChat, host]);
  const body = target ? renderTarget(target, closeTarget, !showingChat) : null;
  const handlesHardwareBack = showingChat || Boolean(target && (target.kind !== 'guide' || !body));
  useEffect(() => {
    if (modal || !handlesHardwareBack) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', back);
    return () => listener.remove();
  }, [back, modal, handlesHardwareBack]);
  const edges = modal ? undefined : [];

  return <View style={s.grow}>
    <View style={s.grow} accessibilityElementsHidden={covered} importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}>
      {children}
    </View>
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, s.layer]}>
      {target ? <SafeAreaView edges={edges} style={[StyleSheet.absoluteFill, s.page]} accessibilityViewIsModal
        accessibilityElementsHidden={showingChat} importantForAccessibility={showingChat ? 'no-hide-descendants' : 'auto'}>
        {body ?? <View style={s.missing}>
          <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={closeTarget} style={s.iconButton}><AppIcon name="back" /></Pressable>
          <Text style={s.text}>这条校园资料暂时无法打开。</Text>
        </View>}
      </SafeAreaView> : null}
      <View pointerEvents={showingChat ? 'none' : 'box-none'} style={[StyleSheet.absoluteFill, showingChat && s.invisible]}
        accessibilityElementsHidden={showingChat} importantForAccessibility={showingChat ? 'no-hide-descendants' : 'auto'}>
        <FloatingLauncher modal={modal} restingBottom={target ? 86 : restingBottom} open={() => { Keyboard.dismiss(); openChat(host); }} />
      </View>
      {showingChat ? <SafeAreaView edges={edges} style={[StyleSheet.absoluteFill, s.page]} accessibilityViewIsModal>
        <AssistantPanel close={close} onOpen={next => { close(); setTarget(next); }} />
      </SafeAreaView> : null}
    </View>
  </View>;
});

export function AppModal({ children, onRequestClose, ...props }: ModalProps) {
  const layer = useRef<LayerHandle>(null);
  return <Modal {...props} onRequestClose={event => { if (!layer.current?.back()) onRequestClose?.(event); }}>
    <AssistantHost modal ref={layer}>{children}</AssistantHost>
  </Modal>;
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  invisible: { opacity: 0 },
  layer: { zIndex: 20 },
  page: { backgroundColor: c.app },
  launcherPosition: { position: 'absolute' },
  launcher: { minHeight: 54, borderRadius: 999, backgroundColor: c.green, borderWidth: 1.5, borderColor: '#f8f4dd',
    flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 7, paddingRight: 14, paddingVertical: 7,
    elevation: 5, shadowColor: c.greenDark,
    shadowOpacity: 0.23, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } },
  launcherBadge: { minWidth: 35, minHeight: 35, borderRadius: 11, backgroundColor: '#ffc779',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  launcherBadgeText: { color: '#382514', fontSize: 16, lineHeight: 21, fontWeight: '700' },
  launcherLabel: { color: '#fffdf0', fontSize: 16, lineHeight: 21, fontWeight: '700' },
  pressed: { opacity: 0.74 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 64,
    borderBottomWidth: 1, borderColor: c.line },
  headerMark: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 23, lineHeight: 30, fontWeight: '600', color: c.ink },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  thread: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 22, gap: 22 },
  empty: { gap: 8 },
  intro: { fontSize: 16, lineHeight: 24, color: c.ink, marginBottom: 8 },
  prompt: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    paddingHorizontal: 14, paddingVertical: 10, backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 10 },
  promptText: { flexShrink: 1, fontSize: 14, lineHeight: 21, color: c.green },
  turn: { gap: 12 },
  question: { alignSelf: 'flex-end', maxWidth: '86%', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: c.tint },
  answer: { gap: 12 },
  text: { fontSize: 15, lineHeight: 23, color: c.ink },
  caption: { fontSize: 13, lineHeight: 19, color: c.muted },
  sources: { gap: 6 },
  sourceHeading: { color: c.muted, fontSize: 13, lineHeight: 19, marginBottom: 2 },
  source: { flexDirection: 'row', alignItems: 'center', minHeight: 58, padding: 10, gap: 10,
    borderColor: c.line, borderWidth: 1, borderRadius: 10, backgroundColor: c.surface },
  sourceIcon: { width: 34, height: 34, borderRadius: 9, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' },
  sourceTitle: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: c.ink },
  sourceAction: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: c.green },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 42 },
  feedback: { padding: 12, backgroundColor: c.paper, borderRadius: 10 },
  retry: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: 48, gap: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderColor: c.line },
  input: { flex: 1, minHeight: 48, maxHeight: 112, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: c.line,
    backgroundColor: c.surface, color: c.ink, fontSize: 15, lineHeight: 22 },
  send: { width: 48, height: 48, borderRadius: 10, backgroundColor: c.green, justifyContent: 'center', alignItems: 'center' },
  disabled: { opacity: 0.48 },
  missing: { padding: 16, alignItems: 'flex-start', gap: 8 },
});
