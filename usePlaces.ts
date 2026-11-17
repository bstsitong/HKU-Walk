import type { PersonalStorage } from './usePersonalStorage';

export default function usePlaces({ data, ready, change, toggle }: PersonalStorage) {
  return {
    saved: data.saved_places, recent: data.recent_places, ready,
    toggle: (id: string) => toggle('saved_places', id),
    visit: (id: string) => change({ collection: 'recent_places', action: 'visit', value: id }),
    clearRecent: () => change({ collection: 'recent_places', action: 'clear' }),
  };
}

export type PlaceRecords = ReturnType<typeof usePlaces>;
