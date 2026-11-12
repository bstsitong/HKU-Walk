import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { BodyBlock } from './submissionBlocks';

export type GuideKey = 'links' | 'tips' | 'food' | 'groups';
export type AuthorProfile = { name: string; avatarUrl: string; profileId?: string; anonymous?: boolean };
export type GuideEntry = {
  id: string;
  title: string;
  body: string;
  externalUrl: string;
  imageUrl: string;
  isExample: boolean;
  isCommunity?: boolean;
  mapType?: 'place' | 'route' | '';
  updatedAt: string;
  authorProfile?: AuthorProfile | null;
};
export type GuideCategory = {
  key: GuideKey;
  title: string;
  subtitle: string;
  introduction: string;
  entries: GuideEntry[];
};
export type GuideSourcePage = { title: string; body: string };
export type GuideArticle = GuideEntry & {
  contributor: string; publishedAt: string | null; likeCount: number; commentCount: number; liked: boolean;
  sourcePages: Record<string, GuideSourcePage>; markdown: boolean;
  bodyBlocks?: BodyBlock[]; relatedLocation?: string;
  canDelete?: boolean;
};
export type DiscussionComment = { id: string; author: string; authorProfile?: AuthorProfile; body: string; createdAt: string;
  canDelete?: boolean;
  replyTo?: { id: string; author: AuthorProfile } | null };

function defaultHost() {
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = new URL('http://' + hostUri).hostname;
    if (Platform.OS === 'android' && ['localhost', '127.0.0.1'].includes(host)) return '10.0.2.2';
    return host;
  }
  return Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
}

export const API_BASE = (process.env.EXPO_PUBLIC_API_URL || `http://${defaultHost()}:8000`).replace(/\/$/, '');

export async function fetchGuide(signal: AbortSignal, token?: string): Promise<{ categories: GuideCategory[]; articles: GuideArticle[] }> {
  const get = (auth?: string) => fetch(API_BASE + '/api/guide/', {
    signal,
    headers: { Accept: 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    cache: 'no-store',
  });
  let response = await get(token);
  if (token && response.status === 401) response = await get();
  if (!response.ok) throw new Error('Guide request failed');
  const data = await response.json();
  if (!Array.isArray(data.categories)) throw new Error('Invalid guide response');
  return { categories: data.categories, articles: Array.isArray(data.articles) ? data.articles : [] };
}
