import type { PickedImage } from './communityApi';
import type { Place } from './campus';
export type RouteStepDraft = { title: string; body: string; image?: PickedImage | null; existingImage?: string; imageUrl?: string; removeImage?: boolean; sourceIndex?: number };
export type MapDraftData = { type?: 'place' | 'route'; category?: Place['category']; x?: number | null; y?: number | null; english?: string; abbreviation?: string; entrance?: string; floor?: string; originId?: string; destinationId?: string; steps?: RouteStepDraft[] };
export function emptyMapDraft(kind: string): MapDraftData {
  return kind === 'new_place' ? { type: 'place', category: 'building', x: null, y: null, english: '', entrance: '', floor: '' } : kind === 'new_route' ? { type: 'route', originId: 'gate', destinationId: 'main', steps: [{ title: '', body: '' }] } : {};
}
export function editMapDraft(value: MapDraftData = {}): MapDraftData {
  return { ...value, steps: value.steps?.map((step,index) => ({ title: step.title, body: step.body, existingImage: step.imageUrl || '', sourceIndex: step.sourceIndex ?? index, image: null, removeImage: false })) };
}
export function hasMapInput(data: MapDraftData): boolean {
  if (data.type === 'place') return typeof data.x === 'number' || Boolean(data.english || data.abbreviation || data.entrance || data.floor || (data.category && data.category !== 'building'));
  if (data.type === 'route') return Boolean((data.originId && data.originId !== 'gate') || (data.destinationId && data.destinationId !== 'main') || (data.steps?.length || 0) > 1 || data.steps?.some(step => step.title || step.body || step.image || step.existingImage));
  return false;
}
export function validateMapDraft(kind: string, data: MapDraftData): string | null {
  if (kind === 'new_place' && (typeof data.x !== 'number' || typeof data.y !== 'number' || !Number.isFinite(data.x) || !Number.isFinite(data.y) || data.x < 0 || data.x > 360 || data.y < 0 || data.y > 580)) return '请在校园示意图上选择地点位置。';
  if (kind === 'new_route') {
    if (!data.originId || !data.destinationId) return '请选择路线的起点和终点。';
    if (data.originId === data.destinationId) return '起点和终点不能相同。';
    if (!data.steps?.length || data.steps.length > 20) return '路线需要 1–20 个步骤。';
    if (data.steps.some(step => !step.title.trim() || !step.body.trim())) return '每一步都需要标题和说明。';
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
  return { data: kind === 'new_place' ? { type: 'place', category: value.category, x: value.x, y: value.y, english: value.english || '', abbreviation: value.abbreviation, entrance: value.entrance || '', floor: value.floor || '' } : {}, inherit, removed, uploads };
}
