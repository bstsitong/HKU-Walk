import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type GuideKey = 'links' | 'tips' | 'food' | 'groups';
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
};
export type GuideCategory = {
  key: GuideKey;
  title: string;
  subtitle: string;
  introduction: string;
  entries: GuideEntry[];
};

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
export const ADMIN_URL = API_BASE + '/admin/';

export async function fetchGuide(signal: AbortSignal): Promise<GuideCategory[]> {
  const response = await fetch(API_BASE + '/api/guide/', {
    signal,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Guide request failed');
  const data = await response.json();
  if (!Array.isArray(data.categories)) throw new Error('Invalid guide response');
  return data.categories;
}
