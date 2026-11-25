import { StyleSheet, View } from 'react-native';
import type { Place } from './campus';
import { useLanguage } from './LanguageProvider';
import useContentTranslation from './useContentTranslation';
import { Pressable, Text } from './ui';
import { colors as c } from './theme';

export default function PlaceIntroduction({ place, active }: { place: Place; active: boolean }) {
  const { language } = useLanguage();
  const translation = useContentTranslation(place.description?.trim() ? {
    kind: 'place', id: place.id, sourceVersion: place.updatedAt ?? '', texts: [place.description],
  } : undefined, language, active);
  if (!place.description?.trim()) return null;
  if (translation.texts) return <Text testID="place-introduction" raw style={s.body}>{translation.texts[0]}</Text>;
  return <View>
    {translation.loading ? <Text testID="place-introduction-loading" accessibilityLiveRegion="polite" style={s.body}>正在翻译地点简介…</Text> : null}
    {translation.error ? <>
      <Text accessibilityLiveRegion="polite" style={s.body}>地点简介翻译暂时不可用，请重试。</Text>
      <Pressable testID="retry-place-translation" accessibilityRole="button" onPress={translation.retry} style={s.retry}><Text style={s.retryText}>重新翻译</Text></Pressable>
    </> : null}
  </View>;
}

const s = StyleSheet.create({
  body: { fontSize: 14, color: c.muted, lineHeight: 20 },
  retry: { minHeight: 48, alignSelf: 'flex-start', justifyContent: 'center' },
  retryText: { color: c.green, fontSize: 14, lineHeight: 20, fontWeight: '600' },
});
