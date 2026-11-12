import { ComponentRef, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, TextInput as NativeTextInput, View } from 'react-native';
import AppIcon from './AppIcon';
import { AuthorByline, Avatar } from './AuthorIdentity';
import { Account, ApiError, deleteComment, DiscussionKind, fetchComments, sendComment } from './communityApi';
import type { AuthorProfile, DiscussionComment } from './guideApi';
import { formatDate, t } from './localization';
import { colors as c } from './theme';
import { Alert, Pressable, Text, TextInput } from './ui';

type Props = {
  kind: DiscussionKind; id: string; title: string; session: Account | null;
  focusCommentId?: string;
  onLogin: (expired?: boolean) => void; onCount?: (count: number) => void;
};

export function DiscussionScreen({ onBack, ...props }: Props & { onBack: () => void }) {
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
      <Text accessibilityRole="header" style={s.heading}>{props.kind === 'place' ? '地点评论' : '帖子评论'}</Text>
    </View>
    <Discussion {...props} />
  </View>;
}

export default function Discussion({ kind, id, title, session, onLogin, onCount, focusCommentId }: Props) {
  const [items, setItems] = useState<DiscussionComment[]>([]);
  const [focus, setFocus] = useState(focusCommentId);
  const [focused, setFocused] = useState<DiscussionComment | null>(null);
  const [reply, setReply] = useState<DiscussionComment | null>(null);
  const [count, setCount] = useState<number>();
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const posting = useRef(false);
  const generation = useRef(0);
  const input = useRef<ComponentRef<typeof NativeTextInput>>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const requestId = useRef<string | null>(null);
  const token = session?.token;
  const updateCount = (total: number) => { setCount(total); onCount?.(total); };
  const load = async (page = 1) => {
    if (posting.current) return;
    const version = ++generation.current;
    setLoading(true); setFailed(false);
    try {
      const result = await fetchComments(kind, id, page, focus, token);
      if (version !== generation.current) return;
      setFocused(result.focusedComment ?? null);
      setItems(current => page === 1 ? result.comments : [...current, ...result.comments.filter(item => !current.some(previous => previous.id === item.id))]);
      setNextPage(result.nextPage);
      updateCount(result.count);
    } catch { if (version === generation.current) setFailed(true); }
    finally { if (version === generation.current) setLoading(false); }
  };
  useEffect(() => { void load(); return () => { generation.current++; }; }, [kind, id, focus, token]);

  const askLogin = (expired = false) => Alert.alert('登录后才能评论', undefined, [{ text: '取消', style: 'cancel' }, { text: '去登录', onPress: () => onLogin(expired) }]);
  const selectReply = (comment: DiscussionComment | null) => {
    if (!token) { askLogin(); return; }
    setReply(comment);
    requestId.current = null;
    if (comment) input.current?.focus();
  };
  const authorOf = (item: DiscussionComment) => item.authorProfile || { name: item.author, avatarUrl: '' };
  const displayName = (author: AuthorProfile) => author.anonymous ? t('匿名用户') : author.name;
  const post = async () => {
    if (!token) { askLogin(); return; }
    if (!body.trim() || posting.current || loading) return;
    posting.current = true; setSending(true);
    requestId.current ??= 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, value => {
      const digit = Math.floor(Math.random() * 16);
      return (value === 'x' ? digit : (digit & 3) | 8).toString(16);
    });
    try {
      const result = await sendComment(token, kind, id, body, requestId.current, reply?.id);
      setItems(current => [result.comment, ...current.filter(item => item.id !== result.comment.id)]);
      updateCount(result.commentCount);
      setBody(''); setReply(null); requestId.current = null; Keyboard.dismiss();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) askLogin(true);
      else Alert.alert('评论发送失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally { posting.current = false; setSending(false); }
  };
  const remove = async (commentId: string) => {
    if (!token || posting.current || loading) return;
    posting.current = true;
    setSending(true);
    try {
      const result = await deleteComment(token, kind, id, commentId);
      const clearParent = (item: DiscussionComment) => item.replyTo?.id === commentId ? { ...item, replyTo: null } : item;
      setItems(current => current.filter(item => item.id !== commentId).map(clearParent));
      setFocused(current => current && current.id !== commentId ? clearParent(current) : null);
      if (reply?.id === commentId) { setReply(null); requestId.current = null; }
      updateCount(result.commentCount);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) askLogin(true);
      else Alert.alert('评论删除失败', error instanceof Error ? error.message : '请稍后重试。');
      return;
    } finally { posting.current = false; setSending(false); }
    void load();
  };
  const confirmDelete = (commentId: string) => Alert.alert('删除评论？', undefined, [
    { text: '取消', style: 'cancel' },
    { text: '删除', style: 'destructive', onPress: () => void remove(commentId) },
  ]);

  const renderComment = (item: DiscussionComment, highlighted = false) => (
    <View key={item.id} testID={`${kind}-comment-${item.id}`} style={[s.comment, highlighted && s.highlighted]}>
      {highlighted ? <Text style={s.focusLabel}>已定位的评论</Text> : null}
      <AuthorByline author={authorOf(item)} detail={formatDate(item.createdAt)} size={36} />
      {item.replyTo ? <Pressable accessibilityRole="button" disabled={sending} style={s.replyAction}
        onPress={() => { setFocus(item.replyTo!.id); scroll.current?.scrollTo({ y: 0 }); }}>
        <Text raw style={s.actionText}>{t('回复 {name}', { name: displayName(item.replyTo.author) })}</Text>
      </Pressable> : null}
      <Text raw style={s.body}>{item.body}</Text>
      <View style={s.commentActions}>
        <Pressable testID={`${kind}-reply-${item.id}`} accessibilityRole="button" disabled={sending} style={s.commentAction} onPress={() => selectReply(item)}>
          <Text style={s.actionText}>回复</Text>
        </Pressable>
        {item.canDelete && session ? <Pressable testID={`${kind}-delete-${item.id}`} accessibilityRole="button"
          accessibilityLabel="删除评论" disabled={sending || loading} style={s.commentAction} onPress={() => confirmDelete(item.id)}>
          <Text style={s.removeText}>删除</Text>
        </Pressable> : null}
      </View>
    </View>
  );

  return <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView ref={scroll} style={s.flex} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={c.green} />}>
      <View style={s.summary}>
        <Text raw accessibilityRole="header" style={s.heading}>{title}</Text>
        {count === undefined ? null : <Text style={s.meta}>{t('{count} 条评论', { count })}</Text>}
      </View>
      {focused?.id === focus && focused ? renderComment(focused, true) : null}
      {focus && !loading && !failed && !focused ? <Text style={s.empty}>这条评论已不可用。</Text> : null}
      {items.map(item => renderComment(item))}
      {loading && !items.length && !focused ? <ActivityIndicator color={c.green} style={s.empty} /> : null}
      {failed ? <Pressable accessibilityRole="button" onPress={() => void load()} style={s.action}><Text style={s.actionText}>重新加载</Text></Pressable> : null}
      {!items.length && !focus && !loading && !failed ? <Text style={s.empty}>还没有评论</Text> : null}
      {nextPage ? <Pressable accessibilityRole="button" disabled={loading || sending} onPress={() => void load(nextPage)} style={s.action}><Text style={s.actionText}>查看更多评论</Text></Pressable> : null}
    </ScrollView>
    {reply && session ? <View style={s.replyBar}>
      <Text raw style={[s.meta, s.flex]}>{t('回复 {name}', { name: displayName(authorOf(reply)) })}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="取消回复" disabled={sending} onPress={() => selectReply(null)} style={s.iconButton}><AppIcon name="close" size={18} /></Pressable>
    </View> : null}
    <View style={s.composer}>
      {session ? <>
        <Avatar uri={session.user.avatarUrl} size={32} />
        <TextInput ref={input} testID={`${kind}-comment-input`} accessibilityLabel="写评论" placeholder={reply ? '写回复' : '写评论'} value={body} maxLength={1000} multiline editable={!sending}
          onChangeText={value => { requestId.current = null; setBody(value); }} style={s.input} />
        <Pressable testID={`${kind}-comment-submit`} accessibilityRole="button" disabled={!body.trim() || loading || sending} onPress={() => void post()}
          style={[s.action, (!body.trim() || loading || sending) && s.disabled]}><Text style={s.actionText}>{reply ? '发布回复' : '发布评论'}</Text></Pressable>
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
  comment: { borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 12 },
  highlighted: { backgroundColor: c.tint, borderRadius: 12, paddingHorizontal: 10, marginTop: 8 },
  focusLabel: { color: c.green, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  replyAction: { minHeight: 48, alignSelf: 'flex-start', justifyContent: 'center', marginLeft: 44, paddingRight: 12 },
  commentActions: { flexDirection: 'row', marginLeft: 44, gap: 10 },
  commentAction: { minHeight: 48, minWidth: 48, paddingRight: 12, justifyContent: 'center' },
  removeText: { color: c.rust, fontSize: 13, lineHeight: 20, fontWeight: '600' },
  replyBar: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingLeft: 16, borderTopWidth: 1, borderTopColor: c.line, flexDirection: 'row', alignItems: 'center' },
  meta: { color: c.muted, fontSize: 13, lineHeight: 20 },
  body: { fontSize: 15, lineHeight: 22, color: c.ink, marginLeft: 44, marginTop: 2 },
  empty: { paddingVertical: 24, color: c.muted, fontSize: 14 },
  composer: { width: '100%', maxWidth: 650, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.app },
  input: { flex: 1, minHeight: 48, maxHeight: 120, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: c.line, borderRadius: 12, backgroundColor: c.surface, color: c.ink, fontSize: 14 },
  guestInput: { flex: 1, minHeight: 48, paddingHorizontal: 12, alignItems: 'center', flexDirection: 'row', gap: 8, backgroundColor: c.tint, borderRadius: 12 },
  action: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 4, maxWidth: '45%' },
  actionText: { color: c.green, fontSize: 13, lineHeight: 20, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
