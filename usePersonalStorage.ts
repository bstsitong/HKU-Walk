import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { syncPersonalRecords } from './communityApi';
import {
  applyRecordChanges, BookmarkCollection, decodePersonalRecords, emptyPersonalRecords, PersonalRecords,
  recordBatchSize, RecordChange, recordCollections, recordId, RecordValue,
} from './personalRecords';
import { Alert } from './ui';

const syncKey = 'hku-walk.personal-records.sync.v1';
const legacyOwnerKey = 'hku-walk.personal-records.legacy-owner.v1';
const legacyKeys = ['guide-bookmarks', 'places', 'routes', 'recent-activity'].map(name => `hku-walk.${name}.v1`);
const accountKey = (key: string, owner: string) => `${key}.account.${owner}`;
type LocalRecords = { device: string; next: number; base: PersonalRecords; pending: RecordChange[] };

function parseStored(value: string | null): unknown {
  try { return value === null ? null : JSON.parse(value); }
  catch { return null; }
}

async function readLocalRecords(owner: string, storageKey: string): Promise<LocalRecords> {
  const cached = parseStored(await AsyncStorage.getItem(storageKey)) as LocalRecords | null;
  if (cached && typeof cached.device === 'string' && Number.isSafeInteger(cached.next) &&
      Array.isArray(cached.pending) && cached.next > cached.pending.length) {
    return { ...cached, base: decodePersonalRecords(cached.base) };
  }

  const legacyOwner = await AsyncStorage.getItem(legacyOwnerKey);
  const entries = await Promise.all(legacyKeys.map(async key => {
    const scoped = await AsyncStorage.getItem(accountKey(key, owner));
    // Only an earlier signed-in account can establish ownership of an unscoped legacy record.
    return parseStored(scoped ?? (legacyOwner === owner ? await AsyncStorage.getItem(key) : null));
  }));
  const [posts, places, routes, recent] = entries;
  const placeRecords = places as { saved?: unknown; recent?: unknown } | null;
  const recentRecords = recent as { posts?: unknown; routes?: unknown } | null;
  const legacy = decodePersonalRecords({
    saved_posts: posts, saved_places: placeRecords?.saved, saved_routes: routes,
    recent_posts: recentRecords?.posts, recent_places: placeRecords?.recent, recent_routes: recentRecords?.routes,
  });
  const pending = recordCollections.flatMap(collection =>
    legacy[collection].map((value): RecordChange => ({ collection, action: 'import', value })));
  const device = [Date.now().toString(36), Math.random().toString(36).slice(2), Math.random().toString(36).slice(2)].join('-');
  return { device, next: pending.length + 1, base: emptyPersonalRecords, pending };
}

type Controller = {
  owner: string;
  change: (change: RecordChange) => void;
  toggle: (collection: BookmarkCollection, value: RecordValue) => void;
  sync: () => Promise<void>;
};

export default function usePersonalStorage(owner?: string, token?: string, profileActive = false) {
  const [snapshot, setSnapshot] = useState<{ owner: string; data: PersonalRecords } | null>(null);
  const controller = useRef<Controller | null>(null);
  const storageQueue = useRef(Promise.resolve());

  useEffect(() => {
    if (!owner || !token) { setSnapshot(null); return; }
    const storageKey = accountKey(syncKey, owner);
    const earlyChanges: RecordChange[] = [];
    let active = true;
    let running = false;
    let alerted = false;
    let local: LocalRecords | undefined;
    const publish = () => {
      if (active && local) setSnapshot({ owner, data: applyRecordChanges(local.base, local.pending) });
    };
    const warnStorage = () => {
      if (!active || alerted) return;
      alerted = true;
      Alert.alert('个人记录暂时无法保存到本机', '请检查设备存储空间后重试。');
    };
    const persist = () => {
      const value = JSON.stringify(local);
      storageQueue.current = storageQueue.current
        .then(() => AsyncStorage.setItem(storageKey, value)).catch(warnStorage);
      return storageQueue.current;
    };
    const sync = async () => {
      if (!active || running || !local || AppState.currentState === 'background') return;
      running = true;
      try {
        do {
          await storageQueue.current;
          if (!active) return;
          const changes = local.pending.slice(0, recordBatchSize);
          const result = await syncPersonalRecords(token, changes.length
            ? { device: local.device, first: local.next - local.pending.length, changes } : undefined);
          if (!active) return;
          if (!result?.records || typeof result.records !== 'object' || Array.isArray(result.records)) return;
          local.base = decodePersonalRecords(result.records);
          local.pending.splice(0, changes.length);
          publish();
          await persist();
        } while (active && local.pending.length);
      } catch {
        // Pending edits stay on this device and are retried when the app reconnects.
      } finally { running = false; }
    };
    const change = (operation: RecordChange) => {
      if (!local) { earlyChanges.push(operation); return; }
      local.pending.push(operation);
      local.next++;
      publish();
      void persist();
      void sync();
    };
    const current: Controller = {
      owner, change, sync,
      toggle(collection, value) {
        if (!local) return;
        const currentItems: RecordValue[] = applyRecordChanges(local.base, local.pending)[collection];
        const id = recordId(value);
        change(currentItems.some(item => recordId(item) === id)
          ? { collection, action: 'remove', value: id }
          : { collection, action: 'save', value });
      },
    };
    controller.current = current;
    void storageQueue.current.then(() => readLocalRecords(owner, storageKey)).then(cached => {
      if (!active) return;
      local = cached;
      local.pending.push(...earlyChanges);
      local.next += earlyChanges.length;
      publish();
      if (local.pending.length) void persist();
      void sync();
    }).catch(() => {
      if (active) Alert.alert('个人记录暂时无法读取', '重新打开 App 后再试。');
    });

    const timer = setInterval(() => void sync(), 45000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void sync(); });
    return () => {
      active = false;
      controller.current = null;
      clearInterval(timer);
      listener.remove();
    };
  }, [owner, token]);

  useEffect(() => {
    if (profileActive) void controller.current?.sync();
  }, [profileActive]);
  const change = useCallback((operation: RecordChange) => {
    const current = controller.current;
    if (current && current.owner === owner) current.change(operation);
  }, [owner]);
  const toggle = useCallback((collection: BookmarkCollection, value: RecordValue) => {
    const current = controller.current;
    if (current && current.owner === owner) current.toggle(collection, value);
  }, [owner]);
  const current = owner && snapshot?.owner === owner ? snapshot : null;
  return { data: current?.data ?? emptyPersonalRecords, ready: current !== null, change, toggle };
}

export type PersonalStorage = ReturnType<typeof usePersonalStorage>;
