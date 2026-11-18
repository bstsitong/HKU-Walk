import display from './server/guide/map_display.json';
import type { IconName } from './AppIcon';

export type MapDisplayLevel = 1 | 2 | 3 | 4;

// Sizes in density-independent points. The touch area is set independently in MapCanvas.
export const mapPinSizes = {
  1: { diameter: 34, icon: 21, text: 13, labelWidth: 120 },
  2: { diameter: 30, icon: 18, text: 12, labelWidth: 106 },
  3: { diameter: 26, icon: 16, text: 11, labelWidth: 94 },
  4: { diameter: 22, icon: 14, text: 10, labelWidth: 82 },
} satisfies Record<MapDisplayLevel, { diameter: number; icon: number; text: number; labelWidth: number }>;

const placeSymbols = {
  entrance: { icon: 'gate', color: '#184d3e' },
  building: { icon: 'building', color: '#325b4b' },
  attraction: { icon: 'landmark', color: '#6b542d' },
  dining: { icon: 'utensils', color: '#93442e' },
  souvenir: { icon: 'gift', color: '#674a70' },
  restroom: { icon: 'wc', color: '#475463' },
  water: { icon: 'water', color: '#245d77' },
  plaza: { icon: 'plaza', color: '#325b4b' },
  indoor: { icon: 'pin', color: '#51645b' },
} satisfies Record<string, { icon: IconName; color: string }>;

const souvenirShops = new Set(['campus-store', 'visitor-centre-gift-shop', 'hku-press-bookshop']);
export const isSouvenirShop = (id: string) => souvenirShops.has(id);
const namedOpenSpaces = new Set(['university-street', 'sun-yat-sen-place', 'central-podium']);

export function mapPlaceSymbol(place: Parameters<typeof placeDisplayLevel>[0]) {
  if (isSouvenirShop(place.id)) return placeSymbols.souvenir;
  if (namedOpenSpaces.has(place.id)) return placeSymbols.plaza;
  switch (place.category) {
    case 'access': return placeSymbols.entrance;
    case 'building': return placeSymbols.building;
    case 'food': return placeSymbols.dining;
    case 'toilet': return placeSymbols.restroom;
    case 'water': return placeSymbols.water;
    case 'study': return placeDisplayLevel(place) === 2 ? placeSymbols.building : placeSymbols.indoor;
    case 'space': return placeDisplayLevel(place) === 4 ? placeSymbols.indoor : placeSymbols.attraction;
    default: return placeSymbols.indoor;
  }
}

export function canonicalPlaceId(id: string): string {
  return Object.hasOwn(display.aliases, id) ? display.aliases[id as keyof typeof display.aliases] : id;
}

export function placeDisplayLevel(place: {
  id: string; category: string; displayLevel?: MapDisplayLevel; parentBuildingId?: string;
}): MapDisplayLevel {
  if (place.displayLevel === 1 || place.displayLevel === 2 || place.displayLevel === 3 || place.displayLevel === 4) {
    return place.displayLevel;
  }
  if (place.parentBuildingId) return 4;
  return (display.places[place.id as keyof typeof display.places] ??
    display.categories[place.category as keyof typeof display.categories] ?? 4) as MapDisplayLevel;
}

export function visibleMapLevel(zoom: number): 2 | 3 | 4 {
  if (zoom >= 2.9) return 4;
  if (zoom >= 2.0) return 3;
  return 2;
}
