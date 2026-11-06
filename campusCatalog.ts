import { basePlaces, CampusRoute, Place } from './campus';
export type CampusCatalog = { places: Place[]; routes: CampusRoute[]; basePlaces?: Place[] };
const categories = ['building', 'study', 'food', 'toilet', 'access', 'space'];
const builtinIds = new Set(basePlaces.map(place => place.id));
function validPlace(place: Place) {
  return place && typeof place.id === 'string' && typeof place.name === 'string'
    && typeof place.english === 'string' && categories.includes(place.category)
    && Number.isFinite(place.x) && Number.isFinite(place.y)
    && place.x >= 0 && place.x <= 360 && place.y >= 0 && place.y <= 580;
}
export function readCampus(value: unknown): CampusCatalog {
  const data = value as CampusCatalog;
  if (!data || !Array.isArray(data.places) || !Array.isArray(data.routes)) throw new Error('Invalid campus data');
  const places = data.places.filter(p => validPlace(p) && /^community-place-\d+$/.test(p.id));
  const builtins = Array.isArray(data.basePlaces)
    ? data.basePlaces.filter(p => validPlace(p) && builtinIds.has(p.id)).map(p => ({ ...p, isCommunity: false }))
    : basePlaces;
  const ids = new Set([...builtins, ...places].map(p => p.id));
  const routes = data.routes.filter(r => r && /^community-route-\d+$/.test(r.id) && typeof r.title === 'string' && ids.has(r.originId) && ids.has(r.destinationId) && r.originId !== r.destinationId && Array.isArray(r.steps) && r.steps.length > 0 && r.steps.length <= 20 && r.steps.every(step => step && typeof step.title === 'string' && typeof step.body === 'string'));
  return { places: places.map(p => ({ ...p, keywords: p.keywords || '', isCommunity: true })), routes, basePlaces: builtins };
}
