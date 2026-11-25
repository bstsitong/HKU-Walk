import { getLanguage, t, translate } from './localization';
import type { IconName } from './AppIcon';
import type { AuthorProfile } from './guideApi';
import { matchCampusPlaces } from './placeMatching';
import fallbackPlaces from './server/guide/base_places_v2.json';
import additionalPlaces from './server/guide/additional_map_places.json';
import campusLandmarks from './server/guide/campus_landmarks.json';
import classrooms from './server/guide/classrooms.json';
import { canonicalPlaceId, isSouvenirShop, MapDisplayLevel } from './mapDisplay';
export const categories = [
  { id: 'all', label: '全部' },
  { id: 'building', label: '教学楼' },
  { id: 'study', label: '学习' },
  { id: 'food', label: '餐饮' },
  { id: 'souvenir', label: '纪念品店' },
  { id: 'toilet', label: '洗手间' },
  { id: 'access', label: '出入口' },
  { id: 'water', label: '饮水点' },
] as const;

export type Category = (typeof categories)[number]['id'];

export type Place = {
  id: string;
  name: string;
  english: string;
  abbreviation?: string;
  keywords: string;
  category: Exclude<Category, 'all' | 'souvenir'> | 'space';
  displayLevel?: MapDisplayLevel;
  x: number;
  y: number;
  entryId?: string;
  description?: string;
  updatedAt?: string;
  entrance?: string;
  floor?: string;
  imageUrl?: string;
  isCommunity?: boolean;
  mapPositionPending?: boolean;
  parentBuildingId?: string;
  buildingName?: string;
  authorProfile?: AuthorProfile | null;
};

// These coordinates are normalized to the campus map, separate from GPS coordinates.
export const additionalMapPlaces: Place[] = additionalPlaces.map(place => ({
  ...place, category: place.category as Place['category'],
}));
export const classroomPlaces: Place[] = classrooms.flatMap(room => {
  const building = fallbackPlaces.find(place => place.id === room.parentBuildingId);
  return building ? [{ ...room, x: building.x, y: building.y, category: 'building' }] : [];
});
export const classroomAndLandmarkPlaces: Place[] = [
  ...campusLandmarks.map<Place>(place => ({ ...place, category: place.category as Place['category'] })),
  ...classroomPlaces,
];
const newCampusPlaceIds = new Set(classroomAndLandmarkPlaces.map(place => place.id));
export const isPublishedPlace = (place: Place) => Boolean(place.entryId) || !newCampusPlaceIds.has(place.id);
export const basePlaces: Place[] = fallbackPlaces.map<Place>(place => ({
  ...place, category: place.category as Place['category'],
})).concat(additionalMapPlaces, classroomAndLandmarkPlaces);

export const places: Place[] = [...basePlaces];
export type CampusRoute = { id: string; entryId: string; title: string; body: string; originId: string; destinationId: string; imageUrl?: string;
  steps: { title: string; body: string; imageUrl?: string }[]; isCommunity: true; updatedAt: string; authorProfile?: AuthorProfile | null };
export const campusRoutes: CampusRoute[] = [];
export function setCommunityCampus(newPlaces: Place[], newRoutes: CampusRoute[], builtins = basePlaces) {
  places.splice(0, places.length, ...builtins, ...newPlaces);
  campusRoutes.splice(0, campusRoutes.length, ...newRoutes);
}
export const getPlace = (id: string) => places.find(place => place.id === canonicalPlaceId(id));
export const classroomBuilding = (place: Place) => place.parentBuildingId ? getPlace(place.parentBuildingId) : undefined;
export const mapPlace = (place: Place) => classroomBuilding(place) ?? place;
export const classroomLocation = (room: Place, building: Place) =>
  [room.buildingName ? t(room.buildingName) : placeName(building), room.floor ? t(room.floor) : ''].filter(Boolean).join(' · ');
export const getCampusRoute = (id: string) => campusRoutes.find(route => route.id === id);

export function findPlace(id: string) {
  return getPlace(id) ?? places[0] ?? basePlaces[0];
}

export function categoryLabel(place: Place) {
  const category = isSouvenirShop(place.id) ? 'souvenir' : place.category;
  return t(categories.find(item => item.id === category)?.label ?? '校园空间');
}

export const placeName = (place: Place, language = getLanguage()) => {
  return language === 'en' && place.english ? place.english : translate(place.name, language);
};
const categoryIcons = { building: 'building', study: 'book', food: 'coffee', toilet: 'wc', access: 'gate', space: 'leaf', water: 'water', souvenir: 'gift', all: 'map' } as const;
export const placeIcon = (place: Place): IconName => categoryIcons[isSouvenirShop(place.id) ? 'souvenir' : place.category];
export const categoryIcon = (category: Category): IconName => categoryIcons[category];
export const placePhoto = (place: Place) => place.imageUrl ? { uri: place.imageUrl } : place.id === 'main' ? require('./assets/hku-main.webp') : require('./assets/hku-campus.webp');
export const hasPlacePhoto = (place: Place) => Boolean(place.imageUrl) || (!place.isCommunity && ['main', 'chiwah', 'garden'].includes(place.id));
export function filterPlaces(category: Category, input = '', recentIds: readonly string[] = []) {
  return matchCampusPlaces(places, category, input, recentIds);
}

export const routeSteps = [
  { icon: 'map-pin', title: '从港大站校园入口出发', copy: '对照配图辨认起点，然后沿通道出发。', photo: '起点示意图' },
  { icon: 'corner-up-right', title: '沿步行路径前往路口', copy: '经过学习空间，在路口按地标右转。', photo: '路口地标图' },
  { icon: 'arrow-up', title: '乘电梯前往连通楼层', copy: '找到电梯，对照楼层指示换层。', photo: '电梯入口图' },
  { icon: 'arrow-right', title: '离开电梯后继续步行', copy: '辨认楼层出口，沿指示通道继续前进。', photo: '楼层出口图' },
  { icon: 'log-in', title: '找到本部大楼入口', copy: '对照配图和标识，辨认目的地的入口。', photo: '建筑入口图' },
  { icon: 'flag', title: '到达本部大楼', copy: '对照终点配图，确认到达位置。', photo: '到达位置图' },
] as const;
