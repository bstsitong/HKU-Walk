import { campusBuildingOutlines, MAP_HEIGHT, MAP_WIDTH, MAP_Y_MAX } from './MapArtwork';
import { getPlace, type Place } from './campus';
import type { CampusFacility } from './campusFacilities';
import { mapPinSizes, placeDisplayLevel } from './mapDisplay';
import type { MapPoint } from './campusLocation';

type Outline = {
  rings: MapPoint[][];
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const outlines: Outline[] = campusBuildingOutlines.map(path => {
  // The campus building artwork uses closed rings of absolute M/line coordinates.
  const rings = path.split('M').filter(Boolean).map(ring => Array.from(
    ring.matchAll(/(-?[\d.]+),(-?[\d.]+)/g),
    ([, x, y]) => ({ x: Number(x), y: Number(y) }),
  ));
  const points = rings.flat();
  return {
    rings,
    left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)),
  };
}).sort((a, b) => (a.right - a.left) * (a.bottom - a.top) - (b.right - b.left) * (b.bottom - b.top));

function contains({ x, y }: MapPoint, outline: Outline) {
  if (x < outline.left || x > outline.right || y < outline.top || y > outline.bottom) return false;
  let inside = false;
  for (const ring of outline.rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if ((a.y > y) !== (b.y > y) && x < a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)) inside = !inside;
    }
  }
  return inside;
}

function edgeDistance(point: MapPoint, outline: Outline) {
  let squaredDistance = Infinity;
  for (const ring of outline.rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      if (!lengthSquared) continue;
      const along = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
      const x = point.x - a.x - along * dx, y = point.y - a.y - along * dy;
      squaredDistance = Math.min(squaredDistance, x * x + y * y);
    }
  }
  return Math.sqrt(squaredDistance);
}

export function buildingAt(point: MapPoint) {
  return outlines.find(outline => contains(point, outline));
}

type MapMarkerInput<T> = {
  item: T;
  anchor: MapPoint;
  diameter: number;
  building?: Outline;
  square?: boolean;
};
export type MapItem = { place: Place } | { facility: CampusFacility };

const artworkPoint = (point: MapPoint): MapPoint => ({ x: point.x, y: point.y / MAP_Y_MAX * MAP_HEIGHT });
const openSpaceIds = new Set(['sun-yat-sen-place', 'central-podium', 'university-street', 'centennial-red-wall']);

// These records describe an indoor place but put its stored point next to the building.
const hostBuildings: Partial<Record<string, string>> = {
  'water-chiwah': 'chiwah',
  'water-lsk': 'lee-shau-kee',
  'union-restaurant': 'haking-wong',
};

export function placeMarkerInput(place: Place): MapMarkerInput<MapItem> {
  const hostId = hostBuildings[place.id];
  const host = hostId ? getPlace(hostId) ?? place : place;
  const building = place.category === 'access' || openSpaceIds.has(place.id) ? undefined : buildingAt(artworkPoint(host));
  return { item: { place }, anchor: artworkPoint(place), building, diameter: mapPinSizes[placeDisplayLevel(place)].diameter };
}

export function facilityMarkerInput(facility: CampusFacility): MapMarkerInput<MapItem> {
  const [x, y] = facility.at;
  const anchor = { x, y };
  const building = facility.kind === 'gate' ? undefined : buildingAt(anchor);
  return { item: { facility }, anchor, building, diameter: mapPinSizes[facility.displayLevel].diameter, square: true };
}

type Slot = MapPoint & { clearance: number };
const insideMap = ({ x, y }: MapPoint) => x >= 0 && x <= MAP_WIDTH && y >= 0 && y <= MAP_HEIGHT;

export function layoutMapMarkers<T>(markers: readonly MapMarkerInput<T>[], screenScale: number) {
  const grids = new Map<Outline, Slot[]>();
  const buildingGrid = (building: Outline) => {
    const existing = grids.get(building);
    if (existing) return existing;
    const points: Slot[] = [];
    // This grid uses the artwork coordinates, so moving the camera cannot move any points.
    const step = Math.max(0.24, 1.6 / screenScale);
    for (let y = Math.max(0, building.top) + step / 2; y < Math.min(MAP_HEIGHT, building.bottom); y += step) {
      for (let x = Math.max(0, building.left) + step / 2; x < Math.min(MAP_WIDTH, building.right); x += step) {
        const point = { x, y };
        if (contains(point, building)) points.push({ ...point, clearance: edgeDistance(point, building) });
      }
    }
    grids.set(building, points);
    return points;
  };

  const distanceSquared = (a: MapPoint, b: MapPoint) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const candidates = markers.map(marker => {
    const { anchor, building } = marker;
    let slots: Slot[] | undefined;
    const anchorClearance = building ? (contains(anchor, building) ? edgeDistance(anchor, building) : -1) : Infinity;
    return {
      ...marker,
      anchorSlot: { ...anchor, clearance: anchorClearance },
      nearby() {
        if (slots) return slots;
        if (building) {
          slots = [...buildingGrid(building)].sort((a, b) => distanceSquared(a, anchor) - distanceSquared(b, anchor));
        } else {
          // Some podiums sit over a shaded building outline in the artwork.
          // Keep outdoor landmarks in their original area of that footprint.
          const originalSection = buildingAt(anchor);
          slots = [];
          for (const distance of [4, 8, 12, 16, 20, 24]) {
            const offset = distance / screenScale;
            for (let i = 0; i < 12; i++) {
              const angle = i * Math.PI / 6;
              const point = { x: anchor.x + offset * Math.cos(angle), y: anchor.y + offset * Math.sin(angle) };
              if (insideMap(point) && buildingAt(point) === originalSection) slots.push({ ...point, clearance: Infinity });
            }
          }
        }
        return slots;
      },
    };
  }).sort((a, b) => b.diameter - a.diameter);

  // Try progressively smaller sizes for the whole map. The ratio between levels never changes.
  for (const factor of [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1]) {
    const layout: { item: T; point: MapPoint; radius: number }[] = [];
    let fitsAll = true;
    for (const marker of candidates) {
      const radius = (marker.square ? Math.SQRT2 : 1) * marker.diameter * factor / (2 * screenScale);
      const fits = (slot: Slot) => insideMap(slot) && slot.clearance >= radius &&
        layout.every(pin => distanceSquared(pin.point, slot) >= (pin.radius + radius + factor / screenScale) ** 2);
      const point = fits(marker.anchorSlot) ? marker.anchorSlot : marker.nearby().find(fits);
      if (!point) {
        fitsAll = false;
        break;
      }
      layout.push({ item: marker.item, point, radius });
    }
    if (fitsAll) return { factor, pins: layout };
  }

  // Keep submitted points accessible on the map even if a future set exhausts the available slots.
  const pins = candidates.map(marker => ({
    item: marker.item,
    point: marker.anchorSlot.clearance >= 0 ? marker.anchor : marker.nearby()[0] ?? marker.anchor,
  }));
  return { factor: 0.1, pins };
}
