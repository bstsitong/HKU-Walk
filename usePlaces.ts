import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { places } from './campus';
import { Alert } from './ui';
const storageKey = 'hku-walk.places.v1';
export function validPlaceIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && (places.some(place => place.id === id) || /^community-place-\d+$/.test(id))))] : [];
}
export default function usePlaces() {
  const [saved, setSaved] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(storageKey).then(raw => {
      const data = raw ? JSON.parse(raw) : {};
      if (live) { setSaved(validPlaceIds(data.saved)); setRecent(validPlaceIds(data.recent).slice(0, 12)); setReady(true); }
    }).catch(() => Alert.alert('收藏暂时无法读取', '重新打开 App 后再试。'));
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (ready) queue.current = queue.current.then(() => AsyncStorage.setItem(storageKey, JSON.stringify({ saved, recent }))).catch(() => Alert.alert('收藏保存失败', '请检查设备存储空间后重试。'));
  }, [saved, recent, ready]);
  return { saved, recent, ready,
    toggle: (id: string) => { if (ready) setSaved(list => list.includes(id) ? list.filter(item => item !== id) : [...list, id]); },
    visit: (id: string) => { if (ready) setRecent(list => [id, ...list.filter(item => item !== id)].slice(0, 12)); },
    clearRecent: () => { if (ready) setRecent([]); },
  };
}
export type PlaceRecords = ReturnType<typeof usePlaces>;
