import { basePlaces, CampusRoute, Place } from './campus';
export type CampusCatalog = { places: Place[]; routes: CampusRoute[] };
export function readCampus(value: unknown): CampusCatalog {
  const data = value as CampusCatalog;
  if (!data || !Array.isArray(data.places) || !Array.isArray(data.routes)) throw new Error('Invalid campus data');
  const categories = ['building','study','food','toilet','access','space'];
  const places = data.places.filter(p => p && /^community-place-\d+$/.test(p.id) && typeof p.name === 'string' && typeof p.english === 'string' && categories.includes(p.category) && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 360 && p.y >= 0 && p.y <= 580);
  const ids = new Set([...basePlaces, ...places].map(p => p.id));
  const routes = data.routes.filter(r => r && /^community-route-\d+$/.test(r.id) && typeof r.title === 'string' && ids.has(r.originId) && ids.has(r.destinationId) && r.originId !== r.destinationId && Array.isArray(r.steps) && r.steps.length > 0 && r.steps.length <= 20 && r.steps.every(step => step && typeof step.title === 'string' && typeof step.body === 'string'));
  return { places: places.map(p => ({ ...p, keywords: p.keywords || '', isCommunity: true })), routes };
}
