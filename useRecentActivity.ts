import { useCallback } from 'react';
import type { RouteBookmark } from './routeBookmarks';
import type { PersonalStorage } from './usePersonalStorage';

export default function useRecentActivity({ data, change }: PersonalStorage) {
  const visitPost = useCallback((id: string) => {
    change({ collection: 'recent_posts', action: 'visit', value: id });
  }, [change]);
  const visitRoute = useCallback((route: RouteBookmark) => {
    change({ collection: 'recent_routes', action: 'visit', value: route });
  }, [change]);
  return {
    posts: data.recent_posts, routes: data.recent_routes, visitPost, visitRoute,
    clearPosts: () => change({ collection: 'recent_posts', action: 'clear' }),
    clearRoutes: () => change({ collection: 'recent_routes', action: 'clear' }),
  };
}
