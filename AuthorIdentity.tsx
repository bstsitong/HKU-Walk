import { createContext, useContext, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import AppIcon from './AppIcon';
import type { Account } from './communityApi';
import type { AuthorProfile } from './guideApi';
import { t } from './localization';
import { colors as c } from './theme';
import { Image, Pressable, Text } from './ui';

export const OpenAuthorProfile = createContext<(id: string) => void>(() => {});

export function accountAuthor(user: Account['user']): AuthorProfile {
  return { name: user.nickname || user.username, avatarUrl: user.avatarUrl || '' };
}

export function Avatar({ uri, size = 36 }: { uri?: string; size?: number }) {
  const [failedUri, setFailedUri] = useState<string>();
  const dimensions = { width: size, height: size, borderRadius: size / 2 };
  return <View style={[s.avatar, dimensions]}>
    {uri && uri !== failedUri
      ? <Image source={{ uri }} style={dimensions} resizeMode="cover" onError={() => setFailedUri(uri)} />
      : <AppIcon name="user" size={Math.round(size * 0.54)} color={c.green} />}
  </View>;
}

export function AuthorByline({ author, detail, size = 28, link = true, onOpenProfile }: {
  author: AuthorProfile; detail?: string; size?: number; link?: boolean; onOpenProfile?: (id: string) => void;
}) {
  const openProfile = useContext(OpenAuthorProfile);
  const profileId = link ? author.profileId : undefined;
  const identity = <>
    <Avatar uri={author.avatarUrl} size={size} />
    <View style={s.identity}>
      <Text raw={!author.anonymous} style={[s.name, profileId && s.linkName]}>{author.name}</Text>
      {detail ? <Text raw style={s.detail}>{detail}</Text> : null}
    </View>
  </>;
  return profileId ? <Pressable testID={`author-profile-${profileId}`} accessibilityRole="button" accessibilityHint={t('打开作者主页')}
    onPress={() => (onOpenProfile || openProfile)(profileId)} style={[s.row, s.link]}>{identity}</Pressable> : <View style={s.row}>{identity}</View>;
}

const s = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', backgroundColor: c.tint, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  link: { minHeight: 48, alignSelf: 'flex-start' },
  linkName: { color: c.green, textDecorationLine: 'underline' },
  identity: { flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 },
  name: { color: c.ink, fontSize: 13, fontWeight: '600', lineHeight: 20, flexShrink: 1 },
  detail: { color: c.muted, fontSize: 12, lineHeight: 18 },
});
