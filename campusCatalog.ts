import { additionalMapPlaces, basePlaces, classroomAndLandmarkPlaces, CampusRoute, Place } from './campus';
import { CAMPUS_MAP_VERSION } from './MapArtwork';
import { campusFacilities, CampusFacility, facilityStyles } from './campusFacilities';
import { canonicalPlaceId } from './mapDisplay';
export type CampusCatalog = { mapVersion?: number; places: Place[]; routes: CampusRoute[]; basePlaces?: Place[]; facilities?: CampusFacility[]; includesAdditionalMapPlaces?: boolean; includesClassroomPlaces?: boolean };
const categories = ['building', 'study', 'food', 'toilet', 'access', 'space', 'water'];
const builtinIds = new Set(basePlaces.map(place => place.id));
const classroomInfo = new Map(classroomAndLandmarkPlaces.map(({ id, parentBuildingId, buildingName }) => [id, { parentBuildingId, buildingName }]));
const newPreviewIds = ['visitor-centre-gift-shop', 'university-drive-gate', 'lyttelton-gate'];
const previewIds = new Set([
  ...newPreviewIds, 'central-podium', 'chiwah', 'lee-shau-kee', 'heritage-house', 'visitor-centre',
  'centennial-gate', 'so330', 'cafe', 'subway', 'hku-press-bookshop', 'bijas', 'centennial-red-wall', 'asian-gourmet',
]);
const previewPlaces = basePlaces.filter(place => previewIds.has(place.id));
const previewById = new Map(previewPlaces.map(place => [place.id, place]));
const consolidatedPlaces = new Map(basePlaces.filter(place => ['gate', 'library'].includes(place.id)).map(place => [place.id, place]));

function readFacilities(value: unknown): CampusFacility[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is CampusFacility => item && typeof item.id === 'string' &&
    Object.hasOwn(facilityStyles, item.kind) && item.kind !== 'gate' &&
    typeof item.title === 'string' && typeof item.english === 'string' && Boolean(item.english.trim()) && typeof item.detail === 'string' &&
    [1, 2, 3, 4].includes(item.displayLevel) && Array.isArray(item.at) && item.at.length === 2 &&
    Number.isFinite(item.at[0]) && Number.isFinite(item.at[1]) &&
    item.at[0] >= 0 && item.at[0] <= 360 && item.at[1] >= 0 && item.at[1] <= 219.4);
}
function validPlace(place: Place) {
  return place && typeof place.id === 'string' && typeof place.name === 'string'
    && typeof place.english === 'string' && categories.includes(place.category)
    && Number.isFinite(place.x) && Number.isFinite(place.y)
    && place.x >= 0 && place.x <= 360 && place.y >= 0 && place.y <= 580;
}
export function readCampus(value: unknown): CampusCatalog {
  const data = value as CampusCatalog;
  if (!data || data.mapVersion !== CAMPUS_MAP_VERSION || !Array.isArray(data.places) || !Array.isArray(data.routes)) throw new Error('Invalid campus data');
  const places = data.places.filter(p => validPlace(p) && /^community-place-\d+$/.test(p.id));
  let builtins = Array.isArray(data.basePlaces)
    ? data.basePlaces.filter(p => validPlace(p) && builtinIds.has(p.id)).map(p => ({ ...p, isCommunity: false, ...classroomInfo.get(p.id) }))
    : [...basePlaces];
  const receivedIds = new Set(builtins.map(place => place.id));
  if (data.includesAdditionalMapPlaces !== true) builtins.push(...additionalMapPlaces.filter(place => !receivedIds.has(place.id)));
  if (data.includesClassroomPlaces !== true) builtins.push(...classroomAndLandmarkPlaces.filter(place => !receivedIds.has(place.id)));
  if (!newPreviewIds.every(id => receivedIds.has(id))) {
    // Old responses and stored catalogs can precede the map-point update.
    builtins = builtins.map(place => {
      const preview = previewById.get(place.id);
      if (!preview) return place;
      return { ...place, x: preview.x, y: preview.y, mapPositionPending: false,
        entrance: place.id === 'centennial-red-wall' ? preview.entrance : place.entrance };
    });
    const present = new Set(builtins.map(place => place.id));
    builtins.push(...previewPlaces.filter(place => !present.has(place.id)));
  }
  builtins = builtins.map(place => {
    const current = consolidatedPlaces.get(place.id);
    if (!current || place.displayLevel !== undefined) return place;
    return { ...place, name: current.name, x: current.x, y: current.y, keywords: current.keywords };
  });
  const ids = new Set([...builtins, ...places].map(p => p.id));
  const routes = data.routes
    .filter(r => r && typeof r.originId === 'string' && typeof r.destinationId === 'string')
    .map(r => ({ ...r, originId: canonicalPlaceId(r.originId), destinationId: canonicalPlaceId(r.destinationId) }))
    .filter(r => /^community-route-\d+$/.test(r.id) && typeof r.title === 'string' && ids.has(r.originId) && ids.has(r.destinationId) && r.originId !== r.destinationId && Array.isArray(r.steps) && r.steps.length > 0 && r.steps.length <= 20 && r.steps.every(step => step && typeof step.title === 'string' && typeof step.body === 'string'));
  const onlineFacilities = readFacilities(data.facilities);
  const gateFacilities = campusFacilities.filter(item => item.kind === 'gate').flatMap(item => {
    const place = builtins.find(place => place.id === item.id);
    return place ? [{ ...item, at: [place.x, place.y / 580 * 219.4] as const, title: place.name, english: place.english }] : [];
  });
  const facilities = onlineFacilities && [...gateFacilities, ...onlineFacilities];
  return { mapVersion: data.mapVersion, places: places.map(p => ({ ...p, keywords: p.keywords || '', isCommunity: true })), routes, basePlaces: builtins,
    facilities,
    includesAdditionalMapPlaces: data.includesAdditionalMapPlaces === true, includesClassroomPlaces: data.includesClassroomPlaces === true };
}
