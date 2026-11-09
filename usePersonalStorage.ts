import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from './ui';

const legacyOwnerKey = 'hku-walk.personal-records.legacy-owner.v1';
let legacyOwner: Promise<string> | undefined;

function claimLegacy(owner: string) {
  legacyOwner ??= (async () => {
    const existing = await AsyncStorage.getItem(legacyOwnerKey);
    if (existing !== null) return existing;
    await AsyncStorage.setItem(legacyOwnerKey, owner);
    return owner;
  })().catch(error => {
    legacyOwner = undefined;
    throw error;
  });
  return legacyOwner;
}

async function readForOwner(owner: string, key: string, scopedKey: string) {
  const current = await AsyncStorage.getItem(scopedKey);
  if (current !== null) return JSON.parse(current) as unknown;
  const legacy = await AsyncStorage.getItem(key);
  return legacy !== null && await claimLegacy(owner) === owner ? JSON.parse(legacy) as unknown : null;
}

export default function usePersonalStorage<T>(
  owner: string | undefined, key: string, empty: T, decode: (data: unknown) => T, history = false,
) {
  const scopedKey = owner ? `${key}.account.${owner}` : null;
  const [snapshot, setSnapshot] = useState<{ key: string; data: T } | null>(null);
  const queue = useRef(Promise.resolve());
  const current = snapshot?.key === scopedKey ? snapshot : null;

  useEffect(() => {
    if (!owner || !scopedKey) {
      setSnapshot(null);
      return;
    }
    let live = true;
    queue.current.then(() => readForOwner(owner, key, scopedKey)).then(data => {
      if (live) setSnapshot({ key: scopedKey, data: decode(data) });
    }).catch(() => {
      if (live) Alert.alert(history ? '浏览记录暂时无法读取' : '收藏暂时无法读取', '重新打开 App 后再试。');
    });
    return () => { live = false; };
  }, [owner, scopedKey, key, decode, history]);

  useEffect(() => {
    if (!current) return;
    queue.current = queue.current.then(() => AsyncStorage.setItem(current.key, JSON.stringify(current.data))).catch(() => {
      Alert.alert(history ? '浏览记录暂时无法保存' : '收藏保存失败', '请检查设备存储空间后重试。');
    });
  }, [current, history]);

  const update = useCallback((recipe: (data: T) => T) => {
    if (!scopedKey) return;
    setSnapshot(previous => {
      if (!previous || previous.key !== scopedKey) return previous;
      const data = recipe(previous.data);
      return data === previous.data ? previous : { key: scopedKey, data };
    });
  }, [scopedKey]);

  return { data: current?.data ?? empty, ready: current !== null, update };
}
