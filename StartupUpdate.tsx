import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import * as Updates from 'expo-updates';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage } from './LanguageProvider';
import { translate } from './localization';
import { colors } from './theme';
import { Text } from './ui';

const CHECK_TIMEOUT = 3000;
const DOWNLOAD_TIMEOUT = 25000;
const copy = {
  checking: '正在检查更新…',
  downloading: '正在下载更新…',
  applying: '正在启用新版…',
};

type Stage = 'checking' | 'downloading' | 'applying' | 'ready';

export default function StartupUpdate({ children }: { children: ReactNode }) {
  if (Platform.OS !== 'android' || __DEV__ || !Updates.isEnabled) return <>{children}</>;
  return <AndroidStartupUpdate>{children}</AndroidStartupUpdate>;
}

function AndroidStartupUpdate({ children }: { children: ReactNode }) {
  const { language } = useLanguage();
  const { downloadProgress } = Updates.useUpdates();
  const [stage, setStage] = useState<Stage>('checking');

  useEffect(() => {
    let active = true;
    let timeout = setTimeout(enterApp, CHECK_TIMEOUT);

    function enterApp() {
      if (active) setStage('ready');
      active = false;
      clearTimeout(timeout);
    }

    async function update() {
      try {
        const available = await Updates.checkForUpdateAsync();
        if (!active) return;
        if (!available.isAvailable && !available.isRollBackToEmbedded) return enterApp();
        clearTimeout(timeout);
        timeout = setTimeout(enterApp, DOWNLOAD_TIMEOUT);
        setStage('downloading');
        const downloaded = await Updates.fetchUpdateAsync();
        if (!active) return;
        if (!downloaded.isNew && !downloaded.isRollBackToEmbedded) return enterApp();
        setStage('applying');
        await Updates.reloadAsync();
      } catch {
        enterApp();
      }
    }

    void update();
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, []);

  if (stage === 'ready') return <>{children}</>;
  const percent = stage === 'downloading' && typeof downloadProgress === 'number'
    ? Math.max(0, Math.min(100, Math.round(downloadProgress * 100)))
    : undefined;
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Text raw style={styles.title}>HKU-Walk</Text>
        <Text raw accessibilityLiveRegion="polite" style={styles.status}>{translate(copy[stage], language)}</Text>
        {percent === undefined
          ? <ActivityIndicator color={colors.green} style={styles.indicator} />
          : <View style={styles.track} accessible accessibilityRole="progressbar"
              accessibilityLabel={translate(copy.downloading, language)} accessibilityValue={{ min: 0, max: 100, now: percent }}>
              <View style={[styles.fill, { width: `${percent}%` }]} />
            </View>}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.app, padding: 24 },
  body: { width: '100%', maxWidth: 280, alignItems: 'center', gap: 14 },
  title: { color: colors.greenDark, fontSize: 28, fontWeight: '700' },
  status: { color: colors.muted, textAlign: 'center', fontSize: 15 },
  indicator: { height: 20 },
  track: { width: '100%', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.tint, marginVertical: 7 },
  fill: { height: '100%', backgroundColor: colors.green },
});
