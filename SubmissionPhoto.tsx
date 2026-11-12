import { useEffect, useState } from 'react';
import { ActivityIndicator, ImageProps, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { API_BASE } from './guideApi';
import { colors as c } from './theme';
import { Image, Text } from './ui';

let nextPhoto = 0;
type ResolvedPhoto = { uri: string; token: string; local: string | null };

export default function SubmissionPhoto({ uri, token, style, showStatus = true, ...props }: Omit<ImageProps, 'source'> & { uri: string; token?: string; showStatus?: boolean }) {
  const auth = uri.startsWith(API_BASE + '/api/images/') ? token : undefined;
  const [resolved, setResolved] = useState<ResolvedPhoto>();
  useEffect(() => {
    if (!auth) return;
    const controller = new AbortController();
    let local: string | undefined;
    let file: File | undefined;
    const remove = () => {
      if (local && Platform.OS === 'web') URL.revokeObjectURL(local);
      try { if (file?.exists) file.delete(); } catch { /* The system can evict cache files. */ }
    };
    (async () => {
      try {
        const response = await fetch(uri, { signal: controller.signal, cache: 'no-store', headers: { Authorization: `Bearer ${auth}` } });
        if (!response.ok) throw new Error('Image download failed');
        if (Platform.OS === 'web') {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          local = URL.createObjectURL(blob);
        } else {
          const bytes = await response.arrayBuffer();
          if (controller.signal.aborted) return;
          file = new File(Paths.cache, `hku-submission-${Date.now()}-${++nextPhoto}.jpg`);
          file.create();
          file.writeSync(bytes);
          local = file.uri;
        }
        setResolved({ uri, token: auth, local });
      } catch {
        remove();
        if (!controller.signal.aborted) setResolved({ uri, token: auth, local: null });
      }
    })();
    return () => { controller.abort(); remove(); };
  }, [uri, auth]);
  if (!auth) return <Image source={{ uri }} style={style} {...props} />;
  const photo = resolved?.uri === uri && resolved.token === auth ? resolved.local : undefined;
  if (photo) return <Image source={{ uri: photo }} style={style} {...props} />;
  if (!showStatus) return null;
  return <View style={[style as StyleProp<ViewStyle>, s.placeholder]}>
    {photo === null ? <Text style={s.feedback}>图片暂时无法加载</Text> : <ActivityIndicator color={c.green} />}
  </View>;
}

const s = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  feedback: { color: c.muted, fontSize: 13 },
});
