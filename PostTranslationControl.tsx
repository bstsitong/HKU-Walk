import { StyleSheet, View } from 'react-native';
import { Pressable, Text } from './ui';
import { colors as c } from './theme';
import type usePostTranslation from './usePostTranslation';

export default function PostTranslationControl({ translation }: { translation: ReturnType<typeof usePostTranslation> }) {
  if (!translation.eligible) return null;
  const label = translation.loading ? '正在翻译…' : translation.visible ? '显示原文' : translation.error ? '重新翻译' : '显示翻译';
  return <View style={s.group}>
    <Pressable testID="post-translation" accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ expanded: translation.visible, busy: translation.loading, disabled: translation.loading }} disabled={translation.loading}
      onPress={() => void translation.toggle()} style={({ pressed }) => [s.button, pressed && s.pressed]}>
      <Text style={s.label}>{label}</Text>
    </Pressable>
    {translation.error ? <Text accessibilityLiveRegion="polite" style={s.error}>{translation.error}</Text> : null}
  </View>;
}

const s = StyleSheet.create({
  group: { alignItems: 'flex-start', marginVertical: 4 },
  button: { minHeight: 48, justifyContent: 'center', paddingRight: 16 },
  label: { color: c.green, fontSize: 14, lineHeight: 21, fontWeight: '600' },
  pressed: { opacity: 0.65 },
  error: { color: c.rust, fontSize: 12, lineHeight: 18, marginBottom: 8 },
});
