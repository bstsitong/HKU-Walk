import { createContext, useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Dimensions, Keyboard, Platform, ScrollView, StyleSheet, TextInput, View, type KeyboardMetrics, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function keyboardScreenTop(frame: KeyboardMetrics | null | undefined, bottomInset: number) {
  if (!frame || frame.screenY <= 0) return undefined;
  // In an edge-to-edge Android activity, the visible frame can still end at the
  // navigation bar even while the IME is displayed over it.
  return Platform.OS === 'android'
    ? Math.min(frame.screenY, Dimensions.get('screen').height - frame.height - bottomInset)
    : frame.screenY;
}

// Android can resize a modal window itself while leaving the main window edge-to-edge.
// Measure the overlap so each window only makes room for the part it still covers.
export function KeyboardLayout({ children }: { children: ReactNode }) {
  const view = useRef<ComponentRef<typeof View>>(null);
  const { bottom } = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(() => Keyboard.metrics());
  const keyboardTop = keyboardScreenTop(keyboard, bottom);
  const [overlap, setOverlap] = useState(0);
  const updateOverlap = useCallback(() => {
    if (keyboardTop === undefined) {
      setOverlap(0);
      return;
    }
    view.current?.measureInWindow((_x, y, _width, height) => {
      setOverlap(Math.max(0, y + height - keyboardTop));
    });
  }, [keyboardTop]);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow', event => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboard(event.endCoordinates);
    });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', event => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboard(undefined);
    });
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(updateOverlap, [updateOverlap]);

  return <View ref={view} collapsable={false} onLayout={updateOverlap} style={styles.flex}>
    <View style={[styles.flex, { paddingBottom: overlap }]}>{children}</View>
  </View>;
}

export const FormInputFocus = createContext<(() => void) | undefined>(undefined);

export function FormScrollView(props: ScrollViewProps) {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const height = useRef(0);
  const offset = useRef(0);
  const frame = useRef<number | undefined>(undefined);
  const revealInput = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const input = TextInput.State.currentlyFocusedInput();
      const content = scroll.current?.getInnerViewRef();
      if (!input || !content || !height.current) return;
      input.measureLayout(content, (_x, top, _width, inputHeight) => {
        if (input !== TextInput.State.currentlyFocusedInput()) return;
        const gap = 12;
        const visibleInputHeight = Math.min(inputHeight, Math.max(0, height.current - 2 * gap));
        const neededOffset = top + visibleInputHeight + gap - height.current;
        if (neededOffset > offset.current) scroll.current?.scrollTo({ y: neededOffset, animated: false });
      }, () => {});
    });
  }, []);

  useEffect(() => () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
  }, []);

  return <FormInputFocus.Provider value={revealInput}>
    <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled" {...props}
      ref={scroll} scrollEventThrottle={16}
      onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; }}
      onLayout={event => {
        const nextHeight = event.nativeEvent.layout.height;
        if (nextHeight < height.current) revealInput();
        height.current = nextHeight;
      }} />
  </FormInputFocus.Provider>;
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
