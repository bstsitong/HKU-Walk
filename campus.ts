export const categories = [
  { id: 'all', label: '全部' },
  { id: 'building', label: '教学楼' },
  { id: 'study', label: '学习' },
  { id: 'food', label: '餐饮' },
  { id: 'toilet', label: '洗手间' },
  { id: 'access', label: '出入口' },
] as const;

export type Category = (typeof categories)[number]['id'];

type Place = {
  id: string;
  name: string;
  english: string;
  keywords: string;
  category: Exclude<Category, 'all'> | 'space';
  x: number;
  y: number;
};

// These coordinates are in the prototype's drawing, separate from GPS coordinates.
export const places: Place[] = [
  { id: 'main', name: '本部大楼', english: 'Main Building', keywords: '本部大樓 MB', category: 'building', x: 255, y: 168 },
  { id: 'library', name: '大学图书馆', english: 'Main Library', keywords: '圖書館 总图书馆', category: 'study', x: 178, y: 296 },
  { id: 'chiwah', name: '智华学习共享空间', english: 'Chi Wah Learning Commons', keywords: '智華 CWLC', category: 'study', x: 76, y: 416 },
  { id: 'knowles', name: '钮鲁诗楼', english: 'Knowles Building', keywords: '鈕魯詩樓 KB', category: 'building', x: 266, y: 357 },
  { id: 'gate', name: '港大站校园入口', english: 'HKU Station · Campus access', keywords: '港大站 地鐵 地铁 MTR', category: 'access', x: 62, y: 507 },
  { id: 'garden', name: '百周年校园花园', english: 'Centennial Campus Garden', keywords: '花園', category: 'space', x: 88, y: 265 },
  { id: 'cafe', name: '校园咖啡点（示例）', english: 'Campus café · sample', keywords: '咖啡 cafe 餐饮 food', category: 'food', x: 126, y: 366 },
  { id: 'toilet', name: '公共洗手间（示例）', english: 'Public toilet · sample', keywords: '廁所 洗手間 wc 厕所', category: 'toilet', x: 275, y: 445 },
];

export function findPlace(id: string) {
  return places.find(place => place.id === id) ?? places[0];
}

export function categoryLabel(category: Place['category']) {
  return categories.find(item => item.id === category)?.label ?? '校园空间';
}

export function filterPlaces(category: Category, query = '') {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return places.filter(place => {
    const names = `${place.name} ${place.english} ${place.keywords}`.toLowerCase();
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
