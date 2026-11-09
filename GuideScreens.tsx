import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Alert, Image, Pressable, Text } from './ui';
import { t } from './localization';
import { colors } from './theme';
import AppIcon, { IconName } from './AppIcon';
import { GuideEntry, GuideKey } from './guideApi';

type Bookmarks = { saved: string[]; ready: boolean; toggle: (id: string) => void };
const green = '#184d3e';
const ink = '#203a31';
const muted = colors.muted;
const icons: Record<GuideKey, IconName> = { links: 'link', tips: 'tips', food: 'food', groups: 'groups' };
export async function openLink(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('暂时无法打开链接', '请检查网络后重试。');
  }
}

export function EntryCard({ entry, category, bookmarks, onOpenContent, onVisit }: { entry: GuideEntry; category: GuideKey; bookmarks: Bookmarks; onOpenContent?: (entry: GuideEntry) => void; onVisit?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [entry.imageUrl]);
  const saved = bookmarks.saved.includes(entry.id);
  const isLink = category === 'links';
  const hasImage = Boolean(entry.imageUrl) && !imageFailed;
  const showEntry = () => {
    onVisit?.(entry.id);
    if (isLink) void openLink(entry.externalUrl);
    else setExpanded(value => !value);
  };
  const imageLabel = t('内容配图：{title}', { title: entry.isCommunity === false ? t(entry.title) : entry.title });
  return (
    <View style={s.entry}>
      <View style={s.entryHeader}>
        <Pressable accessibilityRole={isLink ? 'link' : 'button'} accessibilityState={isLink ? undefined : { expanded }}
          testID={`guide-entry-${entry.id}`}
          onPress={showEntry}
          style={s.entrySummary}>
          <View style={[s.entrySymbol, category === 'food' && s.foodSymbol]}><AppIcon name={icons[category] ?? 'book'} size={20} color={category === 'food' ? colors.rust : green} /></View>
          <View style={s.flex}>
            <Text raw={entry.isCommunity !== false} style={s.entryTitle}>{entry.title}</Text>
            {isLink ? <Text raw={entry.isCommunity !== false} style={s.meta}>{entry.body}</Text> : null}
            {entry.isExample ? <Text style={s.example}>内容示例</Text> : null}
          </View>
          <View style={!isLink && expanded ? s.chevronOpen : undefined}><AppIcon name={isLink ? 'external' : 'chevron'} size={16} /></View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t(saved ? '取消收藏：{title}' : '收藏：{title}', { title: entry.title })}
          accessibilityState={{ selected: saved, disabled: !bookmarks.ready }}
          disabled={!bookmarks.ready} onPress={() => bookmarks.toggle(entry.id)} style={s.iconButton}>
          <AppIcon name="saved" color={saved ? '#a14630' : muted} size={19} />
        </Pressable>
      </View>
      {expanded && !isLink ? (
        <View style={s.entryBody}>
          <Text raw={entry.isCommunity !== false} style={s.body}>{entry.body}</Text>
          {entry.mapType && onOpenContent ? <Pressable accessibilityRole="button" onPress={() => onOpenContent(entry)} style={s.smallAction}><AppIcon name={entry.mapType === 'route' ? 'walk' : 'pin'} size={17} /><Text style={s.actionText}>{entry.mapType === 'route' ? '查看这条路线' : '在地图查看地点'}</Text></Pressable> : null}
          {hasImage ? (
            <Image source={{ uri: entry.imageUrl }} accessibilityLabel={imageLabel} style={s.contentImage}
              resizeMode="cover" onError={() => setImageFailed(true)} />
          ) : null}
          {entry.externalUrl ? (
            <Pressable accessibilityRole="link" onPress={() => void openLink(entry.externalUrl)} style={s.smallAction}>
              <Text style={s.actionText}>{category === 'groups' ? '打开入群链接' : '查看相关链接'}</Text><AppIcon name="external" size={16} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  meta: { fontSize: 12, color: muted, lineHeight: 20 },
  body: { fontSize: 14, color: muted, lineHeight: 24 },
  smallAction: { alignSelf: 'flex-start', minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.tint, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  actionText: { color: green, fontSize: 13, lineHeight: 20, fontWeight: '600', flexShrink: 1 },

  entry: { backgroundColor: colors.surface, borderRadius: 12, marginBottom: 12, overflow: 'hidden' },
  entryHeader: { flexDirection: 'row', alignItems: 'center', paddingRight: 2 },
  entrySummary: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, minHeight: 72 },
  entrySymbol: { width: 32, minHeight: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint, borderRadius: 8 },
  entryTitle: { color: ink, fontSize: 15, fontWeight: '600', lineHeight: 24 },
  example: { fontSize: 11, color: '#89412e', marginTop: 4, lineHeight: 16 },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  entryBody: { paddingHorizontal: 16, paddingBottom: 16 },
  contentImage: { width: '100%', height: 168, borderRadius: 8, marginTop: 12 },
  foodSymbol: { backgroundColor: colors.rustLight },
});
