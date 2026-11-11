import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import AppIcon from './AppIcon';
import { Avatar } from './AuthorIdentity';
import { Account, ApiError, DiscussionKind, fetchComments, sendComment } from './communityApi';
import type { DiscussionComment } from './guideApi';
import { formatDate, t } from './localization';
import { colors as c } from './theme';
import { Alert, Pressable, Text, TextInput } from './ui';

type Props = {
  kind: DiscussionKind; id: string; title: string; session: Account | null;
  onLogin: (expired?: boolean) => void; onCount?: (count: number) => void;
};

export function PlaceDiscussion({ onBack, ...props }: Omit<Props, 'kind'> & { onBack: () => void }) {
  const back = () => { Keyboard.dismiss(); onBack(); };
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => listener.remove();
  }, [onBack]);
  return <View style={s.flex}>
    <View style={s.header}>
      <Pressable testID="place-comments-back" accessibilityRole="button" accessibilityLabel="返回" onPress={back} style={s.iconButton}>
        <AppIcon name="back" size={20} />
      </Pressable>
      <Text accessibilityRole="header" style={s.heading}>地点评论</Text>
    </View>
    <Discussion kind="place" {...props} />
  </View>;
}

export default function Discussion({ kind, id, title, session, onLogin, onCount }: Props) {
  const [items, setItems] = useState<DiscussionComment[]>([]);
  const [count, setCount] = useState<number>();
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const posting = useRef(false);
  const fetching = useRef(false);
  const requestId = useRef<string | null>(null);
  const token = session?.token;
  const updateCount = (total: number) => { setCount(total); onCount?.(total); };
  const load = async (page = 1) => {
    if (fetching.current || posting.current) return;
    fetching.current = true;
    setLoading(true); setFailed(false);
    try {
      const result = await fetchComments(kind, id, page);
      setItems(current => page === 1 ? result.comments : [...current, ...result.comments.filter(item => !current.some(previous => previous.id === item.id))]);
      setNextPage(result.nextPage);
      updateCount(result.count);
    } catch { setFailed(true); }
    finally { fetching.current = false; setLoading(false); }
  };
  useEffect(() => { void load(); }, [kind, id]);

  const askLogin = (expired = false) => Alert.alert('登录后才能评论', undefined, [{ text: '取消', style: 'cancel' }, { text: '去登录', onPress: () => onLogin(expired) }]);
  const post = async () => {
    if (!token) { askLogin(); return; }
    if (!body.trim() || posting.current || fetching.current) return;
    posting.current = true; setSending(true);
    requestId.current ??= 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, value => {
      const digit = Math.floor(Math.random() * 16);
      return (value === 'x' ? digit : (digit & 3) | 8).toString(16);
    });
    try {
      const result = await sendComment(token, kind, id, body, requestId.current);
      setItems(current => [result.comment, ...current.filter(item => item.id !== result.comment.id)]);
      updateCount(result.commentCount);
      setBody(''); requestId.current = null; Keyboard.dismiss();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) askLogin(true);
      else Alert.alert('评论发送失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally { posting.current = false; setSending(false); }
  };

  return <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView style={s.flex} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={c.green} />}>
      <View style={s.summary}>
        <Text raw accessibilityRole="header" style={s.heading}>{title}</Text>
        {count === undefined ? null : <Text style={s.meta}>{t('{count} 条评论', { count })}</Text>}
      </View>
      {items.map(item => <View key={item.id} style={s.comment}>
        <Avatar uri={item.authorProfile?.avatarUrl} />
        <View style={s.flex}>
          <View style={s.byline}>
            <Text raw style={s.author}>{item.authorProfile?.name || item.author}</Text>
            <Text raw style={s.meta}>{formatDate(item.createdAt)}</Text>
          </View>
          <Text raw style={s.body}>{item.body}</Text>
        </View>
      </View>)}
      {loading && !items.length ? <ActivityIndicator color={c.green} style={s.empty} /> : null}
      {failed ? <Pressable accessibilityRole="button" onPress={() => void load()} style={s.action}><Text style={s.actionText}>重新加载</Text></Pressable> : null}
      {!items.length && !loading && !failed ? <Text style={s.empty}>还没有评论</Text> : null}
      {nextPage ? <Pressable accessibilityRole="button" disabled={loading || sending} onPress={() => void load(nextPage)} style={s.action}><Text style={s.actionText}>查看更多评论</Text></Pressable> : null}
    </ScrollView>
    <View style={s.composer}>
      {session ? <>
        <Avatar uri={session.user.avatarUrl} size={32} />
        <TextInput testID={`${kind}-comment-input`} accessibilityLabel="写评论" placeholder="写评论" value={body} maxLength={1000} multiline editable={!sending}
          onChangeText={value => { requestId.current = null; setBody(value); }} style={s.input} />
        <Pressable testID={`${kind}-comment-submit`} accessibilityRole="button" disabled={!body.trim() || loading || sending} onPress={() => void post()}
          style={[s.action, (!body.trim() || loading || sending) && s.disabled]}><Text style={s.actionText}>发布评论</Text></Pressable>
      </> : <Pressable testID={`${kind}-comment-guest`} accessibilityRole="button" onPress={() => askLogin()} style={s.guestInput}>
        <AppIcon name="comment" size={18} color={c.muted} /><Text style={s.meta}>写评论</Text>
      </Pressable>}
    </View>
  </KeyboardAvoidingView>;
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  header: { width: '100%', maxWidth: 650, alignSelf: 'center', minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  page: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 24 },
  summary: { paddingBottom: 12, gap: 4, borderBottomWidth: 1, borderBottomColor: c.line },
  heading: { color: c.ink, fontSize: 18, fontWeight: '600', lineHeight: 25, flexShrink: 1 },
  comment: { flexDirection: 'row', gap: 10, borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 14 },
  byline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 },
  author: { fontSize: 14, lineHeight: 20, color: c.ink, fontWeight: '600', flexShrink: 1 },
  meta: { color: c.muted, fontSize: 13, lineHeight: 20 },
  body: { fontSize: 15, lineHeight: 22, color: c.ink, marginTop: 2 },
  empty: { paddingVertical: 24, color: c.muted, fontSize: 14 },
  composer: { width: '100%', maxWidth: 650, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.app },
  input: { flex: 1, minHeight: 48, maxHeight: 120, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: c.line, borderRadius: 12, backgroundColor: c.surface, color: c.ink, fontSize: 14 },
  guestInput: { flex: 1, minHeight: 48, paddingHorizontal: 12, alignItems: 'center', flexDirection: 'row', gap: 8, backgroundColor: c.tint, borderRadius: 12 },
  action: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 4, maxWidth: '45%' },
  actionText: { color: c.green, fontSize: 13, lineHeight: 20, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
