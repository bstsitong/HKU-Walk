import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, StyleSheet, View } from 'react-native';
import AppIcon from './AppIcon';
import { AuthorByline } from './AuthorIdentity';
import { ApiError, DiscussionTarget, fetchInbox, InboxMessage, markInboxRead } from './communityApi';
import { formatDate } from './localization';
import { colors as c } from './theme';
import { Pressable, Text } from './ui';

export default function InboxScreen({ token, onBack, onOpen, onProfile, onUnread, onExpired, targetTitle }: {
  token: string; onBack: () => void; onOpen: (message: InboxMessage) => void;
  onProfile: (id: string) => void; onUnread: (count: number) => void; onExpired: () => void;
  targetTitle: (target: DiscussionTarget) => string;
}) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const reading = useRef(new Set<string>());
  const readIds = useRef(new Set<string>());

  const load = async (page = 1) => {
    const version = ++generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const result = await fetchInbox(token, page);
      if (version !== generation.current) return;
      const incoming = result.messages.map(item => readIds.current.has(item.id) ? { ...item, read: true } : item);
      setMessages(previous => page === 1 ? incoming :
        [...previous, ...incoming.filter(item => !previous.some(old => old.id === item.id))]);
      setNextPage(result.nextPage);
      onUnread(result.unread);
    } catch (error) {
      if (version !== generation.current) return;
      if (error instanceof ApiError && error.status === 401) onExpired();
      else setFailed(true);
    } finally {
      if (version === generation.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => { generation.current++; };
  }, [token]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => listener.remove();
  }, [onBack]);

  const read = async (message: InboxMessage) => {
    if (message.read || reading.current.has(message.id)) return;
    reading.current.add(message.id);
    try {
      const result = await markInboxRead(token, message.id);
      readIds.current.add(message.id);
      setMessages(items => items.map(item => item.id === message.id ? { ...item, read: true } : item));
      onUnread(result.unread);
    } catch {
      // Leave the message unread so it can be retried when tapped again.
    } finally {
      reading.current.delete(message.id);
    }
  };
  const open = (message: InboxMessage) => {
    void read(message);
    onOpen(message);
  };

  return <View style={s.screen}>
    <View style={s.header}>
      <Pressable testID="inbox-back" accessibilityRole="button" accessibilityLabel="返回" onPress={onBack} style={s.iconButton}>
        <AppIcon name="back" size={20} />
      </Pressable>
      <Text accessibilityRole="header" style={s.heading}>消息</Text>
    </View>
    <FlatList data={messages} keyExtractor={item => item.id} contentContainerStyle={s.list}
      refreshing={loading && messages.length > 0} onRefresh={() => void load()}
      renderItem={({ item }) => <View style={[s.row, !item.read && s.unread]}>
        {item.kind === 'review' ? <Pressable testID={`inbox-message-${item.id}`} accessibilityRole="button" onPress={() => open(item)} style={s.review}>
          <View style={s.symbol}><AppIcon name={item.reviewStatus === 'approved' ? 'check' : item.reviewStatus === 'rejected' ? 'close' : 'edit'} size={18} /></View>
          <View style={s.flex}>
            <Text style={s.name}>{item.reviewStatus === 'approved' ? '投稿审核通过' : item.reviewStatus === 'rejected' ? '投稿已拒绝' : '投稿需修改'}</Text>
            <Text raw style={s.copy}>{item.title}</Text>
            {item.reviewNote ? <Text raw style={s.meta} numberOfLines={3}>{item.reviewNote}</Text> : null}
            <Text raw style={s.meta}>{formatDate(item.createdAt)}</Text>
          </View>
        </Pressable> : <>
          {item.author ? <AuthorByline author={item.author} detail={formatDate(item.createdAt)} size={36}
            onOpenProfile={id => { void read(item); onProfile(id); }} /> : null}
          <Pressable testID={`inbox-message-${item.id}`} accessibilityRole="button" onPress={() => open(item)} style={s.comment}>
            <Text style={s.meta}>{item.kind === 'reply' ? '回复了你的评论' : '评论了你发布的内容'}</Text>
            {item.target ? <>
              <Text raw style={s.copy} numberOfLines={3}>{item.body}</Text>
              <Text raw style={s.target} numberOfLines={1}>{targetTitle(item.target)}</Text>
            </> : <Text style={s.copy}>这条评论已不可用。</Text>}
          </Pressable>
        </>}
        {!item.read ? <View style={s.dot} /> : null}
      </View>}
      ListEmptyComponent={loading ? <ActivityIndicator color={c.green} style={s.feedback} /> :
        !failed ? <View style={s.feedback}><AppIcon name="mail" size={30} /><Text style={s.meta}>还没有消息</Text></View> : undefined}
      ListFooterComponent={failed ? <Pressable accessibilityRole="button" style={s.feedback} onPress={() => void load()}>
        <Text style={s.target}>消息加载失败，点击重试</Text>
      </Pressable> : nextPage ? <Pressable accessibilityRole="button" style={s.feedback} disabled={loading} onPress={() => void load(nextPage)}>
        <Text style={s.target}>加载更多消息</Text>
      </Pressable> : undefined}
    />
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, width: '100%', maxWidth: 650, alignSelf: 'center' },
  flex: { flex: 1, gap: 3 },
  header: { minHeight: 56, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  heading: { color: c.ink, fontSize: 22, lineHeight: 30, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  row: { padding: 12, paddingRight: 24, borderBottomWidth: 1, borderBottomColor: c.line },
  unread: { backgroundColor: c.tint },
  dot: { position: 'absolute', right: 12, top: 21, width: 7, height: 7, borderRadius: 4, backgroundColor: c.rust },
  review: { minHeight: 48, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  symbol: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
  comment: { minHeight: 48, marginLeft: 44, paddingVertical: 5, gap: 4 },
  name: { color: c.ink, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  copy: { color: c.ink, fontSize: 14, lineHeight: 21 },
  meta: { color: c.muted, fontSize: 12, lineHeight: 18 },
  target: { color: c.green, fontSize: 13, lineHeight: 20, fontWeight: '600' },
  feedback: { paddingVertical: 26, alignItems: 'center', gap: 10 },
});
