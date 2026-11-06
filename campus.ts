import { getLanguage, t, translate } from './localization';
import type { IconName } from './AppIcon';
import fallbackPlaces from './server/guide/base_places_v1.json';
export const categories = [
  { id: 'all', label: '全部' },
  { id: 'building', label: '教学楼' },
  { id: 'study', label: '学习' },
  { id: 'food', label: '餐饮' },
  { id: 'toilet', label: '洗手间' },
  { id: 'access', label: '出入口' },
] as const;

export type Category = (typeof categories)[number]['id'];

export type Place = {
  id: string;
  name: string;
  english: string;
  abbreviation?: string;
  keywords: string;
  category: Exclude<Category, 'all'> | 'space';
  x: number;
  y: number;
  entryId?: string;
  description?: string;
  entrance?: string;
  floor?: string;
  imageUrl?: string;
  isCommunity?: boolean;
};

// These coordinates are in the prototype's drawing, separate from GPS coordinates.
export const basePlaces: Place[] = fallbackPlaces.map(place => ({
  ...place, category: place.category as Place['category'],
}));

export const places: Place[] = [...basePlaces];
export type CampusRoute = { id: string; entryId: string; title: string; body: string; originId: string; destinationId: string;
  steps: { title: string; body: string; imageUrl?: string }[]; isCommunity: true; updatedAt: string };
export const campusRoutes: CampusRoute[] = [];
export function setCommunityCampus(newPlaces: Place[], newRoutes: CampusRoute[], builtins = basePlaces) {
  places.splice(0, places.length, ...builtins, ...newPlaces);
  campusRoutes.splice(0, campusRoutes.length, ...newRoutes);
}
export const getPlace = (id: string) => places.find(place => place.id === id);
export const getCampusRoute = (id: string) => campusRoutes.find(route => route.id === id);

export function findPlace(id: string) {
  return getPlace(id) ?? places[0] ?? basePlaces[0];
}

export function categoryLabel(category: Place['category']) {
  return t(categories.find(item => item.id === category)?.label ?? '校园空间');
}

export const placeName = (place: Place, language = getLanguage()) => {
  if (place.isCommunity) return place.name;
  return language === 'en' && place.english ? place.english : translate(place.name, language);
};
export const placeIcon = (place: Place): IconName => ({ building: 'building', study: 'book', food: 'coffee', toilet: 'wc', access: 'gate', space: 'leaf' } as const)[place.category];
export const categoryIcon = (category: Category): IconName => category === 'all' ? 'map' : placeIcon({ category } as Place);
export const placePhoto = (place: Place) => place.imageUrl ? { uri: place.imageUrl } : place.id === 'main' ? require('./assets/hku-main.webp') : require('./assets/hku-campus.webp');
export const hasPlacePhoto = (place: Place) => Boolean(place.imageUrl) || (!place.isCommunity && ['main', 'chiwah', 'garden'].includes(place.id));
const traditionalNames: Record<string, string> = { main: '本部大樓', library: '大學圖書館', chiwah: '智華學習共享空間', knowles: '鈕魯詩樓', gate: '港大站校園入口', garden: '百周年校園花園', cafe: '校園咖啡點（示例）', toilet: '公共洗手間（示例）' };

export function filterPlaces(category: Category, query = '') {
  const terms = query.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
  return places.filter(place => {
    const names = `${place.name} ${place.english} ${place.abbreviation ?? ''} ${place.keywords} ${traditionalNames[place.id] ?? ''}`.normalize('NFKC').toLowerCase();
    return (category === 'all' || place.category === category) && terms.every(term => names.includes(term));
  });
}

export const routeSteps = [
  { icon: 'map-pin', title: '从港大站校园入口出发', copy: '对照配图辨认起点，然后沿通道出发。', photo: '起点示意图' },
  { icon: 'corner-up-right', title: '沿步行路径前往路口', copy: '经过学习空间，在路口按地标右转。', photo: '路口地标图' },
  { icon: 'arrow-up', title: '乘电梯前往连通楼层', copy: '找到电梯，对照楼层指示换层。', photo: '电梯入口图' },
  { icon: 'arrow-right', title: '离开电梯后继续步行', copy: '辨认楼层出口，沿指示通道继续前进。', photo: '楼层出口图' },
  { icon: 'log-in', title: '找到本部大楼入口', copy: '对照配图和标识，辨认目的地的入口。', photo: '建筑入口图' },
  { icon: 'flag', title: '到达本部大楼', copy: '对照终点配图，确认到达位置。', photo: '到达位置图' },
] as const;
