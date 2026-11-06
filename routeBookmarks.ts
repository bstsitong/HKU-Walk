export type RouteBookmark = { id: string; originId: string; destinationId: string; source: 'demo' | 'community' };
const placeId = (id: unknown): id is string => typeof id === 'string' && /^(main|library|chiwah|knowles|gate|garden|cafe|toilet|community-place-\d+)$/.test(id);
export const demoRouteId = (originId: string, destinationId: string) => `demo:${originId}>${destinationId}`;
export function readRouteBookmarks(value: unknown): RouteBookmark[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter(item => {
    if (!item || !placeId(item.originId) || !placeId(item.destinationId) || item.originId === item.destinationId || seen.has(item.id)) return false;
    const valid = item.source === 'community' ? /^community-route-\d+$/.test(item.id) : item.source === 'demo' && item.id === demoRouteId(item.originId, item.destinationId);
    if (valid) seen.add(item.id);
    return valid;
  });
}
