import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from './ui';
import { readRouteBookmarks, RouteBookmark } from './routeBookmarks';
const key = 'hku-walk.routes.v1';
export default function useSavedRoutes() {
  const [saved, setSaved] = useState<RouteBookmark[]>([]);
  const [ready, setReady] = useState(false);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(key).then(raw => { const value = raw ? JSON.parse(raw) : []; if (live) { setSaved(readRouteBookmarks(value)); setReady(true); } }).catch(() => Alert.alert('收藏暂时无法读取', '重新打开 App 后再试。'));
    return () => { live = false; };
  }, []);
  useEffect(() => { if (ready) queue.current = queue.current.then(() => AsyncStorage.setItem(key, JSON.stringify(saved))).catch(() => Alert.alert('收藏保存失败', '请检查设备存储空间后重试。')); }, [saved, ready]);
  return { saved, ready,
    toggle: (route: RouteBookmark) => { if (ready) setSaved(current => current.some(item => item.id === route.id) ? current.filter(item => item.id !== route.id) : [...current, route]); },
  };
}
export type RouteRecords = ReturnType<typeof useSavedRoutes>;
