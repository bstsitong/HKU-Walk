import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppIcon from './AppIcon';
import { AppModal } from './Assistant';
import { Avatar } from './AuthorIdentity';
import { ApiError, fetchPublicProfile, PublicProfile } from './communityApi';
import { colors as c } from './theme';
import { Pressable, Text } from './ui';

export default function PublicProfileScreen({ id, onBack, onOpenPost }: {
  id: string; onBack: () => void; onOpenPost: (id: string) => void;
}) {
  const [profile, setProfile] = useState<PublicProfile>();
  const [error, setError] = useState<'private' | 'network'>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setError(undefined);
    fetchPublicProfile(id).then(({ profile }) => {
      if (live) setProfile(profile);
    }).catch(cause => {
      if (live) setError(cause instanceof ApiError && cause.status === 404 ? 'private' : 'network');
    });
    return () => { live = false; };
  }, [id, retry]);

  return <AppModal animationType="slide" onRequestClose={onBack}>
    <SafeAreaView style={s.shell} accessibilityViewIsModal>
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={onBack} style={s.back}>
          <AppIcon name="back" size={20} />
        </Pressable>
        <Text accessibilityRole="header" style={s.heading}>个人主页</Text>
      </View>
      <ScrollView contentContainerStyle={s.page}>
        {profile ? <>
          <View style={s.profile}>
            <Avatar uri={profile.avatarUrl} size={56} />
            <View style={s.identity}>
              <Text raw style={s.name}>{profile.name}</Text>
              {profile.bio ? <Text raw style={s.body}>{profile.bio}</Text> : null}
            </View>
          </View>
          <Text accessibilityRole="header" style={s.section}>公开帖子</Text>
          {profile.posts.length ? profile.posts.map(post => <Pressable key={post.id} accessibilityRole="button" style={s.row} onPress={() => onOpenPost(post.id)}>
            <Text raw style={s.post}>{post.title}</Text><AppIcon name="chevron" size={16} />
          </Pressable>) : <Text style={s.body}>暂无公开帖子</Text>}
        </> : error === 'private' ? <Text style={s.body}>此主页未公开。</Text> : error === 'network' ?
          <Pressable accessibilityRole="button" style={s.row} onPress={() => setRetry(value => value + 1)}>
            <Text style={s.body}>暂时无法读取主页。</Text><Text style={s.post}>重新加载</Text>
          </Pressable> : <ActivityIndicator color={c.green} />}
      </ScrollView>
    </SafeAreaView>
  </AppModal>;
}

const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: c.app },
  header: { width: '100%', maxWidth: 650, alignSelf: 'center', minHeight: 56, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 22, lineHeight: 28, color: c.ink, fontWeight: '600' },
  page: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 24 },
  identity: { flex: 1, gap: 4 },
  name: { fontSize: 22, lineHeight: 28, color: c.ink, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 21, color: c.muted },
  section: { fontSize: 16, lineHeight: 22, color: c.ink, fontWeight: '600', marginBottom: 8 },
  row: { minHeight: 48, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: c.line },
  post: { flex: 1, fontSize: 15, lineHeight: 21, color: c.green },
});
