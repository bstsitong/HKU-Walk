import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from './guideApi';
import { setCommunityCampus } from './campus';
import { CampusCatalog, readCampus } from './campusCatalog';
const cacheKey = 'hku-walk.campus.v1';
export default function useCampus() {
  const [catalog, setCatalog] = useState<CampusCatalog>({ places: [], routes: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const cacheWrites = useRef(Promise.resolve());
  const fresh = useRef(false);
  const apply = (next: CampusCatalog) => { setCommunityCampus(next.places, next.routes, next.basePlaces); setCatalog(next); };
  const reload = useCallback(async () => {
    const current = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 75000);
    setLoading(true); setError('');
    try {
      const response = await fetch(API_BASE + '/api/campus/', { signal: abort.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error('Campus request failed');
      const next = readCampus(await response.json());
      if (current === generation.current) {
        fresh.current = true; apply(next);
        cacheWrites.current = cacheWrites.current.then(() => AsyncStorage.setItem(cacheKey, JSON.stringify(next))).catch(() => {});
      }
    } catch { if (current === generation.current) setError('新地点与路线暂时无法更新，当前保留已读取的内容。'); }
    finally { clearTimeout(timeout); if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(cacheKey).then(raw => { if (live && raw && !fresh.current) apply(readCampus(JSON.parse(raw))); }).catch(() => {});
    void reload();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void reload(); });
    return () => { live = false; generation.current++; controller.current?.abort(); listener.remove(); };
  }, [reload]);
  return { catalog, loading, error, reload };
}
