import { canonicalPlaceId } from './mapDisplay';

export type RouteBookmark = { id: string; originId: string; destinationId: string; source: 'demo' | 'community' };
const placeId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
export const demoRouteId = (originId: string, destinationId: string) => `demo:${originId}>${destinationId}`;
export function canonicalRouteBookmark(route: RouteBookmark): RouteBookmark {
  const originId = canonicalPlaceId(route.originId);
  const destinationId = canonicalPlaceId(route.destinationId);
  return { ...route, originId, destinationId, id: route.source === 'demo' ? demoRouteId(originId, destinationId) : route.id };
}
export function readRouteBookmarks(value: unknown): RouteBookmark[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap(item => {
    if (!item || !placeId(item.originId) || !placeId(item.destinationId) || typeof item.id !== 'string') return [];
    const valid = item.source === 'community' ? /^community-route-\d+$/.test(item.id) : item.source === 'demo' && item.id === demoRouteId(item.originId, item.destinationId);
    if (!valid) return [];
    const route = canonicalRouteBookmark(item);
    if (route.originId === route.destinationId || seen.has(route.id)) return [];
    seen.add(route.id);
    return [route];
  });
}
