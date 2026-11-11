import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Keyboard, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import AppIcon, { IconName } from './AppIcon';
import { AuthorByline } from './AuthorIdentity';
import type { Account } from './communityApi';
import Discussion from './Discussion';
import { GuideArticle } from './guideApi';
import GuideMarkdown, { guideExcerpt } from './GuideMarkdown';
import { openLink } from './GuideScreens';
import { formatDate } from './localization';
import { normalizeSearchText } from './placeMatching';
import { colors as c } from './theme';
import { Image, Pressable, Text, TextInput } from './ui';
import useGuide from './useGuide';

type Bookmarks = { saved: string[]; ready: boolean; toggle: (id: string) => void };
type Actions = { bookmarks: Bookmarks; liking: readonly string[]; onLike: (article: GuideArticle) => void };

function ArticleMeta({ article, link = true }: { article: GuideArticle; link?: boolean }) {
  const date = article.publishedAt ? formatDate(article.publishedAt) : undefined;
  if (article.authorProfile) return <View style={s.byline}><AuthorByline author={article.authorProfile} detail={date} link={link} /></View>;
  const meta = [article.contributor, date].filter(Boolean).join(' · ');
  return meta ? <Text raw style={s.meta}>{meta}</Text> : null;
}

function Action({ icon, label, count, selected, disabled, onPress, testID }: {
  icon: IconName; label: string; count?: number; selected?: boolean; disabled?: boolean; onPress: () => void; testID?: string;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }}
    disabled={disabled} onPress={onPress} style={s.action}>
    <AppIcon name={icon} size={18} color={selected ? c.green : c.muted} />
    <Text style={[s.actionText, selected && s.selected]}>{label}{count === undefined ? null : ` ${count}`}</Text>
  </Pressable>;
}

function ArticleActions({ article, bookmarks, liking, onLike, onComments }: Actions & { article: GuideArticle; onComments: () => void }) {
  const saved = bookmarks.saved.includes(article.id);
  return <View style={s.actions}>
    <Action icon="heart" testID={`article-like-${article.id}`} label={article.liked ? '取消点赞' : '点赞'} count={article.likeCount}
      selected={article.liked} disabled={liking.includes(article.id)} onPress={() => onLike(article)} />
    <Action icon="comment" testID={`article-comments-${article.id}`} label="评论" count={article.commentCount} onPress={onComments} />
    <Action icon="bookmark" testID={`article-save-${article.id}`} label={saved ? '已收藏' : '收藏'} selected={saved}
      disabled={!bookmarks.ready} onPress={() => bookmarks.toggle(article.id)} />
  </View>;
}

export function GuideArticles({ data, bookmarks, liking, onLike, onOpen, onContribute }: Actions & {
  data: ReturnType<typeof useGuide>; onOpen: (id: string, comments?: boolean) => void; onContribute: () => void;
}) {
  const [query, setQuery] = useState('');
  const excerpts = useMemo(() => Object.fromEntries(data.articles.map(article => [
    article.id, article.markdown ? guideExcerpt(article.body) : article.body,
  ])), [data.articles]);
  const terms = normalizeSearchText(query).split(' ').filter(Boolean);
  const results = data.articles.filter(article => {
    if (!terms.length) return true;
    const pages = Object.values(article.sourcePages ?? {}).map(page => `${page.title} ${page.body}`).join(' ');
    const text = normalizeSearchText(`${article.title} ${article.body} ${article.authorProfile?.name || article.contributor} ${pages}`);
    return terms.every(term => text.includes(term));
  });
  const open = (id: string, comments = false) => { Keyboard.dismiss(); onOpen(id, comments); };
  return <View style={s.flex}>
    <View style={s.header}>
      <View style={s.heading}><Text accessibilityRole="header" style={s.title}>学生指南</Text>
        <Action icon="plus" label="投稿" testID="guide-contribute" onPress={() => { Keyboard.dismiss(); onContribute(); }} />
      </View>
      <View style={s.search}>
        <AppIcon name="search" size={18} color={c.muted} />
        <TextInput testID="guide-search" accessibilityLabel="搜索学生指南" placeholder="搜索帖子、校园生活与服务" value={query} onChangeText={setQuery}
          autoCorrect={false} returnKeyType="search" onSubmitEditing={Keyboard.dismiss} maxLength={120} style={s.input} />
        {query ? <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" onPress={() => setQuery('')} style={s.iconButton}><AppIcon name="close" size={18} /></Pressable> : null}
      </View>
    </View>
    <ScrollView style={s.flex} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={data.loading} onRefresh={() => void data.reload()} tintColor={c.green} />}>
      {data.error ? <View style={s.feedback}><Text style={s.body}>{data.error}</Text>
        <Action icon="refresh" label="重新加载" onPress={() => void data.reload()} disabled={data.loading} />
      </View> : null}
      {results.map(article => <View style={s.card} key={article.id}>
        <Pressable testID={`guide-entry-${article.id}`} accessibilityRole="button" onPress={() => open(article.id)} style={s.summary}>
          <View style={s.flex}>
            <Text raw style={s.cardTitle}>{article.title}</Text>
            <ArticleMeta article={article} link={false} />
            {excerpts[article.id] ? <Text raw numberOfLines={2} style={s.excerpt}>{excerpts[article.id]}</Text> : null}
          </View>
          <AppIcon name="chevron" size={18} color={c.muted} />
        </Pressable>
        <ArticleActions article={article} bookmarks={bookmarks} liking={liking} onLike={onLike} onComments={() => open(article.id, true)} />
      </View>)}
      {!data.loading && !data.error && !results.length ? <Text style={s.empty}>{query.trim() ? '没有找到相关帖子' : '还没有发布的学生指南，稍后再来看看。'}</Text> : null}
    </ScrollView>
  </View>;
}

export function GuideArticleScreen({ article, initiallyComments, session, onBack, onLogin, onCommentCount, bookmarks, liking, onLike }: Actions & {
  article: GuideArticle; initiallyComments: boolean; session: Account | null; onBack: () => void;
  onLogin: (expired?: boolean) => void; onCommentCount: (count: number) => void;
}) {
  const [comments, showComments] = useState(initiallyComments);
  const [sourceKey, setSourceKey] = useState<string>();
  const sourcePage = sourceKey ? article.sourcePages?.[sourceKey] : undefined;
  const openPage = (key: string) => { if (Object.hasOwn(article.sourcePages ?? {}, key)) setSourceKey(key); };
  const back = () => {
    Keyboard.dismiss();
    if (sourceKey) setSourceKey(undefined);
    else if (comments && !initiallyComments) showComments(false);
    else onBack();
  };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [comments, initiallyComments, onBack, sourceKey]);
  return <View style={s.flex}>
    <View style={s.topBar}>
      <Pressable testID="article-back" accessibilityRole="button" accessibilityLabel="返回" onPress={back} style={s.iconButton}><AppIcon name="back" size={20} /></Pressable>
      <Text accessibilityRole="header" style={s.barTitle}>{comments ? '评论' : '学生指南'}</Text>
    </View>
    {comments ? <Discussion kind="guide" id={article.id} title={article.title} session={session} onLogin={onLogin} onCount={onCommentCount} /> : (
      <>
        <ScrollView style={[s.flex, sourcePage && s.hidden]} contentContainerStyle={s.page}>
          <Text raw accessibilityRole="header" style={s.title}>{article.title}</Text>
          <ArticleMeta article={article} />
          {article.imageUrl ? <Image source={{ uri: article.imageUrl }} style={s.cover} resizeMode="cover" /> : null}
          {article.markdown ? <GuideMarkdown body={article.body} onOpenPage={openPage} /> : <Text raw style={s.articleBody}>{article.body}</Text>}
          {article.externalUrl ? <Action icon="external" label="查看相关链接" onPress={() => void openLink(article.externalUrl)} /> : null}
          <ArticleActions article={article} bookmarks={bookmarks} liking={liking} onLike={onLike} onComments={() => showComments(true)} />
        </ScrollView>
        {sourcePage ? <ScrollView key={sourceKey} style={s.flex} contentContainerStyle={s.page}>
          <Text raw accessibilityRole="header" style={s.title}>{sourcePage.title}</Text>
          <GuideMarkdown body={sourcePage.body} onOpenPage={openPage} />
        </ScrollView> : null}
      </>
    )}
  </View>;
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  hidden: { display: 'none' },
  header: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  title: { fontSize: 24, lineHeight: 32, fontWeight: '600', color: c.ink, flexShrink: 1 },
  search: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12, borderWidth: 1, borderColor: c.line, borderRadius: 8, backgroundColor: c.surface },
  input: { flex: 1, minHeight: 48, paddingHorizontal: 8, paddingVertical: 8, color: c.ink, fontSize: 14 },
  iconButton: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  page: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 24 },
  card: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.line, marginBottom: 12, paddingHorizontal: 16 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 16, paddingBottom: 12, minHeight: 64 },
  cardTitle: { fontSize: 18, lineHeight: 24, color: c.ink, fontWeight: '600' },
  meta: { fontSize: 12, lineHeight: 16, color: c.muted, marginTop: 4 },
  byline: { marginTop: 6 },
  excerpt: { fontSize: 14, lineHeight: 20, color: c.muted, marginTop: 8 },
  body: { fontSize: 14, lineHeight: 22, color: c.ink },
  articleBody: { fontSize: 15, lineHeight: 24, color: c.ink, marginVertical: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: c.line },
  action: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 4, paddingVertical: 8 },
  actionText: { fontSize: 13, lineHeight: 20, color: c.muted, flexShrink: 1 },
  selected: { color: c.green, fontWeight: '600' },
  feedback: { padding: 12, backgroundColor: c.paper, marginBottom: 12, borderRadius: 8 },
  empty: { paddingVertical: 24, fontSize: 14, color: c.muted },
  topBar: { width: '100%', maxWidth: 650, alignSelf: 'center', minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  barTitle: { fontSize: 18, lineHeight: 24, color: c.ink, fontWeight: '600' },
  cover: { width: '100%', aspectRatio: 16 / 9, marginTop: 12, borderRadius: 8 },
});
