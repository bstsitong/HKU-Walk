import { canonicalRouteBookmark, demoRouteId, readRouteBookmarks, RouteBookmark } from './routeBookmarks';
import { canonicalPlaceId } from './mapDisplay';

export const historyLimit = 12;
export const recordBatchSize = 100;
export const recordCollections = [
  'saved_posts', 'saved_places', 'saved_routes', 'recent_posts', 'recent_places', 'recent_routes',
] as const;
type Collection = typeof recordCollections[number];
export type BookmarkCollection = 'saved_posts' | 'saved_places' | 'saved_routes';
type HistoryCollection = Exclude<Collection, BookmarkCollection>;
export type RecordValue = string | RouteBookmark;
export type PersonalRecords = Record<Exclude<Collection, 'saved_routes' | 'recent_routes'>, string[]> &
  Record<'saved_routes' | 'recent_routes', RouteBookmark[]>;
export type RecordChange =
  | { collection: Collection; action: 'import'; value: RecordValue }
  | { collection: BookmarkCollection; action: 'save'; value: RecordValue }
  | { collection: BookmarkCollection; action: 'remove'; value: string }
  | { collection: HistoryCollection; action: 'visit'; value: RecordValue }
  | { collection: HistoryCollection; action: 'clear' };

export const emptyPersonalRecords: PersonalRecords = {
  saved_posts: [], saved_places: [], saved_routes: [], recent_posts: [], recent_places: [], recent_routes: [],
};

function readIds(value: unknown, pattern: RegExp) {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length <= 100 && pattern.test(id)))]
    : [];
}

function readRoutes(value: unknown) {
  return readRouteBookmarks(value).filter(route => route.originId.length <= 100 && route.destinationId.length <= 100 &&
    (route.source === 'demo' || route.id.length <= 100));
}

export function decodePersonalRecords(value: unknown): PersonalRecords {
  const raw = value as Partial<Record<Collection, unknown>> | null | undefined;
  const postId = /^[a-zA-Z0-9_-]+$/;
  const placeId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  return {
    saved_posts: readIds(raw?.saved_posts, postId),
    saved_places: [...new Set(readIds(raw?.saved_places, placeId).map(canonicalPlaceId))],
    saved_routes: readRoutes(raw?.saved_routes),
    recent_posts: readIds(raw?.recent_posts, postId).slice(0, historyLimit),
    recent_places: [...new Set(readIds(raw?.recent_places, placeId).map(canonicalPlaceId))].slice(0, historyLimit),
    recent_routes: readRoutes(raw?.recent_routes).slice(0, historyLimit),
  };
}

export const recordId = (value: RecordValue) => typeof value === 'string' ? value : value.id;

export function applyRecordChanges(records: PersonalRecords, changes: RecordChange[]): PersonalRecords {
  return changes.reduce((next, change) => {
    const { collection, action } = change;
    if (action === 'clear') return { ...next, [collection]: [] };
    let { value } = change;
    if (typeof value === 'string' && collection.endsWith('_places')) value = canonicalPlaceId(value);
    if (collection.endsWith('_routes')) {
      if (typeof value !== 'string') {
        value = canonicalRouteBookmark(value);
        if (value.originId === value.destinationId) return next;
      } else {
        const demo = /^demo:([a-z0-9-]+)>([a-z0-9-]+)$/.exec(value);
        if (demo) value = demoRouteId(canonicalPlaceId(demo[1]), canonicalPlaceId(demo[2]));
      }
    }
    const items: RecordValue[] = next[collection];
    const remaining = items.filter(item => recordId(item) !== recordId(value));
    if (action === 'remove') return { ...next, [collection]: remaining };
    if (action !== 'visit' && remaining.length !== items.length) return next;
    const updated = action === 'visit' ? [value, ...remaining] : [...items, value];
    return { ...next, [collection]: collection.startsWith('recent_') ? updated.slice(0, historyLimit) : updated };
  }, records);
}
