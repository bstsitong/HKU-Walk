import type { PickedImage } from './communityApi';
import type { Place } from './campus';
import { CAMPUS_MAP_VERSION } from './MapArtwork';
export type RouteStepDraft = { title: string; body: string; image?: PickedImage | null; existingImage?: string; imageUrl?: string; removeImage?: boolean; sourceIndex?: number };
export type MapDraftData = { type?: 'place' | 'route' | 'place_correction' | 'route_correction'; mapVersion?: number;
  category?: Place['category']; x?: number | null; y?: number | null; english?: string; abbreviation?: string; entrance?: string;
  floor?: string; placeId?: string; originId?: string; destinationId?: string; routeId?: string; steps?: RouteStepDraft[] };
export function emptyMapDraft(kind: string): MapDraftData {
  if (kind === 'new_place') return { type: 'place', mapVersion: CAMPUS_MAP_VERSION, category: 'building', x: null, y: null, english: '', entrance: '', floor: '' };
  if (kind === 'new_route') return { type: 'route', steps: [{ title: '', body: '' }] };
  if (kind === 'place') return { type: 'place_correction' };
  if (kind === 'route') return { type: 'route_correction' };
  return {};
}
export function editMapDraft(value: MapDraftData = {}): MapDraftData {
  const location = value.type === 'place' && value.mapVersion !== CAMPUS_MAP_VERSION
    ? { x: null, y: null, mapVersion: CAMPUS_MAP_VERSION } : {};
  return { ...value, ...location, steps: value.steps?.map((step,index) => ({ title: step.title, body: step.body, existingImage: step.imageUrl || '', sourceIndex: step.sourceIndex ?? index, image: null, removeImage: false })) };
}
export function hasMapInput(data: MapDraftData): boolean {
  if (data.type === 'place') return typeof data.x === 'number' || Boolean(data.english || data.abbreviation || data.entrance || data.floor || (data.category && data.category !== 'building'));
  return Boolean(data.placeId || data.originId || data.destinationId || (data.steps?.length || 0) > 1 ||
    data.steps?.some(step => step.title || step.body || step.image || step.existingImage));
}
export function validateMapDraft(kind: string, data: MapDraftData): string | null {
  if (kind === 'new_place' && (typeof data.x !== 'number' || typeof data.y !== 'number' || !Number.isFinite(data.x) || !Number.isFinite(data.y) || data.x < 0 || data.x > 360 || data.y < 0 || data.y > 580)) return '请在校园示意图上选择地点位置。';
  if (kind === 'place' && !data.placeId) return '请选择需要纠错的地点。';
  if (kind === 'new_route' || kind === 'route') {
    if (!data.originId || !data.destinationId) return '请选择路线的起点和终点。';
    if (data.originId === data.destinationId) return '起点和终点不能相同。';
  }
  if (kind === 'new_route') {
    if (!data.steps?.length || data.steps.length > 20) return '路线需要 1–20 个步骤。';
    if (data.steps.some(step => !step.title.trim())) return '每一步都需要标题。';
  }
  return null;
}
export function serializeMapDraft(kind: string, value: MapDraftData) {
  const inherit: Record<string, number> = {};
  const removed: number[] = [];
  const uploads: { index: number; image: PickedImage }[] = [];
  if (kind === 'new_route') {
    const steps = (value.steps || []).map((step,index) => {
      if (step.image) uploads.push({ index, image: step.image });
      else if (step.removeImage) removed.push(index);
      else if (step.existingImage && typeof step.sourceIndex === 'number') inherit[String(index)] = step.sourceIndex;
      return { title: step.title.trim(), body: step.body.trim() };
    });
    return { data: { type: 'route', originId: value.originId, destinationId: value.destinationId, steps }, inherit, removed, uploads };
  }
  if (kind === 'place') return { data: { type: 'place_correction', placeId: value.placeId }, inherit, removed, uploads };
  if (kind === 'route') return { data: { type: 'route_correction', originId: value.originId, destinationId: value.destinationId, routeId: value.routeId || '' }, inherit, removed, uploads };
  return { data: kind === 'new_place' ? { type: 'place', mapVersion: CAMPUS_MAP_VERSION, category: value.category, x: value.x, y: value.y, english: value.english || '', abbreviation: value.abbreviation, entrance: value.entrance || '', floor: value.floor || '' } : {}, inherit, removed, uploads };
}
