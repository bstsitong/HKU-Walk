import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import AppIcon from './AppIcon';
import type { Account } from './communityApi';
import type { AuthorProfile } from './guideApi';
import { colors as c } from './theme';
import { Image, Text } from './ui';

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

export function AuthorByline({ author, detail }: { author: AuthorProfile; detail?: string }) {
  return <View style={s.row}>
    <Avatar uri={author.avatarUrl} size={28} />
    <View style={s.identity}>
      <Text raw style={s.name}>{author.name}</Text>
      {detail ? <Text raw style={s.detail}>{detail}</Text> : null}
    </View>
  </View>;
}

const s = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', backgroundColor: c.tint, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  identity: { flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 },
  name: { color: c.ink, fontSize: 13, fontWeight: '600', lineHeight: 20, flexShrink: 1 },
  detail: { color: c.muted, fontSize: 12, lineHeight: 18 },
});
