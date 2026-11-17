import type { RouteBookmark } from './routeBookmarks';
import type { PersonalStorage } from './usePersonalStorage';

export default function useSavedRoutes({ data, ready, toggle }: PersonalStorage) {
  return { saved: data.saved_routes, ready, toggle: (route: RouteBookmark) => toggle('saved_routes', route) };
}

export type RouteRecords = ReturnType<typeof useSavedRoutes>;
