import { Markdown, MarkdownIt, RenderRules, stringToTokens, tokensToAST, ASTNode } from '@believer/react-native-markdown-display';
import { Linking, StyleSheet, View } from 'react-native';
import type { ComponentProps } from 'react';
import { API_BASE } from './guideApi';
import { openLink } from './GuideScreens';
import { colors as c } from './theme';
import { Image, Text, Pressable } from './ui';
import AppIcon from './AppIcon';

const parser = MarkdownIt({ linkify: true, breaks: true, typographer: false, html: true });

function plainText(node: ASTNode): string {
  if (node.type === 'text' || node.type === 'code_inline') return node.content;
  return node.children.map(plainText).join('');
}

export function guideExcerpt(body: string) {
  return tokensToAST(stringToTokens(body, parser)).map(plainText).map(text => text.trim()).find(Boolean) ?? '';
}

const rules: RenderRules = {
  image: node => {
    const { src, alt } = node.attributes;
    if (typeof src !== 'string' || !src.startsWith('/static/guide-originals/')) return null;
    const uri = API_BASE + src;
    const size = new URL(uri).searchParams;
    const width = Number(size.get('w'));
    const height = Number(size.get('h'));
    return <Image key={node.key} source={{ uri }} accessibilityLabel={alt || undefined}
      resizeMode="contain" style={[styles.image, { aspectRatio: width > 0 && height > 0 ? width / height : 1 }]} />;
  },
  html_inline: (node) => /^<br\s*\/?>$/i.test(node.content) ? <Text raw key={node.key}>{'\n'}</Text> : null,
  html_block: () => null,
};

export default function GuideMarkdown({ body, onOpenPage, onImagePress, style }: {
  body: string; onOpenPage: (key: string) => void; onImagePress?: (uri: string, title: string) => void;
  style?: ComponentProps<typeof Markdown>['style'];
}) {
  const onLinkPress = (url: string) => {
    if (url.startsWith('#')) onOpenPage(decodeURIComponent(url.slice(1)));
    else if (/^mailto:/i.test(url)) void Linking.openURL(url).catch(() => {});
    else void openLink(url);
    return false;
  };
  const displayRules = onImagePress ? { ...rules, image: (node: ASTNode) => {
    const { src, alt } = node.attributes;
    if (typeof src !== 'string' || !src.startsWith('/static/guide-originals/')) return null;
    const uri = API_BASE + src, params = new URL(uri).searchParams;
    const width = Number(params.get('w')), height = Number(params.get('h'));
    return <Pressable key={node.key} accessibilityRole="button" accessibilityLabel="查看原帖图片" onPress={() => onImagePress(uri, alt || '')} style={styles.preview}>
      <Image source={{ uri }} resizeMode="contain" style={{ width: '100%', aspectRatio: width > 0 && height > 0 ? width / height : 1 }} />
      <View style={styles.expand}><AppIcon name="expand" size={19} /></View>
    </Pressable>;
  }} : rules;
  return <Markdown markdownit={parser} rules={displayRules} style={style ? { ...styles, ...style } : styles} onLinkPress={onLinkPress}>{body}</Markdown>;
}

const styles = StyleSheet.create({
  body: { color: c.ink, fontSize: 15, lineHeight: 24, marginVertical: 12 },
  heading1: { fontSize: 20, lineHeight: 28, fontWeight: '600', marginTop: 16 },
  heading2: { fontSize: 18, lineHeight: 26, fontWeight: '600', marginTop: 12 },
  link: { color: c.green, textDecorationLine: 'underline' },
  hr: { backgroundColor: c.line },
  image: { width: '100%', marginVertical: 8 },
  preview: { padding: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: c.line, borderRadius: 8, marginVertical: 8, overflow: 'hidden' },
  expand: { position: 'absolute', bottom: 8, right: 8, backgroundColor: '#fff', borderRadius: 4, padding: 2 },
});
