import { useCallback } from 'react';
import { readRouteBookmarks, RouteBookmark } from './routeBookmarks';
import usePersonalStorage from './usePersonalStorage';

const key = 'hku-walk.recent-activity.v1';
const limit = 12;
const empty = { posts: [] as string[], routes: [] as RouteBookmark[] };

function decode(data: unknown) {
  const record = data as Partial<typeof empty> | null;
  const posts = Array.isArray(record?.posts) ? record.posts.filter(id => typeof id === 'string') : [];
  return { posts: [...new Set(posts)].slice(0, limit), routes: readRouteBookmarks(record?.routes).slice(0, limit) };
}

export default function useRecentActivity(owner?: string) {
  const { data, ready, update } = usePersonalStorage(owner, key, empty, decode, true);
  const visitPost = useCallback((id: string) => {
    if (ready) update(current => current.posts[0] === id ? current : {
      ...current, posts: [id, ...current.posts.filter(item => item !== id)].slice(0, limit),
    });
  }, [ready, update]);
  const visitRoute = useCallback((route: RouteBookmark) => {
    if (ready) update(current => current.routes[0]?.id === route.id ? current : {
      ...current, routes: [route, ...current.routes.filter(item => item.id !== route.id)].slice(0, limit),
    });
  }, [ready, update]);
  return {
    ...data, visitPost, visitRoute,
    clearPosts: () => update(current => ({ ...current, posts: [] })),
    clearRoutes: () => update(current => ({ ...current, routes: [] })),
  };
}
