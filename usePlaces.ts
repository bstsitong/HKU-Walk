import { places } from './campus';
import usePersonalStorage from './usePersonalStorage';
const storageKey = 'hku-walk.places.v1';
export function validPlaceIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && (places.some(place => place.id === id) || /^community-place-\d+$/.test(id))))] : [];
}
const empty = { saved: [] as string[], recent: [] as string[] };
function decode(data: unknown) {
  const record = data as Partial<typeof empty> | null;
  return { saved: validPlaceIds(record?.saved), recent: validPlaceIds(record?.recent).slice(0, 12) };
}
export default function usePlaces(owner?: string) {
  const { data, ready, update } = usePersonalStorage(owner, storageKey, empty, decode);
  return { ...data, ready,
    toggle: (id: string) => update(current => ({
      ...current, saved: current.saved.includes(id) ? current.saved.filter(item => item !== id) : [...current.saved, id],
    })),
    visit: (id: string) => update(current => ({ ...current, recent: [id, ...current.recent.filter(item => item !== id)].slice(0, 12) })),
    clearRecent: () => update(current => ({ ...current, recent: [] })),
  };
}
export type PlaceRecords = ReturnType<typeof usePlaces>;
