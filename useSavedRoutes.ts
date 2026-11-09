import { readRouteBookmarks, RouteBookmark } from './routeBookmarks';
import usePersonalStorage from './usePersonalStorage';
const key = 'hku-walk.routes.v1';
const empty: RouteBookmark[] = [];
export default function useSavedRoutes(owner?: string) {
  const { data: saved, ready, update } = usePersonalStorage(owner, key, empty, readRouteBookmarks);
  return { saved, ready,
    toggle: (route: RouteBookmark) => update(current => current.some(item => item.id === route.id) ? current.filter(item => item.id !== route.id) : [...current, route]),
  };
}
export type RouteRecords = ReturnType<typeof useSavedRoutes>;
